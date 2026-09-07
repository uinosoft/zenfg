import type { MonocularLightInjectionSettings } from './types.ts';
import {
    MONOCULAR_LIGHT_INJECTION_LIGHT_Z_MAX,
    MONOCULAR_LIGHT_INJECTION_LIGHT_Z_MIN,
} from './monocularLightInjection.ts';

const ORBIT_SPEED = 0.00024;
const ORBIT_RADIUS = 0.26;
const WHEEL_STEP_LIMIT = 60;
const WHEEL_SENSITIVITY = 0.0015;
const PINCH_SENSITIVITY = 0.004;
const LIGHT_GRAB_RADIUS = 0.08;
const TAP_SLOP = 0.012;

type LightControl = 'orbit' | 'cursor' | 'pinned';
type Gesture =
    | { readonly kind: 'none' }
    | { readonly kind: 'press'; readonly grabbed: boolean; readonly x: number; readonly y: number }
    | { readonly kind: 'drag' }
    | { readonly kind: 'pinch'; span: number };

export interface LightInput {
    readonly lightPosition: readonly [number, number];
    readonly lightZ: number;
    orbitTick(): void;
}

export function squareCanvasFraction(
    rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
    clientX: number,
    clientY: number,
): { x: number; y: number } | undefined {
    const side = Math.min(rect.width, rect.height);
    if (side <= 0) return undefined;
    const left = rect.left + (rect.width - side) / 2;
    const top = rect.top + (rect.height - side) / 2;
    const x = (clientX - left) / side;
    const y = (clientY - top) / side;
    if (x < 0 || x > 1 || y < 0 || y > 1) return undefined;
    return { x, y };
}

export function setupLightInput(
    canvas: HTMLCanvasElement,
    initial: Pick<MonocularLightInjectionSettings, 'lightPosition' | 'lightZ'>,
    onChange: (update: Partial<MonocularLightInjectionSettings>) => void,
    signal: AbortSignal,
): LightInput {
    const pointers = new Map<number, { x: number; y: number }>();
    let gesture: Gesture = { kind: 'none' };
    let control: LightControl = 'orbit';
    let lightPosition: [number, number] = [...initial.lightPosition];
    let lightZ = initial.lightZ;

    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
    const placeLight = (x: number, y: number) => {
        lightPosition = [clamp(x, 0, 1), clamp(y, 0, 1)];
        onChange({ lightPosition });
    };
    const pushLight = (amount: number) => {
        lightZ = clamp(lightZ + amount, MONOCULAR_LIGHT_INJECTION_LIGHT_Z_MIN, MONOCULAR_LIGHT_INJECTION_LIGHT_Z_MAX);
        onChange({ lightZ });
    };
    const pointFor = (event: PointerEvent) => squareCanvasFraction(canvas.getBoundingClientRect(), event.clientX, event.clientY);
    const overLight = (point: { x: number; y: number }) => Math.hypot(point.x - lightPosition[0], point.y - lightPosition[1]) <= LIGHT_GRAB_RADIUS;
    const pinchSpan = () => {
        const [first, second] = [...pointers.values()];
        return first && second ? Math.hypot(first.x - second.x, first.y - second.y) : 0;
    };

    canvas.addEventListener('pointerdown', (event) => {
        canvas.setPointerCapture(event.pointerId);
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.size >= 2) {
            gesture = { kind: 'pinch', span: pinchSpan() };
            return;
        }
        const point = pointFor(event);
        if (!point) return;
        const grabbed = overLight(point);
        gesture = { kind: 'press', grabbed, x: point.x, y: point.y };
        if (!grabbed && event.pointerType !== 'touch') {
            placeLight(point.x, point.y);
            control = 'pinned';
        }
    }, { signal });

    canvas.addEventListener('pointermove', (event) => {
        if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (gesture.kind === 'pinch') {
            const span = pinchSpan();
            if (gesture.span > 0) pushLight((span - gesture.span) * PINCH_SENSITIVITY);
            gesture.span = span;
            return;
        }
        const point = pointFor(event);
        if (!point) return;
        if (gesture.kind === 'press' && Math.hypot(point.x - gesture.x, point.y - gesture.y) > TAP_SLOP) {
            gesture = { kind: 'drag' };
            control = 'pinned';
            placeLight(point.x, point.y);
        } else if (gesture.kind === 'drag') {
            placeLight(point.x, point.y);
        } else if (gesture.kind === 'none') {
            canvas.style.cursor = overLight(point) ? 'grab' : 'crosshair';
            if (control === 'cursor') placeLight(point.x, point.y);
        }
    }, { signal });

    const endGesture = (event: PointerEvent) => {
        pointers.delete(event.pointerId);
        if (gesture.kind === 'pinch') gesture.span = pinchSpan();
        if (pointers.size > 0) return;
        if (gesture.kind === 'press' && event.type === 'pointerup') {
            if (gesture.grabbed) control = control === 'pinned' ? 'cursor' : 'pinned';
            else if (event.pointerType === 'touch') {
                placeLight(gesture.x, gesture.y);
                control = 'pinned';
            }
        }
        gesture = { kind: 'none' };
    };
    canvas.addEventListener('pointerup', endGesture, { signal });
    canvas.addEventListener('pointercancel', endGesture, { signal });
    canvas.addEventListener('pointerenter', () => { if (control !== 'pinned') control = 'cursor'; }, { signal });
    canvas.addEventListener('pointerleave', () => {
        if (control !== 'pinned') control = 'orbit';
        canvas.style.cursor = 'crosshair';
    }, { signal });
    canvas.addEventListener('wheel', (event) => {
        event.preventDefault();
        let delta = event.deltaY;
        if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= 16;
        else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) delta *= canvas.clientHeight;
        delta = Math.sign(delta) * Math.min(Math.abs(delta), WHEEL_STEP_LIMIT);
        pushLight(delta * WHEEL_SENSITIVITY);
    }, { passive: false, signal });

    return {
        get lightPosition() { return lightPosition; },
        get lightZ() { return lightZ; },
        orbitTick() {
            if (control !== 'orbit') return;
            const phase = performance.now() * ORBIT_SPEED;
            placeLight(
                0.5 + Math.cos(phase) * ORBIT_RADIUS,
                0.44 + Math.sin(phase * 1.37) * ORBIT_RADIUS * 0.8,
            );
        },
    };
}
