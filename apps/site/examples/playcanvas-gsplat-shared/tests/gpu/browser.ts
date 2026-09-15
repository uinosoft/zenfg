import * as pc from 'playcanvas';
import { createHostSupport } from '../../src/host.ts';
import { FrameGraph } from '@zenfg/webgpu';
import { createReferenceRenderer } from '../../../reference-renderer/src/index.ts';
import { PlayCanvasSplatBridge } from '../../src/bridge.ts';
import { cameraMatrices, ExampleCamera } from '../../src/camera.ts';
import { createComposite } from '../../src/composite.ts';
import { recordCoRendering } from '../../src/graph.ts';

const results: {name: string; ok: boolean; error?: string}[] = [];
const errors: string[] = [];
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const tick = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
async function read(device: GPUDevice, texture: GPUTexture) {
    const stride = Math.ceil(texture.width * 4 / 256) * 256;
    const buffer = device.createBuffer({ size: stride * texture.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: stride }, [texture.width, texture.height]);
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const result = new Uint8Array(buffer.getMappedRange().slice(0));
    buffer.unmap(); buffer.destroy();
    return { result, stride };
}
async function test(name: string, body: () => Promise<void>) {
    try { await body(); results.push({name,ok:true}); }
    catch(error) { results.push({name,ok:false,error:error instanceof Error ? error.stack : String(error)}); }
}

