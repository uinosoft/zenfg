import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import * as pc from 'playcanvas';
import { ExampleCamera } from '../src/camera.ts';

function fixture(streaming: boolean) {
    const browser = new Window();
    const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'window', { configurable:true, value:browser });
    Object.defineProperty(globalThis, 'document', { configurable:true, value:browser.document });
    const canvas = browser.document.createElement('canvas');
    canvas.tabIndex = 0;
    browser.document.body.append(canvas);
    const camera = new ExampleCamera(streaming);
    camera.attachControls(canvas as unknown as HTMLCanvasElement);
    const key = (code: string, down: boolean) => browser.dispatchEvent(new browser.KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
    const position = () => Array.from(camera.update(1.5, 1/60).world.data.slice(12,15));
    return { camera, canvas, browser, key, position, close() {
        camera.destroyControls(); browser.close();
        for(const [name, descriptor] of [['window',oldWindow],['document',oldDocument]] as const) {
            if(descriptor) Object.defineProperty(globalThis,name,descriptor); else Reflect.deleteProperty(globalThis,name);
        }
    } };
}
test('camera advances the actual PlayCanvas controller once per frame', t => {
    for(const streaming of [false,true]) {
        const f = fixture(streaming);
        try {
            const method = t.mock.method(streaming ? pc.FlyController.prototype : pc.OrbitController.prototype, 'update');
            f.position(); assert.equal(method.mock.callCount(),1);
            method.mock.restore();
        } finally { f.close(); }
    }
});
test('native fly input is focus-scoped, diagonals are normalized and blur stops damping', () => {
    const f=fixture(true);
    try {
        const initial=f.position();
        f.key('KeyW',true); assert.deepEqual(f.position(),initial); f.key('KeyW',false);
        function travel(keys:string[]) {
            f.camera.reset(); f.canvas.focus(); f.position();
            for(const key of keys)f.key(key,true);
            let end=initial;
            for(let i=0;i<60;i++)end=f.position();
            for(const key of keys)f.key(key,false);
            f.camera.clearInput();
            return Math.hypot(...end.map((v,i)=>v-initial[i]));
        }
        const straight=travel(['KeyW']), diagonal=travel(['KeyW','KeyD']);
        assert.ok(straight>1);
        assert.ok(Math.abs(straight-diagonal)<1e-4);
        f.canvas.focus(); f.position(); f.key('KeyW',true); f.position();
        f.canvas.blur();
        const stopped=f.position();
        for(let i=0;i<10;i++)assert.deepEqual(f.position(),stopped);
        f.canvas.focus(); assert.deepEqual(f.position(),stopped, 'refocus must not replay held keys');
    } finally {f.close();}
});
