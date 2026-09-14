import type { FrameGraphCaptureRequest } from '@zenfg/inspector';
import { visualThemes, type ThemeMode } from '../../../shared/theme/index.ts';
import type { FrameGraphSnapshot } from '@zenfg/snapshot';
import { type FrameGraphCompilationReport, type FrameGraphExecutionTiming } from '@zenfg/webgpu';
import { resolvePointerPressure } from '../../interactive-background/src/backgroundInteraction.ts';
import { resolveFlowDimensions, projectPoint, coverFocus } from './curves.ts';
import { frameParamsFloatCount, type SurfaceResources } from './resources.ts';


const pointerFollowRate = 30;

const pointerVelocityDecayRate = 7;

const pointerDownPressure = 0.08;

export type ReadingRegion = readonly [number, number, number, number];
export type CoverReadingRegions = readonly [ReadingRegion, ReadingRegion, ReadingRegion];

export type RefractiveFlowOptions = {
	readonly readingRegions?: { get(): CoverReadingRegions; subscribe(listener: () => void): () => void };
	readonly interactionTarget?: HTMLElement;
	/** Mouse viewpoint motion can follow the whole hero, independently of local bending. */
	readonly parallaxTarget?: HTMLElement;
	readonly theme?: ThemeMode;
	readonly presentation?: 'cover' | 'stage';
	readonly onAnchor?: (position: readonly [number, number]) => void;
	/** Called after a frame is submitted; observational only. */
	readonly onFrame?: () => void;
	readonly onReady?: () => void;
	readonly onError?: (error: Error) => void;
};

export type RefractiveFlowController = {
	readonly setTheme: (theme: ThemeMode) => void;
	readonly setActive: (active: boolean) => void;
	readonly captureSnapshot: (request?: FrameGraphCaptureRequest) => Promise<FrameGraphSnapshot | undefined>;
	readonly dispose: () => void;
};

type PendingCapture = {
    readonly timing: FrameGraphCaptureRequest['timing'];
	readonly promise: Promise<FrameGraphSnapshot | undefined>;
	readonly resolve: (snapshot: FrameGraphSnapshot | undefined) => void;
};

export function notifyStartError(options: RefractiveFlowOptions, error: Error): void {
	try {
		options.onError?.(error);
	}
	catch {
		// Host notifications must not obscure the initialization failure.
	}
}

export function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

export abstract class SurfaceBrowserHost implements RefractiveFlowController {
	protected readonly uniformData = new Float32Array(frameParamsFloatCount);
	protected readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
	protected readonly coarsePointer = window.matchMedia('(pointer: coarse)');
	protected readonly interactionTarget: EventTarget;
	private readonly parallaxTarget: HTMLElement;
	private parallaxX = 0;
	private parallaxY = 0;
	private targetParallaxX = 0;
	private targetParallaxY = 0;
	private cssWidth = 1;
	private cssHeight = 1;
	protected readonly resizeObserver: ResizeObserver | undefined;
	protected animationFrame = 0;
	protected previousFrameTime = 0;
	protected frameIndex = 0;
	protected width = 1;
	protected height = 1;
	protected narrow = false;
	protected compact = false;
	protected targetPointerX = 0.76;
	protected targetPointerY = 0.42;
	protected pointerX = this.targetPointerX;
	protected pointerY = this.targetPointerY;
	protected velocityX = 0;
	protected velocityY = 0;
	protected pointerPressure = 0;
	protected pendingPointerTravel = 0;
	protected hasPointerSample = false;
	protected resizePending = true;
	protected dirty = true;
	protected disposed = false;
	protected readyReported = false;
	protected active = true;
	protected theme: ThemeMode;
	protected elapsed = 0;
	protected reportCaptured = false;
	private unsubscribeReading: (() => void) | undefined;
	protected pendingCapture: PendingCapture | undefined;
	protected captureInFlight = false;

