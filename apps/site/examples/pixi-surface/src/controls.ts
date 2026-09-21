import { Pane } from 'tweakpane';
import { initialCamera } from './view.ts';

/** DOM input and controls stay outside both the Pixi scene and graph recording. */
export function createControls(canvas: HTMLCanvasElement, resetAnimation: () => void, controlsHost?: HTMLElement) {
    const camera = { ...initialCamera };
    const state = { paused: false, time: 0 };
    const container = controlsHost ?? document.createElement('div');
    if (!controlsHost) canvas.after(container);
    const pane = new Pane({ container });
    // Tweakpane's standalone package omits its inherited core API declarations.
    const buttons = pane as unknown as {
        addButton(options: { title: string }): {
            title: string;
            on(event: 'click', callback: () => void): void;
        };
    };
    const pause = buttons.addButton({ title: 'Pause' });
    pause.on('click', () => {
        state.paused = !state.paused;
        pause.title = state.paused ? 'Resume' : 'Pause';
    });
    buttons.addButton({ title: 'Reset' }).on('click', () => {
        cancel(); Object.assign(camera, initialCamera);
        state.paused = false; state.time = 0; resetAnimation();
        pause.title = 'Pause';
    });
    let drag: { id: number; x: number; y: number } | undefined;
    const previousTouchAction = canvas.style.touchAction;
    canvas.style.touchAction = 'none';
    function cancel() {
        const id = drag?.id; drag = undefined;
        if (id !== undefined && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    }
    const down = (event: PointerEvent) => {
        if (event.button !== 0 || drag) return;
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
        canvas.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
        if (event.pointerId !== drag?.id) return;
        camera.azimuth = Math.max(-0.7, Math.min(0.7, camera.azimuth - (event.clientX - drag.x) * 0.006));
        camera.polar = Math.max(0.95, Math.min(1.65, camera.polar - (event.clientY - drag.y) * 0.006));
        drag.x = event.clientX; drag.y = event.clientY;
    };
    const end = (event: PointerEvent) => { if (event.pointerId === drag?.id) cancel(); };
    const wheel = (event: WheelEvent) => {
        event.preventDefault();
        const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
        camera.distance = Math.max(9, Math.min(20, camera.distance * Math.exp(Math.max(-1, Math.min(1, pixels * 0.001)))));
    };
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('lostpointercapture', end);
    canvas.addEventListener('wheel', wheel, { passive: false }); window.addEventListener('blur', cancel);
    return { camera, state, cancel, destroy() {
        cancel(); pane.dispose(); if (!controlsHost) container.remove();
        canvas.style.touchAction = previousTouchAction;
        canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', end); canvas.removeEventListener('pointercancel', end);
        canvas.removeEventListener('lostpointercapture', end);
        canvas.removeEventListener('wheel', wheel); window.removeEventListener('blur', cancel);
    } };
}
