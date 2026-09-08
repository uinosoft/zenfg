

import * as MS from './mesh_wgsl.js';
import { anisoWGSL } from './aniso_wgsl.js';

const WG = 256;

function dispatch2D(pass, count) {
  const groups = Math.ceil(count / WG);
  const gx = Math.min(groups, 32768);
  const gy = Math.ceil(groups / gx);
  pass.dispatchWorkgroups(gx, gy);
  return groups;
}

export class SurfaceMesh {
  constructor(device, format) {
    this.dev = device;
    this.format = format;
    this.maxTriangles = 3000000;
    this.normalSmoothPasses = 0;

    const mk = (src, label) => device.createShaderModule({
      code: MS.meshPrelude + src, label });
    const cp = (module, label) => device.createComputePipeline({
      label, layout: 'auto', compute: { module, entryPoint: 'main' } });
    this.pDensity = cp(mk(MS.meshDensityWGSL, 'meshDensity'), 'meshDensity');
    this.pSmooth = cp(mk(MS.meshSmoothWGSL, 'meshSmooth'), 'meshSmooth');
    this.pMarch = cp(mk(MS.meshMarchWGSL, 'meshMarch'), 'meshMarch');
    this.pIndirect = cp(mk(MS.meshIndirectWGSL, 'meshIndirect'), 'meshIndirect');

    this.pAniso = device.createComputePipeline({
      label: 'aniso', layout: 'auto',
      compute: { module: device.createShaderModule({ code: anisoWGSL, label: 'aniso' }),
                 entryPoint: 'main' } });
    this.anisoUni = device.createBuffer({ size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.aF = new Float32Array(20);
    this.aI = new Int32Array(this.aF.buffer);
    this.aU = new Uint32Array(this.aF.buffer);
    this.anisoCapacity = 0;
    this.anisoGen = 0;

    const dm = device.createShaderModule({ code: MS.meshDrawWGSL, label: 'meshDraw' });
    this.pipeDraw = device.createRenderPipeline({
      label: 'meshDraw', layout: 'auto',
      vertex: { module: dm, entryPoint: 'vs' },
      fragment: { module: dm, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });

    this.pipeSurf = device.createRenderPipeline({
      label: 'meshSurface', layout: 'auto',
      vertex: { module: dm, entryPoint: 'vs' },
      fragment: { module: dm, entryPoint: 'fsSurf',
                  targets: [{ format: 'r32float' }, { format: 'rgba16float' }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });

    this.uniAxis = [0, 1, 2].map(axis => device.createBuffer({
      label: `particles4all.mesh-uniform-axis-${axis}`,
      size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }));
    this.uni = this.uniAxis[0];
    this.uF = new Float32Array(28);
    this.uI = new Int32Array(this.uF.buffer);
    this.drawUni = device.createBuffer({ size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.drawF = new Float32Array(8);
    this.drawI = new Int32Array(this.drawF.buffer);
    this.resetReadbacks();

    this.anisoRatio = 4.0;
    this.anisoKs = 1.0;
    this.anisoStretch = 2.0;
    this.anisoLonely = 1.0;
    this.anisoMinNeighbours = 25;
    this.anisoLambda = 0.9;
    this.anisoRadiusScale = 2.0;

    this.anisoLimitToField = true;
    this.fieldCapacity = 0;
    this.vertCapacity = 0;

    this.gen = 0;
  }

  configure(boxMin, boxMax, resolution, maxTriangles = this.maxTriangles) {
    const size = [boxMax[0] - boxMin[0], boxMax[1] - boxMin[1], boxMax[2] - boxMin[2]];
    const longest = Math.max(...size);
    const voxel = longest / resolution;
    const voxelDim = size.map(s => Math.ceil(s / voxel) + 2);
    const vertDim = voxelDim.map(v => v + 1);
    const nVerts = vertDim[0] * vertDim[1] * vertDim[2];
    const fieldBytes = nVerts * 4;
    const vertBytes = maxTriangles * 3 * 8;
    if (fieldBytes > this.fieldCapacity) {
      this.fieldCapacity = 4 * Math.ceil((fieldBytes + fieldBytes / 4) / 4);
      this.gen++;
    }
    if (vertBytes !== this.vertCapacity) {
      this.vertCapacity = vertBytes;
      this.gen++;
    }
    this.boxMin = boxMin;
    this.voxel = voxel;
    this.vertDim = vertDim;
    this.nVerts = nVerts;
    this.vertBudget = maxTriangles;
    this.origin = [boxMin[0] - voxel, boxMin[1] - voxel, boxMin[2] - voxel];
  }

  setParams(sim, iso, axisIndex) {
    const axis = [axisIndex === 0 ? 1 : 0, axisIndex === 1 ? 1 : 0, axisIndex === 2 ? 1 : 0];
    const F = this.uF, I = this.uI;
    I[0] = this.vertDim[0]; I[1] = this.vertDim[1]; I[2] = this.vertDim[2];
    F[3] = this.voxel;
    F[4] = this.origin[0]; F[5] = this.origin[1]; F[6] = this.origin[2];
    F[7] = iso;
    F[8] = 0; F[9] = 0; F[10] = 0;
    F[11] = 1 / sim.h;
    I[12] = axis[0]; I[13] = axis[1]; I[14] = axis[2];
    F[15] = sim.h * sim.h;
    I[16] = sim.gridDim[0]; I[17] = sim.gridDim[1]; I[18] = sim.gridDim[2];
    F[19] = 315 / (64 * Math.PI * Math.pow(sim.h, 9));
    F[20] = sim.scene.mass;
    F[21] = sim.params.restDensity;
    I[22] = this.vertBudget;
    I[23] = sim.nBodyParts > 0 ? 1 : 0;
    this.dev.queue.writeBuffer(this.uniAxis[axisIndex], 0, this.uF);
  }

  prepareSurfaceFrame(sim, iso) {
    for (let axis = 0; axis < 3; axis++) this.setParams(sim, iso, axis);
    this.writeDrawUni();
  }

  prepareAnisotropy(sim, particleCount = sim.n) {
    const n = particleCount;
    if (n <= 0) return 0;
    const bytes = n * 2 * 4 * 4;
    if (bytes > this.anisoCapacity) { this.anisoCapacity = bytes; this.anisoGen++; }
    const support = sim.h;

    const radius = this.anisoRadiusScale * support;
    const cells = Math.ceil(this.anisoRadiusScale);

    const sigmaBulk = 0.15 * radius * radius;
    const F = this.aF, I = this.aI, U = this.aU;
    U[0] = n;
    F[1] = this.anisoLambda;
    F[2] = 1 / support;
    F[3] = support;
    F[4] = 0; F[5] = 0; F[6] = 0;
    F[7] = radius;
    I[8] = sim.gridDim[0]; I[9] = sim.gridDim[1]; I[10] = sim.gridDim[2];
    I[11] = cells;
    F[12] = this.anisoRatio;
    F[13] = this.anisoLonely;
    F[14] = this.anisoKs / sigmaBulk;
    F[15] = this.anisoStretch;
    F[16] = this.anisoLimitToField ? 1.25 * this.voxel / support : 0;
    I[17] = this.anisoMinNeighbours;
    this.dev.queue.writeBuffer(this.anisoUni, 0, this.aF);

    return n;
  }

  buildAnisotropy(pass, sim, preparedCount, buffers) {
    const n = preparedCount === undefined ? this.prepareAnisotropy(sim) : preparedCount;
    if (n <= 0) return;
    const bind = this.dev.createBindGroup({
      layout: this.pAniso.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.anisoUni } },
                { binding: 1, resource: { buffer: buffers.position } },
                { binding: 2, resource: { buffer: sim.buf.cellStart } },
                { binding: 3, resource: { buffer: buffers.smoothPosition } },
                { binding: 4, resource: { buffer: buffers.anisotropy } }],
    });
    pass.setPipeline(this.pAniso);
    pass.setBindGroup(0, bind);
    dispatch2D(pass, n);
  }

  encodeDensityField(pass, sim, buffers) {
    const s = buffers.parity === 0 ? 'A' : 'B';
    const bind = this.dev.createBindGroup({
      layout: this.pDensity.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: this.uniAxis[0] } },
        { binding: 1, resource: { buffer: sim.buf['pos' + s] } },
        { binding: 2, resource: { buffer: sim.buf.density } },
        { binding: 3, resource: { buffer: sim.buf.cellStart } },
        { binding: 4, resource: { buffer: buffers.field } },
        { binding: 5, resource: { buffer: sim.buf['body' + s] } }],
    });
    pass.setPipeline(this.pDensity);
    pass.setBindGroup(0, bind);
    dispatch2D(pass, this.nVerts);
  }

  encodeFieldBlur(pass, axis, source, destination) {
    const bind = this.dev.createBindGroup({
      layout: this.pSmooth.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: this.uniAxis[axis] } },
        { binding: 1, resource: { buffer: source } },
        { binding: 2, resource: { buffer: destination } }],
    });
    pass.setPipeline(this.pSmooth);
    pass.setBindGroup(0, bind);
    dispatch2D(pass, this.nVerts);
  }

  encodeNormalBlur(pass, axis, source, destination) {
    const bind = this.dev.createBindGroup({
      layout: this.pSmooth.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: this.uniAxis[axis] } },
        { binding: 1, resource: { buffer: source } },
        { binding: 2, resource: { buffer: destination } }],
    });
    pass.setPipeline(this.pSmooth);
    pass.setBindGroup(0, bind);
    dispatch2D(pass, this.nVerts);
  }

  encodeMarchingCubes(pass, buffers, normalFieldReady) {
    const bind = this.dev.createBindGroup({
      layout: this.pMarch.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: this.uniAxis[0] } },
        { binding: 1, resource: { buffer: buffers.field } },
        { binding: 2, resource: { buffer: buffers.vertices } },
        { binding: 3, resource: { buffer: buffers.counter } },
        { binding: 4, resource: { buffer: normalFieldReady ? buffers.normalField : buffers.field } }],
    });
    pass.setPipeline(this.pMarch);
    pass.setBindGroup(0, bind);
    const nvox = this.vertDim.map(v => v - 1);
    dispatch2D(pass, nvox[0] * nvox[1] * nvox[2]);
  }

  encodeIndirectArgs(pass, counter, indirect) {
    const bind = this.dev.createBindGroup({
      layout: this.pIndirect.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: this.uniAxis[0] } },
        { binding: 1, resource: { buffer: counter } },
        { binding: 2, resource: { buffer: indirect } }],
    });
    pass.setPipeline(this.pIndirect);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(1);
  }

  resetReadbacks() {
    if (this.destroyed) throw new Error('Particles4All surface mesh is disposed.');
    const ring = [];
    try {
      for (let i = 0; i < 3; i++) ring.push(this.dev.createBuffer({
        size: 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }));
    } catch (error) {
      for (const buffer of ring) buffer.destroy();
      throw error;
    }
    const previous = this.triRing || [];
    // Replacing the identity makes pending mappings from the previous scene stale.
    this.triRing = ring;
    this.triState = [0, 0, 0];
    this.frame = 0;
    this.lastTriangles = 0;
    for (const buffer of previous) buffer.destroy();
  }

  pollTriangles() {
    if (this.destroyed) return;
    for (let i = 0; i < 3; i++) {
      if (this.triState[i] !== 1) continue;
      this.triState[i] = 2;
      const buf = this.triRing[i];
      buf.mapAsync(GPUMapMode.READ).then(() => {
        if (this.triRing[i] !== buf) { buf.destroy(); return; }
        this.lastTriangles = new Uint32Array(buf.getMappedRange())[0];
        buf.unmap();
        this.triState[i] = 0;
      }).catch(() => { if (this.triRing[i] === buf) this.triState[i] = 0; });
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.gen++;
    const resources = new Set([...this.triRing, ...this.uniAxis, this.anisoUni, this.drawUni]);
    this.triRing = []; this.triState = []; this.uniAxis = [];
    this.uni = null; this.anisoUni = null; this.drawUni = null;
    for (const resource of resources) resource?.destroy?.();
  }

  resizeSurface(w, h) {
    this.surfW = w; this.surfH = h;
    this.writeDrawUni();
  }

  surfBind(viewUni, vertices) {
    return this.dev.createBindGroup({
      layout: this.pipeSurf.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: viewUni } },
                { binding: 1, resource: { buffer: this.drawUni } },
                { binding: 2, resource: { buffer: vertices } }],
    });
  }

  drawSurface(pass, viewUni, vertices, indirect) {
    pass.setPipeline(this.pipeSurf);
    pass.setBindGroup(0, this.surfBind(viewUni, vertices));
    pass.drawIndirect(indirect, 0);
    return true;
  }

  writeDrawUni() {
    this.drawF[0] = this.origin[0]; this.drawF[1] = this.origin[1];
    this.drawF[2] = this.origin[2]; this.drawF[3] = this.voxel;
    this.drawI[4] = this.vertDim[0]; this.drawI[5] = this.vertDim[1];
    this.drawI[6] = this.vertDim[2];
    this.dev.queue.writeBuffer(this.drawUni, 0, this.drawF);
  }

  drawBind(viewUni, vertices) {
    return this.dev.createBindGroup({
      layout: this.pipeDraw.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: viewUni } },
                { binding: 1, resource: { buffer: this.drawUni } },
                { binding: 2, resource: { buffer: vertices } }],
    });
  }

  draw(pass, viewUni, vertices, indirect) {
    pass.setPipeline(this.pipeDraw);
    pass.setBindGroup(0, this.drawBind(viewUni, vertices));
    pass.drawIndirect(indirect, 0);
  }
}