	constructor(
		protected readonly canvas: HTMLCanvasElement,
		protected readonly resources: SurfaceResources,
		protected readonly options: RefractiveFlowOptions,
	) {
		this.theme = options.theme ?? 'dark';
		this.interactionTarget = options.interactionTarget ?? canvas;
		this.parallaxTarget = options.parallaxTarget ?? canvas;
		this.resizeObserver = typeof ResizeObserver === 'undefined'
			? undefined
			: new ResizeObserver(this.handleResize);
	}

	start(): void {
		window.addEventListener('resize', this.handleResize, { passive: true });
		this.resizeObserver?.observe(this.canvas);
		this.interactionTarget.addEventListener('pointermove', this.handlePointer as EventListener, { passive: true });
		this.interactionTarget.addEventListener('pointerdown', this.handlePointer as EventListener, { passive: true });
		this.interactionTarget.addEventListener('pointerleave', this.handlePointerLeave);
		this.interactionTarget.addEventListener('pointercancel', this.handlePointerLeave);
		this.parallaxTarget.addEventListener('pointermove', this.handleParallaxPointer as EventListener, { passive: true });
		this.parallaxTarget.addEventListener('pointerleave', this.handleParallaxLeave);
		this.parallaxTarget.addEventListener('pointercancel', this.handleParallaxLeave);
		window.addEventListener('pageshow', this.handlePageShow);
		document.addEventListener('visibilitychange', this.handleVisibility);
		this.reducedMotion.addEventListener('change', this.handleMotionPreference);
		this.coarsePointer.addEventListener('change', this.handleResize);
		this.unsubscribeReading = this.options.readingRegions?.subscribe(this.handleMotionPreference);
		void this.resources.device.lost.then((info) => {
			if (this.disposed) return;
			this.fail(new Error(`Refractive flow WebGPU device was lost: ${info.message || info.reason}`));
		});
		this.requestFrame();
	}

	setTheme(theme: ThemeMode): void {
		if (this.disposed || this.theme === theme) return;
		this.theme = theme;
		this.dirty = true;
		this.requestFrame();
	}

	setActive(active: boolean): void {
		if (this.disposed || this.active === active) return;
		this.active = active;
		if (active) this.resumeRendering();
		else this.suspendRendering();
	}

	protected suspendRendering(): void {
		cancelAnimationFrame(this.animationFrame);
		this.animationFrame = 0;
		this.previousFrameTime = 0;
		this.handlePointerLeave();
		this.resetParallax();
		this.pendingCapture?.resolve(undefined);
		this.pendingCapture = undefined;
	}

	protected readonly handlePointerLeave = (): void => {
		this.hasPointerSample = false;
		this.pendingPointerTravel = 0;
		this.velocityX = this.velocityY = 0;
	};

	captureSnapshot(request: FrameGraphCaptureRequest = { timing: 'both' }): Promise<FrameGraphSnapshot | undefined> {
		if (this.disposed || !this.active || document.visibilityState === 'hidden') return Promise.resolve(undefined);
		if (this.pendingCapture) return this.pendingCapture.promise;

		let resolveCapture: PendingCapture['resolve'] = () => undefined;
		const promise = new Promise<FrameGraphSnapshot | undefined>((resolve) => {
			resolveCapture = resolve;
		});
		this.pendingCapture = { timing: request.timing, promise, resolve: resolveCapture };
		this.dirty = true;
		this.requestFrame();
		return promise;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		cancelAnimationFrame(this.animationFrame);
		this.animationFrame = 0;
		window.removeEventListener('resize', this.handleResize);
		this.resizeObserver?.disconnect();
		this.unsubscribeReading?.();
		this.interactionTarget.removeEventListener('pointermove', this.handlePointer as EventListener);
		this.interactionTarget.removeEventListener('pointerdown', this.handlePointer as EventListener);
		this.interactionTarget.removeEventListener('pointerleave', this.handlePointerLeave);
		this.interactionTarget.removeEventListener('pointercancel', this.handlePointerLeave);
		this.parallaxTarget.removeEventListener('pointermove', this.handleParallaxPointer as EventListener);
		this.parallaxTarget.removeEventListener('pointerleave', this.handleParallaxLeave);
		this.parallaxTarget.removeEventListener('pointercancel', this.handleParallaxLeave);
		window.removeEventListener('pageshow', this.handlePageShow);
		document.removeEventListener('visibilitychange', this.handleVisibility);
		this.reducedMotion.removeEventListener('change', this.handleMotionPreference);
		this.coarsePointer.removeEventListener('change', this.handleResize);
		this.pendingCapture?.resolve(undefined);
		this.pendingCapture = undefined;
	}

