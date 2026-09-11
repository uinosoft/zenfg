import type { Particles4AllController } from './startParticles4All.ts';

export function installPointerControls(
    canvas: HTMLCanvasElement,
    feature: Pick<Particles4AllController, 'beginBodyDrag' | 'updateBodyDrag' | 'endBodyDrag' | 'applyPointerImpulse' | 'orbit' | 'pan' | 'zoom' | 'getSettings' | 'setSettings'>,
    signal: AbortSignal,
    onSettingsChanged?: () => void,
): void {
    let dragging = false;
    let pointerReady = false;
    let mode: 'orbit' | 'pan' | 'body' = 'orbit';
    let lastX = 0;
    let lastY = 0;
    const uv = (event: PointerEvent): [number, number] => {
        const rect = canvas.getBoundingClientRect();
        return [(event.clientX - rect.left) / Math.max(1, rect.width), (event.clientY - rect.top) / Math.max(1, rect.height)];
    };
    canvas.addEventListener('pointerdown', (event) => {
        dragging = true;
        pointerReady = true;
        lastX = event.clientX;
        lastY = event.clientY;
        const [u, v] = uv(event);
        mode = event.button === 0 && feature.beginBodyDrag(u, v) ? 'body' : event.button === 0 ? 'orbit' : 'pan';
        canvas.setPointerCapture(event.pointerId);
        event.preventDefault();
    }, { signal });
    canvas.addEventListener('pointermove', (event) => {
        if (!pointerReady) {
            lastX = event.clientX;
            lastY = event.clientY;
            pointerReady = true;
            return;
        }
        const dx = event.clientX - lastX;
        const dy = event.clientY - lastY;
        const rect = canvas.getBoundingClientRect();
        const fromU = (lastX - rect.left) / Math.max(1, rect.width);
        const fromV = (lastY - rect.top) / Math.max(1, rect.height);
        const [toU, toV] = uv(event);
        if (!dragging) {
            feature.applyPointerImpulse(fromU, fromV, toU, toV);
        } else if (mode === 'orbit') {
            feature.orbit(dx, dy);
        } else if (mode === 'pan') {
            feature.pan(dx, dy);
        } else {
            feature.updateBodyDrag(toU, toV);
        }
        lastX = event.clientX;
        lastY = event.clientY;
    }, { signal });
    const end = () => {
        dragging = false;
        feature.endBodyDrag();
    };
    canvas.addEventListener('pointerup', end, { signal });
    canvas.addEventListener('pointercancel', end, { signal });
    canvas.addEventListener('lostpointercapture', end, { signal });
    window.addEventListener('blur', end, { signal });
    signal.addEventListener('abort', end, { once: true });
    canvas.addEventListener('pointerenter', (event) => {
        lastX = event.clientX;
        lastY = event.clientY;
        pointerReady = true;
    }, { signal });
    canvas.addEventListener('pointerleave', () => {
        if (!dragging) pointerReady = false;
    }, { signal });
    canvas.addEventListener('wheel', (event) => {
        event.preventDefault();
        feature.zoom(event.deltaY);
    }, { signal, passive: false });
    canvas.addEventListener('contextmenu', (event) => event.preventDefault(), { signal });
    window.addEventListener('keydown', (event) => {
        if (event.code !== 'Space' || event.repeat || isEditableTarget(event.target)) return;
        const settings = feature.getSettings();
        feature.setSettings({ paused: !settings.paused });
        onSettingsChanged?.();
        event.preventDefault();
    }, { signal });
}

function isEditableTarget(target: EventTarget | null): boolean {
    if (typeof HTMLElement === 'undefined') return false;
    return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName));
}
