

import * as SW from './ssfr_wgsl.js';
import * as CW from './ssfr_composite_wgsl.js';

const SPLAT_BYTES = 224;

const COMP_BYTES = 256;

export class FluidSSFR {
  constructor(device, format) {
    this.dev = device;
    this.format = format;

    this.ior = 1.333;
    this.absorption = 1.0;
    this.transmit = [0.35, 0.62, 0.78];
    this.roughness = 0.055;
    this.sunIntensity = 3.0;
    this.sunElevation = 38.0;
    this.sunAzimuth = 40.0;
    this.exposure = 1.0;
    this.groundReflection = 0.0;
    this.floorPlane = true;

    this.splatRadius = 1.0;

    this.renderScale = 1.0;

    this.filter = 2;
    this.filterSigma = 0.7;
    this.narrowDelta = 10.0;
    this.narrowMu = 1.0;
    this.bilateralRange = 2.0;
    this.filterIterations = 2;
    this.cleanupPass = true;
    this.cleanupRadius = 4;
    this.filterMaxRadius = 32;

    this.thicknessRadius = 0.62;
    this.thicknessScale = 3.0;
    this.thicknessFilterSize = 8;
    this.thicknessHalfRes = true;
    this.depthCullFraction = 0.0;
    this.depthCullNeighbours = 0;
    this.debug = 0;

    const splatMod = (src, label) => device.createShaderModule({
      code: SW.splatPrelude + src, label });
    const splatPipe = (module, targets, depth) => device.createRenderPipeline({
      label: 'ssfrSplat', layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets },

      primitive: { topology: 'triangle-strip' },
      depthStencil: depth,
    });
    this.pipeDepth = splatPipe(splatMod(SW.depthFS, 'ssfrDepth'),
      [{ format: 'r32float' }],
      { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' });
    this.pipeThick = splatPipe(splatMod(SW.thickFS, 'ssfrThick'),

      [{ format: 'r16float',
         blend: { color: { srcFactor: 'one', dstFactor: 'one' },
                  alpha: { srcFactor: 'one', dstFactor: 'one' } } }],
      undefined);

    const fullPipe = (code, label, fmt) => device.createRenderPipeline({
      label, layout: 'auto',
      vertex: { module: device.createShaderModule({ code, label }), entryPoint: 'vs' },
      fragment: { module: device.createShaderModule({ code, label: label + 'FS' }),
                  entryPoint: 'fs', targets: [{ format: fmt }] },
      primitive: { topology: 'triangle-list' },
    });
    this.pipeThickBlur = fullPipe(SW.thickFilterWGSL, 'ssfrThickBlur', 'r16float');
    this.pipeFilter = fullPipe(SW.filterWGSL, 'ssfrFilter', 'r32float');
    this.pipeComposite = fullPipe(CW.compositePrelude + CW.compositeFS,
                                  'ssfrComposite', format);
    this.pipeBodyT = fullPipe(CW.compositePrelude + CW.bodyDepthFS,
                              'ssfrSolidT', 'r32float');

    const uni = bytes => device.createBuffer({ size: bytes,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.splatUni = [uni(SPLAT_BYTES), uni(SPLAT_BYTES)];
    this.sF = new Float32Array(SPLAT_BYTES / 4);
    this.sU = new Uint32Array(this.sF.buffer);
    this.filtUni = [uni(48), uni(48), uni(48)];
    this.fF = new Float32Array(12);
    this.fI = new Int32Array(this.fF.buffer);
    this.blurUni = [uni(16), uni(16)];
    this.bI = new Int32Array(4);
    this.compUni = uni(COMP_BYTES);
    this.fallbackBodies = device.createBuffer({
      label: 'particles4all.ssfr.fallback-bodies', size: 96,
      usage: GPUBufferUsage.STORAGE,
    });
    this.cF = new Float32Array(COMP_BYTES / 4);
    this.cI = new Int32Array(this.cF.buffer);
    this.thickSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  }

  writeSplat(slot, view, proj, invViewProj, vw, vh, scale, quadRadius,
             thickRadius, maxNeighbours, skipBodies) {
    const F = this.sF, U = this.sU;
    F.set(view, 0);
    F.set(proj, 16);
    F.set(invViewProj, 32);
    F[48] = vw; F[49] = vh;
    F[50] = scale;
    F[51] = quadRadius;
    F[52] = thickRadius;
    F[53] = maxNeighbours;
    U[54] = skipBodies ? 1 : 0;
    F[55] = 0;
    this.dev.queue.writeBuffer(this.splatUni[slot], 0, this.sF);
  }

  writeFilt(slot, dirX, dirY, clean, proj11, viewH, r) {
    const F = this.fF, I = this.fI;
    I[0] = dirX; I[1] = dirY;
    I[2] = this.filterMaxRadius;
    I[3] = this.filter;
    F[4] = this.filterSigma * r;
    F[5] = proj11;
    F[6] = viewH;
    F[7] = this.narrowDelta * r;
    F[8] = this.narrowMu * r;
    F[9] = Math.max(this.bilateralRange * r, 1e-4);
    I[10] = clean;
    I[11] = this.cleanupRadius;
    this.dev.queue.writeBuffer(this.filtUni[slot], 0, this.fF);
  }

  prepareFrame(sim, mesh, solids, view, proj, invViewProj, invView, eye,
               width, height, spacing, support, particleCount = sim.n) {
    const rs = Math.min(1, Math.max(0.25, this.renderScale));
    const mapW = Math.max(1, Math.round(width * rs));
    const mapH = Math.max(1, Math.round(height * rs));
    const half = this.thicknessHalfRes && this.thicknessFilterSize >= 4;
    this.w = mapW;
    this.h = mapH;
    this.tw = half ? (mapW + 1) >> 1 : mapW;
    this.th = half ? (mapH + 1) >> 1 : mapH;
    const dev = this.dev;

    const el = this.sunElevation * Math.PI / 180, az = this.sunAzimuth * Math.PI / 180;
    const sun = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
    const sl = Math.hypot(...sun);
    const t = this.transmit.map(v => Math.min(1, Math.max(1e-3, v)));
    const absorb = t.map(v => this.absorption * -Math.log(v));

    const scale = this.splatRadius * spacing / support;
    const r = 0.5 * spacing;
    const thickRadius = this.thicknessRadius * spacing;
    const env = this.env;
    const skipBodies = sim.nBodyParts > 0;
    const bodyCount = solids?.count || 0;
    const bodies = solids?.count ? null : this.fallbackBodies;

    this.writeSplat(0, view, proj, invViewProj, mapW, mapH, scale, 0,
                    thickRadius, this.depthCullNeighbours, skipBodies);

    this.writeSplat(1, view, proj, invViewProj, this.tw, this.th, scale,
                    thickRadius, thickRadius, 0, skipBodies);
    {
      const F = this.cF, I = this.cI;
      F.set(invViewProj, 0);
      F.set(invView, 16);
      F.set([eye[0], eye[1], eye[2], 0], 32);
      F.set([0, 0, 0, proj[0]], 36);
      F.set([sim.params.box[0], sim.params.box[1], sim.params.box[2], proj[5]], 40);
      F.set([absorb[0], absorb[1], absorb[2], this.ior], 44);
      F.set([sun[0] / sl, sun[1] / sl, sun[2] / sl, this.sunIntensity], 48);
      F[52] = this.roughness;
      F[53] = this.exposure;
      F[54] = this.groundReflection;
      F[55] = this.thicknessScale;
      I[56] = bodyCount;
      I[57] = this.floorPlane ? 1 : 0;
      I[58] = this.debug;
      I[59] = env?.has ? 1 : 0;
      F[60] = env ? env.intensity : 1;
      F[61] = env ? env.yaw : 0;

      F[62] = mapW / Math.max(1, width);
      F[63] = mapH / Math.max(1, height);
      dev.queue.writeBuffer(this.compUni, 0, this.cF);
    }
    const blurSize = this.tw < this.w ? Math.max(1, this.thicknessFilterSize >> 1)
                                     : this.thicknessFilterSize;
    this.bI[2] = blurSize;
    for (let p = 0; p < 2; p++) {
      this.bI[0] = p === 0 ? 1 : 0;
      this.bI[1] = p === 0 ? 0 : 1;
      dev.queue.writeBuffer(this.blurUni[p], 0, this.bI);
    }

    this.writeFilt(0, 1, 0, 0, proj[5], mapH, r);
    this.writeFilt(1, 0, 1, 0, proj[5], mapH, r);
    this.writeFilt(2, 0, 0, 1, proj[5], mapH, r);

    return { bodyCount, bodies, env, mesh, sim, particleCount, src: 0 };
  }

  encodeSolidDistance(pass, frame, views) {
    const bind = this.dev.createBindGroup({
      layout: this.pipeBodyT.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.compUni } },
                { binding: 1, resource: { buffer: views.bodies || frame.bodies } }],
    });
    if (frame.bodyCount > 0) {
      pass.setPipeline(this.pipeBodyT);
      pass.setBindGroup(0, bind);
      pass.draw(3);
    }
  }

