import { TextureAccess, type FrameGraphRecording } from '@zenfg/webgpu';
import type { BackgroundResources } from './resources.ts';

/** Flow field -> HDR lattice -> bloom extraction -> blur -> tone mapping. */
export function recordBackground(recorder: FrameGraphRecording, resources: BackgroundResources,
    size: { width: number; height: number; fieldWidth: number; fieldHeight: number; bloomWidth: number; bloomHeight: number }) {
    const { context, format, linearSampler, pipelines, uniformBuffer } = resources;
    const flowField = recorder.createTexture({
        label: 'interactive-flow-field',
        format: 'rgba8unorm',
        size: [size.fieldWidth, size.fieldHeight],
    });
    const hdrScene = recorder.createTexture({
        label: 'hdr-lattice-scene-color',
        format: 'rgba16float',
        size: [size.width, size.height],
    });
    const bloomSeed = recorder.createTexture({
        label: 'half-resolution-bloom-seed',
        format: 'rgba16float',
        size: [size.bloomWidth, size.bloomHeight],
    });
    const bloomSoft = recorder.createTexture({
        label: 'half-resolution-soft-bloom',
        format: 'rgba16float',
        size: [size.bloomWidth, size.bloomHeight],
    });
    const backbuffer = recorder.importSwapchainTexture(context.getCurrentTexture(), {
        label: `background-${format}-backbuffer`,
    });

    const flowWrite = recorder.use(flowField, TextureAccess.StorageWrite, { contents: 'overwrite' });
    recorder.compute({
        label: '01 · advect flow field',
        uses: [flowWrite],
        encode: ({ device, pass, unwrap }) => {
            pass.setPipeline(pipelines.flow);
            pass.setBindGroup(0, device.createBindGroup({
                layout: pipelines.flow.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: unwrap(flowWrite) },
                ],
            }));
            pass.dispatchWorkgroups(Math.ceil(size.fieldWidth / 8), Math.ceil(size.fieldHeight / 8));
        },
    });

    const flowSample = recorder.use(flowField, TextureAccess.Sampled);
    recorder.render({
        label: '02 · resolve HDR luminous lattice',
        uses: [flowSample],
        colorAttachments: [{
            target: hdrScene,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0.0025, g: 0.0045, b: 0.0075, a: 1 },
        }],
        encode: ({ device, pass, unwrap }) => {
            pass.setPipeline(pipelines.lattice);
            pass.setBindGroup(0, device.createBindGroup({
                layout: pipelines.lattice.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: unwrap(flowSample) },
                ],
            }));
            pass.draw(3);
        },
    });

    const bloomSceneSample = recorder.use(hdrScene, TextureAccess.Sampled);
    recorder.render({
        label: '03 · extract & downsample bloom',
        uses: [bloomSceneSample],
        colorAttachments: [{
            target: bloomSeed,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }],
        encode: ({ device, pass, unwrap }) => {
            pass.setPipeline(pipelines.bloomExtract);
            pass.setBindGroup(0, device.createBindGroup({
                layout: pipelines.bloomExtract.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: unwrap(bloomSceneSample) },
                ],
            }));
            pass.draw(3);
        },
    });

    const bloomSeedSample = recorder.use(bloomSeed, TextureAccess.Sampled);
    recorder.render({
        label: '04 · soften bloom',
        uses: [bloomSeedSample],
        colorAttachments: [{
            target: bloomSoft,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }],
        encode: ({ device, pass, unwrap }) => {
            pass.setPipeline(pipelines.bloomBlur);
            pass.setBindGroup(0, device.createBindGroup({
                layout: pipelines.bloomBlur.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: linearSampler },
                    { binding: 1, resource: unwrap(bloomSeedSample) },
                ],
            }));
            pass.draw(3);
        },
    });

    const hdrSceneSample = recorder.use(hdrScene, TextureAccess.Sampled);
    const bloomSample = recorder.use(bloomSoft, TextureAccess.Sampled);
    recorder.render({
        label: '05 · tone map & present',
        uses: [hdrSceneSample, bloomSample],
        colorAttachments: [{
            target: backbuffer,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0.008, g: 0.014, b: 0.022, a: 1 },
        }],
        encode: ({ device, pass, unwrap }) => {
            pass.setPipeline(pipelines.composite);
            pass.setBindGroup(0, device.createBindGroup({
                layout: pipelines.composite.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: unwrap(hdrSceneSample) },
                    { binding: 2, resource: unwrap(bloomSample) },
                    { binding: 3, resource: linearSampler },
                ],
            }));
            pass.draw(3);
        },
    });


    return backbuffer;
}