	protected readonly handleResize = (): void => {
		this.resizePending = true;
		this.dirty = true;
		this.requestFrame();
	};

	private resetParallax(): void {
		this.parallaxX = this.parallaxY = this.targetParallaxX = this.targetParallaxY = 0;
	}

	private readonly handleParallaxLeave = (): void => {
		this.targetParallaxX = this.targetParallaxY = 0;
	};

	private readonly handleParallaxPointer = (event: PointerEvent): void => {
		if (!event.isPrimary || event.pointerType !== 'mouse' || !this.active || this.reducedMotion.matches
			|| this.coarsePointer.matches || document.visibilityState === 'hidden') return;
		const bounds = this.parallaxTarget.getBoundingClientRect();
		if (bounds.width <= 0 || bounds.height <= 0) return;
		this.targetParallaxX = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1));
		this.targetParallaxY = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1));
	};

	protected readonly handlePointer = (event: PointerEvent): void => {
		if (!event.isPrimary || !this.active || this.reducedMotion.matches) return;
		const bounds = this.canvas.getBoundingClientRect();
		if (bounds.width <= 0 || bounds.height <= 0) return;
		if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) { this.handlePointerLeave(); return; }
		const nextX = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
		const nextY = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
		if (!this.hasPointerSample) {
			this.pointerX = nextX;
			this.pointerY = nextY;
			this.hasPointerSample = true;
		}
		else {
			const deltaX = nextX - this.targetPointerX;
			const deltaY = nextY - this.targetPointerY;
			const pointerAspect = this.width / this.height;
			this.pendingPointerTravel += Math.hypot(deltaX * pointerAspect, deltaY);
			this.velocityX = this.velocityX * 0.35 + deltaX * 0.65;
			this.velocityY = this.velocityY * 0.35 + deltaY * 0.65;
		}
		this.targetPointerX = nextX;
		this.targetPointerY = nextY;
		if (event.type === 'pointerdown') {
			this.pointerPressure = Math.max(this.pointerPressure, pointerDownPressure);
		}
		this.dirty = true;
		this.requestFrame();
	};

	protected readonly handleVisibility = (): void => {
		if (document.visibilityState === 'visible') this.resumeRendering();
		else this.suspendRendering();
	};

	protected readonly handlePageShow = (event: PageTransitionEvent): void => {
		if (event.persisted) this.resumeRendering();
	};

	protected readonly handleMotionPreference = (): void => {
		this.previousFrameTime = 0;
		this.dirty = true;
		this.requestFrame();
	};

	protected resumeRendering(): void {
		if (this.animationFrame !== 0) cancelAnimationFrame(this.animationFrame);
		this.animationFrame = 0;
		this.previousFrameTime = 0;
		this.dirty = true;
		this.requestFrame();
	}

	protected requestFrame(): void {
		if (this.disposed || !this.active || this.animationFrame !== 0 || document.visibilityState === 'hidden') return;
		this.animationFrame = requestAnimationFrame(this.renderFrame);
	}
	protected abstract readonly renderFrame: (now: number) => void;

	protected resizeCanvas(): void {
		const bounds = this.canvas.getBoundingClientRect();
		const cssWidth = Math.max(1, bounds.width || this.canvas.clientWidth);
		const cssHeight = Math.max(1, bounds.height || this.canvas.clientHeight);
		this.cssWidth = cssWidth;
		this.cssHeight = cssHeight;
		this.narrow = this.options.presentation === 'cover' && cssWidth < 600;
		this.compact = cssWidth < 900;
		const dimensions = resolveFlowDimensions(
			cssWidth,
			cssHeight,
			window.devicePixelRatio,
			this.coarsePointer.matches,
		);
		// Retire previous backing sizes before recording the next frame.
		if (this.width !== dimensions.width || this.height !== dimensions.height) {
			this.resources.graph.clearResourcePool();
		}
		this.width = dimensions.width;
		this.height = dimensions.height;
		if (this.canvas.width !== this.width) this.canvas.width = this.width;
		if (this.canvas.height !== this.height) this.canvas.height = this.height;
		try { this.options.onAnchor?.(projectPoint(coverFocus, this.width / this.height, this.narrow)); } catch { /* DOM annotation is observational. */ }
		this.resizePending = false;
	}

	protected updatePointer(deltaSeconds: number): void {
		if (this.reducedMotion.matches || this.coarsePointer.matches) this.resetParallax();
		else {
			const ease = 1 - Math.exp(-5 * deltaSeconds);
			this.parallaxX += (this.targetParallaxX - this.parallaxX) * ease;
			this.parallaxY += (this.targetParallaxY - this.parallaxY) * ease;
		}
		this.pointerPressure = resolvePointerPressure(
			this.pointerPressure,
			this.pendingPointerTravel,
			deltaSeconds,
			this.reducedMotion.matches,
		);
		this.pendingPointerTravel = 0;
		const response = 1 - Math.exp(-deltaSeconds * pointerFollowRate);
		this.pointerX += (this.targetPointerX - this.pointerX) * response;
		this.pointerY += (this.targetPointerY - this.pointerY) * response;
		const velocityDecay = Math.exp(-deltaSeconds * pointerVelocityDecayRate);
		this.velocityX *= velocityDecay;
		this.velocityY *= velocityDecay;
	}

	private backgroundColor(): number[] {
		const hex = visualThemes[this.theme].canvas.slice(1);
		return [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
	}

	protected updateUniforms(timeSeconds: number, deltaSeconds: number): void {
		this.uniformData.set([
			this.width,
			this.height,
			-this.parallaxX * 36 / this.cssWidth,
			this.parallaxY * 27 / this.cssHeight,
			this.pointerX,
			this.pointerY,
			this.velocityX,
			this.velocityY,
			timeSeconds,
			deltaSeconds,
			this.width / this.height,
			this.pointerPressure,
			this.frameIndex,
			this.reducedMotion.matches ? 1 : 0,
			1 - this.pointerPressure,
			this.coarsePointer.matches ? 1 : 0,
			...this.backgroundColor(), 1,
			this.theme === 'light' ? 1 : 0, this.options.presentation === 'cover' ? 1 : 0, this.narrow ? 1 : 0, this.compact ? 1 : 0,
			...(this.options.readingRegions?.get().flat() ?? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
		]);
		this.resources.device.queue.writeBuffer(this.resources.uniformBuffer, 0, this.uniformData);
	}
	protected abstract recordAndExecuteFrame(): void;

	protected async finishCapture(
		capture: PendingCapture,
		compilation: FrameGraphCompilationReport,
		executionTiming: FrameGraphExecutionTiming,
	): Promise<void> {
        const resourcePool = { ...this.resources.graph.getResourcePoolStats() };
		try {
			const [timing, { createFrameGraphSnapshot }] = await Promise.all([
				executionTiming.gpu,
				import('@zenfg/webgpu/snapshot'),
			]);
			if (this.disposed || this.pendingCapture !== capture) return;
			capture.resolve(createFrameGraphSnapshot({ frameIndex: executionTiming.frameIndex, cpuTiming: executionTiming.cpu,
				compilation,
				gpuTiming: timing,
				resourcePool,
			}));
		}
		catch {
			if (!this.disposed && this.pendingCapture === capture) capture.resolve(undefined);
		}
		finally {
			if (this.pendingCapture === capture) this.pendingCapture = undefined;
			this.captureInFlight = false;
		}
	}

	protected notifyReady(): void {
		try {
			this.options.onReady?.();
		}
		catch {
			// Host notifications must not break the renderer.
		}
	}

	protected fail(error: Error): void {
		try {
			this.options.onError?.(error);
		}
		catch {
			// Host notifications must not obscure the rendering failure.
		}
		this.dispose();
	}
}
