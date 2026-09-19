export interface OrbitCamera {
    azimuth: number;
    polar: number;
    distance: number;
}

/** Column-major right-handed view/projection with WebGPU's zero-to-one depth. */
export function createViewProjection(camera: OrbitCamera, aspect: number, reverseZ: boolean): Float32Array {
    const z = [Math.sin(camera.polar) * Math.sin(camera.azimuth), Math.cos(camera.polar), Math.sin(camera.polar) * Math.cos(camera.azimuth)];
    const x = [Math.cos(camera.azimuth), 0, -Math.sin(camera.azimuth)];
    const y = [z[1] * x[2], z[2] * x[0] - z[0] * x[2], -z[1] * x[0]];
    const view = new Float32Array([
        x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
        0, 0, -camera.distance, 1,
    ]);
    const near = 0.1;
    const far = 1_000;
    const f = 1 / Math.tan(Math.PI / 8);
    const projection = new Float32Array(16);
    projection[0] = f / aspect;
    projection[5] = f;
    projection[10] = reverseZ ? near / (far - near) : far / (near - far);
    projection[11] = -1;
    projection[14] = reverseZ ? far * near / (far - near) : far * near / (near - far);
    const result = new Float32Array(16);
    for (let column = 0; column < 4; column += 1) {
        for (let row = 0; row < 4; row += 1) {
            for (let k = 0; k < 4; k += 1) result[column * 4 + row] += projection[k * 4 + row] * view[column * 4 + k];
        }
    }
    return result;
}

/** Keeps browser input outside the reusable renderer. */
export function attachOrbitControls(canvas: HTMLCanvasElement, camera: OrbitCamera, changed: () => void): () => void {
    let pointer: number | undefined;
    let lastX = 0;
    let lastY = 0;
    const previousTouchAction = canvas.style.touchAction;
    canvas.style.touchAction = 'none';
    const down = (event: PointerEvent): void => {
        if (event.button !== 0 || pointer !== undefined) return;
        pointer = event.pointerId;
        lastX = event.clientX;
        lastY = event.clientY;
        canvas.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent): void => {
        if (event.pointerId !== pointer) return;
        camera.azimuth -= (event.clientX - lastX) * 0.007;
        camera.polar = Math.max(0.08, Math.min(Math.PI - 0.08, camera.polar - (event.clientY - lastY) * 0.007));
        lastX = event.clientX;
        lastY = event.clientY;
        changed();
    };
    const up = (event: PointerEvent): void => {
        if (event.pointerId !== pointer) return;
        pointer = undefined;
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    const wheel = (event: WheelEvent): void => {
        event.preventDefault();
        const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
        camera.distance = Math.max(3, Math.min(600, camera.distance * Math.exp(Math.max(-1, Math.min(1, pixels * 0.001)))));
        changed();
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => {
        canvas.removeEventListener('pointerdown', down);
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', up);
        canvas.removeEventListener('pointercancel', up);
        canvas.removeEventListener('lostpointercapture', up);
        canvas.removeEventListener('wheel', wheel);
        if (pointer !== undefined && canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
        canvas.style.touchAction = previousTouchAction;
    };
}