  encodeDepth(pass, frame, views) {
    const bind = this.dev.createBindGroup({
      layout: this.pipeDepth.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.splatUni[0] } },
                { binding: 1, resource: { buffer: views.smoothPosition } },
                { binding: 2, resource: { buffer: views.anisotropy } },
                { binding: 3, resource: { buffer: views.body } }],
    });
    pass.setPipeline(this.pipeDepth);
    pass.setBindGroup(0, bind);
    pass.draw(4, frame.particleCount);
  }

  encodeThickness(pass, frame, views) {
    const bind = this.dev.createBindGroup({
      layout: this.pipeThick.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.splatUni[1] } },
                { binding: 1, resource: { buffer: views.smoothPosition } },
                { binding: 2, resource: { buffer: views.anisotropy } },
                { binding: 3, resource: { buffer: views.body } }],
    });
    pass.setPipeline(this.pipeThick);
    pass.setBindGroup(0, bind);
    pass.draw(4, frame.particleCount);
  }

  encodeThicknessBlur(pass, frame, passIndex, views) {
    const bind = this.dev.createBindGroup({
      layout: this.pipeThickBlur.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.blurUni[passIndex] } },
                { binding: 1, resource: passIndex === 0 ? views.thick : views.thickTmp }],
    });
    pass.setPipeline(this.pipeThickBlur);
    pass.setBindGroup(0, bind);
    pass.draw(3);
  }

  encodeFilter(pass, slot, source) {
    const bind = this.dev.createBindGroup({
      layout: this.pipeFilter.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.filtUni[slot] } },
                { binding: 1, resource: source }],
    });
    pass.setPipeline(this.pipeFilter);
    pass.setBindGroup(0, bind);
    pass.draw(3);
  }

  encodeComposite(pass, frame, views) {
    const bind = this.dev.createBindGroup({
      layout: this.pipeComposite.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.compUni } },
                { binding: 1, resource: { buffer: views.bodies || frame.bodies } },
                { binding: 2, resource: views.eyeZ },
                { binding: 3, resource: views.raw },
                { binding: 4, resource: views.thick },
                { binding: 5, resource: views.bodyT },
                { binding: 6, resource: this.thickSampler },
                { binding: 7, resource: frame.env.view },
                { binding: 8, resource: frame.env.sampler }],
    });
    pass.setPipeline(this.pipeComposite);
    pass.setBindGroup(0, bind);
    pass.draw(3);
  }

}
