import * as pc from 'playcanvas';

/** Explicit forward-Z projection: PlayCanvas consumes GL clip depth, Reference consumes WebGPU depth. */
export function cameraMatrices(eye: pc.Vec3, target: pc.Vec3, aspect: number, streaming: boolean) {
    return project(new pc.Mat4().setLookAt(eye, target, pc.Vec3.UP), aspect, streaming);
}
function project(world: pc.Mat4, aspect: number, streaming: boolean) {
    const projection = new pc.Mat4().setPerspective(streaming ? 75 : 50, aspect, 0.1, streaming ? 1000 : 100);
    const correction = new pc.Mat4().set([1,0,0,0, 0,1,0,0, 0,0,0.5,0, 0,0,0.5,1]);
    const viewProjection = new pc.Mat4().mul2(correction, projection).mul(world.clone().invert());
    return { world, projection, viewProjection: new Float32Array(viewProjection.data) };
}

/**
 * Uses the native controllers/input sources behind PlayCanvas 2.21.4 CameraControls.
 * Only input mapping, canvas focus and shared projection adaptation belong to this example.
 * Source: playcanvas/scripts/esm/camera-controls.mjs (MIT); see the example notices.
 */
export class ExampleCamera {
    private canvas?: HTMLCanvasElement;
    private events?: AbortController;
    private active = false;
    private readonly pointers = new Set<number>();
    private readonly desktop = new pc.KeyboardMouseSource();
    private readonly touch = new pc.MultiTouchSource();
    private readonly frame = new pc.InputFrame({ move: [0,0,0], rotate: [0,0,0] });
    private readonly keys = new Array(Object.keys(pc.KeyboardMouseSource.keyCode).length).fill(0);
    private readonly pose = new pc.Pose();
    private readonly controller: pc.OrbitController | pc.FlyController;
    constructor(readonly streaming: boolean) {
        this.controller = streaming ? new pc.FlyController() : new pc.OrbitController();
        this.controller.pitchRange = new pc.Vec2(-83, 83);
        if (this.controller instanceof pc.OrbitController) this.controller.zoomRange = new pc.Vec2(1, 15);
        this.reset();
    }

    reset(): void {
        this.clearInput();
        const eye = this.streaming ? new pc.Vec3(10.3, 2, -10)
            : new pc.Vec3(Math.sin(0.35)*Math.cos(0.2)*4, Math.sin(0.2)*4, Math.cos(0.35)*Math.cos(0.2)*4);
        this.pose.look(eye, this.streaming ? new pc.Vec3(12,3,0) : pc.Vec3.ZERO);
        this.controller.attach(this.pose, false);
    }

    attachControls(canvas: HTMLCanvasElement): void {
        this.canvas = canvas;
        const events = this.events = new AbortController();
        const options = { signal: events.signal };
        // Official KeyboardMouseSource listens on window. Attach it only while this canvas owns focus.
        const activate = () => {
            if (this.active) return;
            this.desktop.attach(canvas); this.touch.attach(canvas); this.active = true;
        };
        canvas.addEventListener('focus', activate, options);
        canvas.addEventListener('pointerdown', event => {
            canvas.focus({ preventScroll: true }); activate(); this.pointers.add(event.pointerId);
        }, { ...options, capture: true });
        canvas.addEventListener('wheel', () => {
            if (!this.streaming) { canvas.focus({ preventScroll: true }); activate(); }
        }, { ...options, capture: true });
        const end = (event: PointerEvent) => this.pointers.delete(event.pointerId);
        canvas.addEventListener('pointerup', end, options);
        canvas.addEventListener('pointercancel', end, options);
        canvas.addEventListener('lostpointercapture', end, options);
        canvas.addEventListener('blur', () => this.clearInput(), options);
        window.addEventListener('blur', () => this.clearInput(), options);
        if (document.activeElement === canvas) activate();
    }

    update(aspect: number, delta: number) {
        if (!this.active && this.canvas && document.activeElement === this.canvas && document.visibilityState !== 'hidden') {
            this.desktop.attach(this.canvas); this.touch.attach(this.canvas); this.active = true;
        }
        const { key, mouse, wheel } = this.desktop.read();
        const { touch, pinch } = this.touch.read();
        // Native sources report key transitions, as in the official CameraControls script.
        key.forEach((value, i) => this.keys[i] += value);
        const k = pc.KeyboardMouseSource.keyCode;
        if (this.streaming) {
            const move = new pc.Vec3(this.keys[k.D]-this.keys[k.A], this.keys[k.E]-this.keys[k.Q],
                this.keys[k.W]-this.keys[k.S]).normalize();
            move.mulScalar((this.keys[k.SHIFT] ? 15 : 4) * Math.min(0.05, Math.max(0, delta)));
            this.frame.deltas.move.append([move.x, move.y, move.z]);
        } else {
            this.frame.deltas.move.append([0, 0, wheel[0]*0.001 + pinch[0]*0.005]);
        }
        const sensitivity = 360 / Math.max(1, this.canvas?.getBoundingClientRect().height ?? 720);
        this.frame.deltas.rotate.append([(mouse[0]+touch[0])*sensitivity, (mouse[1]+touch[1])*sensitivity, 0]);
        this.pose.copy(this.controller.update(this.frame, Math.min(0.05, Math.max(0, delta))));
        const world = new pc.Mat4().setTRS(this.pose.position, new pc.Quat().setFromEulerAngles(this.pose.angles), pc.Vec3.ONE);
        return project(world, aspect, this.streaming);
    }

    clearInput(): void {
        this.desktop.detach(); this.touch.detach(); this.active = false;
        this.keys.fill(0); this.frame.read();
        for (const id of this.pointers) if (this.canvas?.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
        this.pointers.clear();
        // Discard residual damping on blur/suspension, retaining the visible pose.
        this.controller.attach(this.pose, false);
    }
    destroyControls(): void {
        this.clearInput(); this.events?.abort(); this.canvas = undefined;
        this.desktop.destroy(); this.touch.destroy(); this.controller.destroy();
    }
}