let info: unknown;
await test('real adapter is available', async () => {
    const adapter = await navigator.gpu.requestAdapter();
    assert(adapter && !adapter.info.isFallbackAdapter, 'A hardware WebGPU adapter is required.');
    info = {vendor:adapter.info.vendor, architecture:adapter.info.architecture, description:adapter.info.description};
});
let front: number[] = [], back: number[] = [];
for (const z of [1, -1]) await test(z > 0 ? 'foreground splats blend over opaque geometry' : 'background splats fail shared depth', async () => {
    const bridge = await PlayCanvasSplatBridge.create({ url: location.origin + '/fixture.ply?z=' + z,
        name: 'Synthetic splats', position: [0,0,0], rotation: [0,0,0], streaming:false }, 64, 48);
    const device = bridge.device;
    device.addEventListener('uncapturederror', event => errors.push(event.error.message));
    const graph = new FrameGraph(device), reference = createReferenceRenderer(device, { maxInstances: 1 });
    reference.setInstances([{ shape:'cube', color:[0.9,0.1,0.02],
        transform:new Float32Array([2,0,0,0, 0,2,0,0, 0,0,0.2,0, 0,0,0,1]) }]);
    const composite = createComposite(device,'rgba8unorm','fixture');
    let target: GPUTexture | undefined;
    try {
        for (const [width,height] of [[64,48],[48,64],[64,48]]) {
            target?.destroy();
            target = device.createTexture({format:'rgba8unorm',size:[width,height],usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
            bridge.resize(width,height);
            const matrices = cameraMatrices(new pc.Vec3(0,0,4),new pc.Vec3(0,0,0),width/height,false);
            bridge.syncCamera(matrices.world,matrices.projection,width/height);
            let frames = 0;
            do {
                const frame = graph.beginFrame();
                const handles = recordCoRendering(frame,bridge,reference,matrices.viewProjection,1/60,'fixture');
                const out = frame.importTexture(target);
                composite(frame,handles.color,handles.splatColor,out);
                frame.markOutput(out);
                const compiled = frame.compile({report:true});
                assert(compiled.compilationReport.nodes.length === 5,'Expected Reset, Cull, Draw, external and composite');
                compiled.execute();
                await tick();
            } while (++frames < 5 || (bridge.renderedSplats === 0 && frames < 180));
            assert(bridge.renderedSplats > 0, 'Synthetic splats should be loaded and rendered.');
            const {result,stride} = await read(device,target);
            const center = Array.from(result.slice(Math.floor(height/2)*stride+Math.floor(width/2)*4,
                Math.floor(height/2)*stride+Math.floor(width/2)*4+4));
            if(z>0) front=center; else back=center;
            assert(center[3] === 255,'Composite output must be opaque');
        }
    } finally { target?.destroy(); reference.destroy(); graph.destroy(); bridge.destroy(); bridge.destroy(); }
});
await test('occlusion changes real center pixels', async () => {
    assert(front.length === 4 && back.length === 4,'Both fixtures must render');
    assert(front[2] > back[2] + 40, 'Cyan foreground must increase blue over orange geometry: '+JSON.stringify({front,back}));
});
await test('preparation cancellation releases a late engine', async () => {
    const signal = new AbortController(); signal.abort();
    let rejected = false;
    try { await PlayCanvasSplatBridge.create({url:location.origin+'/fixture.ply',name:'cancelled',position:[0,0,0],rotation:[0,0,0],streaming:false},16,16,signal.signal); }
    catch { rejected = true; }
    assert(rejected,'Cancelled startup should reject');
});

await test('gamma composition preserves transparent edges and expected colors', async () => {
    const adapter = await navigator.gpu.requestAdapter(); assert(adapter, 'adapter');
    const device = await adapter.requestDevice();
    const graph = new FrameGraph(device);
    const texture = (usage: number) => device.createTexture({format:'rgba8unorm',size:[2,1],usage});
    const a=texture(GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST);
    const b=texture(GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST);
    const out=texture(GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC);
    device.queue.writeTexture({texture:a},new Uint8Array([64,128,192,255,64,128,192,255]),{bytesPerRow:8},[2,1]);
    device.queue.writeTexture({texture:b},new Uint8Array([0,0,0,0,64,32,16,128]),{bytesPerRow:8},[2,1]);
    try {
        const frame=graph.beginFrame();
        const target=frame.importTexture(out);
        createComposite(device,'rgba8unorm','color-test')(frame,frame.importTexture(a),frame.importTexture(b),target);
        frame.markOutput(target);frame.compile().execute();
        const {result}=await read(device,out);
        for(let pixel=0;pixel<2;pixel++)for(let channel=0;channel<3;channel++){
            const linear=[64,128,192][channel]/255;
            const gamma=pixel===0?Math.pow(linear,1/2.2):[64,32,16][channel]/255+Math.pow(linear,1/2.2)*(1-128/255);
            const value=Math.pow(gamma,2.2);
            const expected=Math.round((value<=0.0031308?12.92*value:1.055*Math.pow(value,1/2.4)-0.055)*255);
            assert(Math.abs(result[pixel*4+channel]-expected)<=2,'Incorrect gamma or alpha edge');
        }
    }finally{graph.destroy();a.destroy();b.destroy();out.destroy();device.destroy();}
});
await test('actual device loss stops scheduling and settles a pending snapshot', async () => {
    const adapter=await navigator.gpu.requestAdapter();assert(adapter,'adapter');
    const device=await adapter.requestDevice();const graph=new FrameGraph(device);
    const canvas=document.createElement('canvas');document.body.append(canvas);
    const camera=new ExampleCamera(false);let released=0;const failures:Error[]=[];
    const host=createHostSupport(canvas,device,graph,camera,{onError:e=>failures.push(e)},()=>{},()=>{released++;camera.destroyControls();graph.destroy();});
    host.requestFrame();const capture=host.controller.captureSnapshot();
    device.destroy();await device.lost;await Promise.resolve();
    assert(await capture===undefined,'Device loss must settle capture');
    assert(host.state.disposed&&host.state.animationFrame===0&&released===1&&failures.length===1,'Device loss must release the host exactly once');
    host.controller.dispose();canvas.remove();
});

(globalThis as any).__playCanvasGsplatGpuResult = {ok:results.every(r=>r.ok)&&errors.length===0,results,errors,info,front,back};
