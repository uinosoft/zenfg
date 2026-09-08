

import * as S from './wgsl.js';
import { buildScene, boundaryFor } from './scene.js';

const WG = 256;
const groups = n => Math.max(1, Math.ceil(n / WG));

export class Sim {
  constructor(device) {
    this.dev = device;
    this.buf = {};
    this.pipe = {};
    this.stats = { avgRho: 1, maxRho: 1, maxSpeed: 0, frames: 0 };
    this.simTime = 0;
    this.compilePipelines();
  }

  compilePipelines() {
    const dev = this.dev;
    const make = (name, src, entry = 'main') => {
      const module = dev.createShaderModule({ code: S.prelude + src, label: name });
      this.pipe[name] = dev.createComputePipeline({
        label: name, layout: 'auto', compute: { module, entryPoint: entry },
      });
    };
    make('predict', S.predictWGSL);
    make('velFromPos', S.velFromPosWGSL);
    make('xsph', S.xsphWGSL);
    make('finalize', S.finalizeWGSL);
    make('normals', S.normalsWGSL);
    make('tension', S.tensionWGSL);

    {
      const module = dev.createShaderModule({ code: S.impulseWGSL, label: 'impulse' });
      this.pipe.impulse = dev.createComputePipeline({
        label: 'impulse', layout: 'auto', compute: { module, entryPoint: 'main' } });
    }

    {
      const module = dev.createShaderModule({ code: S.bodyDragWGSL, label: 'bodyDrag' });
      this.pipe.bodyDrag = dev.createComputePipeline({
        label: 'bodyDrag', layout: 'auto', compute: { module, entryPoint: 'main' } });
    }
    make('count', S.countWGSL);
    make('scanBlock', S.scanBlockWGSL);
    make('scanBlocks', S.scanBlocksWGSL);
    make('scanAdd', S.scanAddWGSL);
    make('scatterSlot', S.scatterSlotWGSL);
    make('scatterMove', S.scatterMoveWGSL);
    make('scatterPhase', S.scatterPhaseWGSL);
    make('lambda', S.lambdaWGSL);
    make('delta', S.deltaWGSL);
    make('bodyClear', S.bodyClearWGSL);
    make('bodyRefLoad', S.bodyRefLoadWGSL);
    make('bodyCompact', S.bodyCompactWGSL);
    make('bodyCentre', S.bodyCentreWGSL);
    make('bodySeed', S.bodySeedWGSL);
    make('bodyCov', S.bodyCovWGSL);
    make('bodyResolve', S.bodyResolveWGSL);
    make('bodyProject', S.bodyProjectWGSL);
    make('stats', S.statsWGSL);
  }

  reset(params, sc = buildScene(params)) {
    if (this.destroyed) throw new Error('Particles4All simulation is disposed.');
    const dev = this.dev;
    for (const resource of [
      ...(this.statsRing || []), ...(this.poseRing || []), ...(this.frameUni || []),
      this.uni, this.rayUni, this.dragUni, this.resizeUni,
    ]) resource?.destroy?.();
    this.statsRing = [];
    this.poseRing = [];
    this.frameUni = [];
    this.uni = null;
    this.rayUni = null;
    this.dragUni = null;
    this.resizeUni = null;
    this.params = params;
    this.scene = sc;
    this.simTime = 0;

    this.gen = (this.gen || 0) + 1;

    const n = sc.n;
    const h = sc.h;
    this.h = h;
    const box = params.box;

    this.gridDim = [
      Math.max(1, Math.floor(box[0] / h)),
      Math.max(1, Math.floor(box[1] / h)),
      Math.max(1, Math.floor(box[2] / h)),
    ];
    this.nCells = this.gridDim[0] * this.gridDim[1] * this.gridDim[2];

    for (const b of Object.values(this.buf)) b?.destroy?.();
    this.buf = {};

    const ST = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC;
    const alloc = (name, bytes, usage = ST | GPUBufferUsage.COPY_DST) =>
      this.buf[name] = dev.createBuffer({ label: name, size: Math.max(16, bytes), usage });

    this.pourBudget = params.pour === false ? 0 : sc.nFluid;
    const cap = n + this.pourBudget;
    this.cap = cap;
    const vec4 = cap * 16;
    for (const s of ['A', 'B']) {
      alloc('pos' + s, vec4); alloc('vel' + s, vec4);
      alloc('body' + s, vec4); alloc('rest' + s, vec4);
    }
    alloc('density', cap * 4);
    alloc('cellStart', (this.nCells + 2) * 4);

    const nb = sc.boundary.count;
    this.nBoundary = nb;
    const bpos = new Float32Array(Math.max(1, nb) * 4);
    for (let i = 0; i < nb; i++) {
      bpos[i * 4 + 0] = sc.boundary.pts[i * 3 + 0];
      bpos[i * 4 + 1] = sc.boundary.pts[i * 3 + 1];
      bpos[i * 4 + 2] = sc.boundary.pts[i * 3 + 2];
    }

    const { sortedPos, sortedPsi, cellStart } = this.sortBoundary(bpos, sc.boundary.psi, nb);
    alloc('bpos', Math.max(1, nb) * 16);
    alloc('bpsi', Math.max(1, nb) * 4);
    alloc('bcellStart', (this.nCells + 2) * 4);
    dev.queue.writeBuffer(this.buf.bpos, 0, sortedPos);
    dev.queue.writeBuffer(this.buf.bpsi, 0, sortedPsi);
    dev.queue.writeBuffer(this.buf.bcellStart, 0, cellStart);

    const nBodies = sc.bodies.length;
    this.nBodies = nBodies;
    this.nBodyParts = sc.nBody;
    alloc('bodyCentre', Math.max(1, nBodies) * 16,
          ST | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    alloc('bodyRef', Math.max(1, nBodies) * 16,
          ST | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    alloc('bodyRot', Math.max(1, nBodies) * 3 * 16);
    alloc('bodyInfo', Math.max(1, nBodies) * 16);
    if (nBodies) {
      const info = new Float32Array(nBodies * 4);
      const centre = new Float32Array(nBodies * 4);
      sc.bodies.forEach((b, i) => {
        info[i * 4] = 1 / Math.max(1e-6, b.density);
        centre[i * 4 + 0] = b.centre[0];
        centre[i * 4 + 1] = b.centre[1];
        centre[i * 4 + 2] = b.centre[2];
      });
      dev.queue.writeBuffer(this.buf.bodyInfo, 0, info);
      dev.queue.writeBuffer(this.buf.bodyCentre, 0, centre);
      dev.queue.writeBuffer(this.buf.bodyRef, 0, centre);

      const rot = new Float32Array(nBodies * 12);
      for (let i = 0; i < nBodies; i++)
        for (let r = 0; r < 3; r++) rot[i * 12 + r * 4 + r] = 1;
      dev.queue.writeBuffer(this.buf.bodyRot, 0, rot);
    }

    let maxCount = 1, maxRest = 1e-3;
    for (const b of sc.bodies) maxCount = Math.max(maxCount, b.count);
    for (let i = 0; i < sc.n; i++) {
      const r = Math.hypot(sc.rest[i * 4], sc.rest[i * 4 + 1], sc.rest[i * 4 + 2]);
      if (r > maxRest) maxRest = r;
    }
    const extent = Math.max(...box);
    this.bodyScale = 1e9 / (extent * maxCount);
    this.covScale = 1e9 / (extent * maxRest * maxCount);

    this.poseBytes = Math.max(1, nBodies) * 16 * 4;
    this.statsRing = Array.from({ length: 3 }, () => dev.createBuffer({
      size: 32, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }));
    this.poseRing = Array.from({ length: 3 }, () => dev.createBuffer({
      size: this.poseBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }));
    this.statsState = [0, 0, 0];
    this.poseState = [0, 0, 0];
    this.statsFrame = 0;
    this.poseFrame = 0;
    this.statsReadbackSlot = -1;
    this.poseReadbackSlot = -1;

    this.bodyPose = sc.bodies.map(b => ({
      centre: [b.centre[0], b.centre[1], b.centre[2]],
      rot: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    }));

    this.bodies = sc.bodies;

    dev.queue.writeBuffer(this.buf.posA, 0, sc.pos);
    dev.queue.writeBuffer(this.buf.velA, 0, sc.vel);
    dev.queue.writeBuffer(this.buf.bodyA, 0, sc.phase);
    dev.queue.writeBuffer(this.buf.restA, 0, sc.rest);

    this.n = n;
    this.parity = 0;
    this.predParity = 0;

    this.uni = dev.createBuffer({ size: 192,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.uniF = new Float32Array(48);
    this.rayUni = dev.createBuffer({ size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.rayF = new Float32Array(12);

    this.dragUni = dev.createBuffer({ size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.dragF = new Float32Array(8);
    this.dragU = new Uint32Array(this.dragF.buffer);
    this.heldBody = -1;
    this.heldTarget = [0, 0, 0];
    this.heldRate = 10;
    this.heldLimit = 4;
    this.uniI = new Int32Array(this.uniF.buffer);
    this.uploadParams(1 / 240);

    this.primePending = true;
    this.pendingImpulse = false;
    this.pendingResizeBindGroup = null;
    this.statsReadbackArmed = false;
    this.poseReadbackArmed = false;
  }

  sortBoundary(bpos, psi, nb) {
    const dim = this.gridDim, h = this.h, box = this.params.box;
    const counts = new Uint32Array(this.nCells + 2);
    const cellOf = (x, y, z) => {
      const c = [
        Math.min(dim[0] - 1, Math.max(0, Math.floor(x / h))),
        Math.min(dim[1] - 1, Math.max(0, Math.floor(y / h))),
        Math.min(dim[2] - 1, Math.max(0, Math.floor(z / h))),
      ];
      return (c[2] * dim[1] + c[1]) * dim[0] + c[0];
    };
    const cell = new Uint32Array(nb);
    for (let i = 0; i < nb; i++) {
      cell[i] = cellOf(bpos[i * 4], bpos[i * 4 + 1], bpos[i * 4 + 2]);
      counts[cell[i]]++;
    }
    const start = new Uint32Array(this.nCells + 2);
    let run = 0;
    for (let c = 0; c <= this.nCells; c++) { start[c] = run; run += counts[c] || 0; }
    start[this.nCells + 1] = run;
    const cursor = start.slice();
    const sortedPos = new Float32Array(Math.max(1, nb) * 4);
    const sortedPsi = new Float32Array(Math.max(1, nb));
    for (let i = 0; i < nb; i++) {
      const s = cursor[cell[i]]++;
      sortedPos[s * 4 + 0] = bpos[i * 4 + 0];
      sortedPos[s * 4 + 1] = bpos[i * 4 + 1];
      sortedPos[s * 4 + 2] = bpos[i * 4 + 2];
      sortedPsi[s] = psi[i];
    }
    return { sortedPos, sortedPsi, cellStart: start };
  }

  bg(pipeName, buffers, uniform = this.uni) {
    const entries = [{ binding: 0, resource: { buffer: uniform } }];
    buffers.forEach((b, i) => entries.push({ binding: i + 1, resource: { buffer: b } }));
    return this.dev.createBindGroup({
      layout: this.pipe[pipeName].getBindGroupLayout(0), entries });
  }

  bgNoUni(pipeName, buffers) {
    const entries = [];
    buffers.forEach((b, i) => entries.push({ binding: i + 1, resource: { buffer: b } }));
    return this.dev.createBindGroup({
      layout: this.pipe[pipeName].getBindGroupLayout(0), entries });
  }

  uploadParams(dt, particleCount = this.n, target = this.uni) {
    const p = this.params, F = this.uniF, I = this.uniI;
    const h = this.h, d = p.spacing;
    const box = p.box;
    F[0] = 0; F[1] = 0; F[2] = 0; F[3] = dt;
    F[4] = box[0]; F[5] = box[1]; F[6] = box[2]; F[7] = h;
    I[8] = this.gridDim[0]; I[9] = this.gridDim[1]; I[10] = this.gridDim[2];
    F[11] = h * h;
    const halfD = 0.5 * d;
    F[12] = halfD; F[13] = halfD; F[14] = halfD;
    F[15] = 315 / (64 * Math.PI * Math.pow(h, 9));
    F[16] = box[0] - halfD; F[17] = box[1] - halfD; F[18] = box[2] - halfD;
    F[19] = -45 / (Math.PI * Math.pow(h, 6));
    F[20] = p.gravity;
    F[21] = this.scene.mass;
    F[22] = p.restDensity;
    F[23] = 1 / p.restDensity;

    F[24] = Math.max(1e-9, p.cfmEpsilonRel * this.scene.denomRest);

    F[25] = p.sCorrK / (this.scene.denomRest * Math.max(1, p.iterations));

    const rq = p.sCorrDq * h;
    const tq = h * h - rq * rq;
    const wq = (315 / (64 * Math.PI * Math.pow(h, 9))) * tq * tq * tq;
    F[26] = wq > 0 ? 1 / wq : 0;
    F[27] = p.xsphC;
    I[28] = particleCount;
    I[29] = this.nCells;
    I[30] = p.noBoundary ? 0 : this.nBoundary;
    I[31] = this.nBodyParts;
    I[32] = this.nBodies;
    F[33] = this.bodyScale;
    F[34] = this.covScale;
    F[35] = p.omega;
    I[36] = p.sorAverage ? 1 : 0;
    F[37] = dt > 0 ? 1 / dt : 0;
    F[38] = this.scene.mass / p.restDensity;
    F[39] = p.surfaceTensionK;
    F[40] = 32 / (Math.PI * Math.pow(h, 9));
    F[41] = Math.pow(h, 6) / 64;
    this.dev.queue.writeBuffer(target, 0, this.uniF);
  }

  prepareFrameUniforms(dt, particleCounts) {
    while (this.frameUni.length < particleCounts.length) {
      this.frameUni.push(this.dev.createBuffer({
        label: `simulation-frame-uniform-${this.frameUni.length}`,
        size: 192,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }));
    }
    for (let i = 0; i < particleCounts.length; i++) {
      this.uploadParams(dt, particleCounts[i], this.frameUni[i]);
    }
    return this.frameUni.slice(0, particleCounts.length);
  }

  planFrame(frameDt) {
    const p = this.params;
    const base = Math.max(1, p.substeps);
    const dtTarget = (1 / 60) / base;
    this.timeBank = (this.timeBank || 0) + frameDt;
    let sub = Math.floor(this.timeBank / dtTarget + 1e-4);
    const workCap = base * 8;
    if (sub > workCap) { sub = workCap; this.timeBank = 0; }
    else { this.timeBank -= sub * dtTarget; }

    this.lastSubsteps = sub;
    this.lastAdvanced = sub * dtTarget;
    if (sub < 1) {
      this.lastAdvanced = 0;
      return { substeps: 0, dt: dtTarget };
    }
    const dt = dtTarget;
    this.uploadParams(dt);
    const dev = this.dev;
    const dragging = this.heldBody >= 1 && this.nBodyParts > 0;
    if (dragging) {
      const F = this.dragF, U = this.dragU;
      F[0] = this.heldTarget[0];
      F[1] = this.heldTarget[1];
      F[2] = this.heldTarget[2];
      F[3] = this.heldRate;
      U[4] = this.heldBody;
      F[5] = 1 - Math.exp(-Math.max(dt, 0) / 0.02);
      F[6] = this.heldLimit;
      U[7] = this.nBodyParts;
      dev.queue.writeBuffer(this.dragUni, 0, F);
    }
    return { substeps: sub, dt };
  }

  encodePredict(pass, par, B, activeCount = this.n, uniform = this.uni) {
    const nG = groups(activeCount);
    const bG = groups(Math.max(1, this.nBodyParts));
    const dragging = this.heldBody >= 1 && this.nBodyParts > 0;
    if (dragging) {
      pass.setPipeline(this.pipe.bodyDrag);
      pass.setBindGroup(0, this.dev.createBindGroup({
        layout: this.pipe.bodyDrag.getBindGroupLayout(0), entries: [
          { binding: 0, resource: { buffer: this.dragUni } },
          { binding: 1, resource: { buffer: B['vel' + (par === 0 ? 'A' : 'B')] } },
          { binding: 2, resource: { buffer: B['body' + (par === 0 ? 'A' : 'B')] } },
          { binding: 3, resource: { buffer: B.bodyIdx } },
          { binding: 4, resource: { buffer: B.bodyCentre } }],
      }));
      pass.dispatchWorkgroups(bG);
    }
    pass.setPipeline(this.pipe.predict);
    const s = par === 0 ? 'A' : 'B';
    pass.setBindGroup(0, this.bg('predict', [B['pos' + s], B['vel' + s], B['pred' + s]], uniform));
    pass.dispatchWorkgroups(nG);
  }

  encodeGridCount(pass, par, B, activeCount = this.n, uniform = this.uni) {
    const nG = groups(activeCount);
    pass.setPipeline(this.pipe.count);
    const s = par === 0 ? 'A' : 'B';
    pass.setBindGroup(0, this.bg('count', [B['pred' + s], B.cellCount], uniform));
    pass.dispatchWorkgroups(nG);
  }

  encodeGridScan(pass, B, uniform = this.uni) {
    const run = (name, bind, n) => {
      pass.setPipeline(this.pipe[name]); pass.setBindGroup(0, bind);
      pass.dispatchWorkgroups(n);
    };
    run('scanBlock', this.bg('scanBlock', [B.cellCount, B.cellStart, B.blockSum], uniform), groups(this.nCells));
    run('scanBlocks', this.bg('scanBlocks', [B.blockSum], uniform), 1);
    run('scanAdd', this.bg('scanAdd', [B.cellStart, B.blockSum], uniform), groups(this.nCells + 1));
  }

  encodeGridScatter(pass, par, B, activeCount = this.n, uniform = this.uni) {
    const nG = groups(activeCount);
    const run = (name, bind) => {
      pass.setPipeline(this.pipe[name]); pass.setBindGroup(0, bind);
      pass.dispatchWorkgroups(nG);
    };
    const s = par === 0 ? 'A' : 'B', o = par === 0 ? 'B' : 'A';
    run('scatterSlot', this.bg('scatterSlot', [B['pred' + s], B.cellStart, B.cursor, B.slot], uniform));
    run('scatterMove', this.bg('scatterMove', [
      B.slot, B['pos' + s], B['vel' + s], B['pred' + s],
      B['pos' + o], B['vel' + o], B['pred' + o]], uniform));
    run('scatterPhase', this.bg('scatterPhase', [
      B.slot, B['body' + s], B['rest' + s], B['body' + o], B['rest' + o]], uniform));
  }

  encodeRigidPreparation(pass, par, pp, B, activeCount = this.n, uniform = this.uni) {
    const s = par === 0 ? 'A' : 'B', ps = pp === 0 ? 'A' : 'B';
    pass.setPipeline(this.pipe.bodyClear);
    pass.setBindGroup(0, this.bgNoUni('bodyClear', [B.bodyAccum, B.bodyCov, B.bodyIdxCount]));
    pass.dispatchWorkgroups(groups(Math.max(4, this.nBodies * 9)));
    pass.setPipeline(this.pipe.bodyCompact);
    pass.setBindGroup(0, this.bg('bodyCompact', [B['body' + s], B.bodyIdx, B.bodyIdxCount], uniform));
    pass.dispatchWorkgroups(groups(activeCount));
    pass.setPipeline(this.pipe.bodyCentre);
    pass.setBindGroup(0, this.bg('bodyCentre', [
      B['pred' + ps], B['body' + s], B.bodyAccum, B.bodyIdx, B.bodyCentre], uniform));
    pass.dispatchWorkgroups(groups(Math.max(1, this.nBodyParts)));
    pass.setPipeline(this.pipe.bodySeed);
    pass.setBindGroup(0, this.bg('bodySeed', [B.bodyAccum, B.bodyRef, B.bodyCentre], uniform));
    pass.dispatchWorkgroups(1);
    pass.setPipeline(this.pipe.bodyRefLoad);
    pass.setBindGroup(0, this.bgNoUni('bodyRefLoad', [B.bodyRef, B.bodyCentre]));
    pass.dispatchWorkgroups(1);
  }

  encodeLambda(pass, par, pp, B, activeCount = this.n, uniform = this.uni) {
    const nG = groups(activeCount);
    pass.setPipeline(this.pipe.lambda);
    const ps = pp === 0 ? 'A' : 'B';
    pass.setBindGroup(0, this.bg('lambda', [
      B['pred' + ps], B.lambda, B.density, B.cellStart, B.bpos, B.bpsi, B.bcellStart], uniform));
    pass.dispatchWorkgroups(nG);
  }

  encodeDelta(pass, par, pp, B, activeCount = this.n, uniform = this.uni) {
    const nG = groups(activeCount);
    pass.setPipeline(this.pipe.delta);
    const ps = pp === 0 ? 'A' : 'B', po = pp === 0 ? 'B' : 'A';
    pass.setBindGroup(0, this.bg('delta', [
      B['pred' + ps], B['pred' + po], B.lambda, B.cellStart, B.bpos, B.bpsi, B.bcellStart], uniform));
    pass.dispatchWorkgroups(nG);
  }

  encodeRigidProjection(pass, par, pp, B, activeCount = this.n, uniform = this.uni) {
    const s = par === 0 ? 'A' : 'B', ps = pp === 0 ? 'A' : 'B';
    const bG = groups(Math.max(1, this.nBodyParts));
    const bClearG = groups(Math.max(4, this.nBodies * 9));
    pass.setPipeline(this.pipe.bodyClear);
    pass.setBindGroup(0, this.bgNoUni('bodyClear', [B.bodyAccum, B.bodyCov, B.bodyIdxCount]));
    pass.dispatchWorkgroups(bClearG);
    pass.setPipeline(this.pipe.bodyCentre);
    pass.setBindGroup(0, this.bg('bodyCentre', [
      B['pred' + ps], B['body' + s], B.bodyAccum, B.bodyIdx, B.bodyCentre], uniform));
    pass.dispatchWorkgroups(bG);
    pass.setPipeline(this.pipe.bodySeed);
    pass.setBindGroup(0, this.bg('bodySeed', [B.bodyAccum, B.bodyRef, B.bodyCentre], uniform));
    pass.dispatchWorkgroups(1);
    pass.setPipeline(this.pipe.bodyCov);
    pass.setBindGroup(0, this.bg('bodyCov', [
      B['pred' + ps], B['body' + s], B.bodyCov, B.bodyRef, B['rest' + s], B.bodyIdx], uniform));
    pass.dispatchWorkgroups(bG);
    pass.setPipeline(this.pipe.bodyResolve);
    pass.setBindGroup(0, this.bg('bodyResolve', [
      B.bodyAccum, B.bodyCov, B.bodyCentre, B.bodyRot, B.bodyInfo], uniform));
    pass.dispatchWorkgroups(1);
    pass.setPipeline(this.pipe.bodyProject);
    pass.setBindGroup(0, this.bg('bodyProject', [
      B['pred' + ps], B['body' + s], B.bodyCentre, B.bodyRot, B['rest' + s], B.bodyIdx], uniform));
    pass.dispatchWorkgroups(bG);
  }

  encodeVelocity(pass, par, B, activeCount = this.n, uniform = this.uni) {
    pass.setPipeline(this.pipe.velFromPos);
    const s = par === 0 ? 'A' : 'B';
    pass.setBindGroup(0, this.bg('velFromPos', [B['pos' + s], B['vel' + s], B['pred' + s]], uniform));
    pass.dispatchWorkgroups(groups(activeCount));
  }

  encodeXsph(pass, par, B, activeCount = this.n, uniform = this.uni) {
    pass.setPipeline(this.pipe.xsph);
    const s = par === 0 ? 'A' : 'B';
    pass.setBindGroup(0, this.bg('xsph', [
      B['pred' + s], B['vel' + s], B.density, B.corr, B.cellStart], uniform));
    pass.dispatchWorkgroups(groups(activeCount));
  }

  encodeNormals(pass, par, B, activeCount = this.n, uniform = this.uni) {
    pass.setPipeline(this.pipe.normals);
    const s = par === 0 ? 'A' : 'B';
    pass.setBindGroup(0, this.bg('normals', [B['pred' + s], B.density, B.normal, B.cellStart], uniform));
    pass.dispatchWorkgroups(groups(activeCount));
  }

  encodeTension(pass, par, B, activeCount = this.n, uniform = this.uni) {
    pass.setPipeline(this.pipe.tension);
    const s = par === 0 ? 'A' : 'B';
    pass.setBindGroup(0, this.bg('tension', [
      B['pred' + s], B.density, B.normal, B.corr, B.cellStart], uniform));
    pass.dispatchWorkgroups(groups(activeCount));
  }

  encodeCommit(pass, par, B, activeCount = this.n, uniform = this.uni) {
    pass.setPipeline(this.pipe.finalize);
    const s = par === 0 ? 'A' : 'B';
    pass.setBindGroup(0, this.bg('finalize', [B['pos' + s], B['vel' + s], B['pred' + s], B.corr], uniform));
    pass.dispatchWorkgroups(groups(activeCount));
  }

  encodeStats(pass, par, B, activeCount = this.n, uniform = this.uni) {
    pass.setPipeline(this.pipe.stats);
    const s = par === 0 ? 'A' : 'B';
    pass.setBindGroup(0, this.bg('stats', [B.density, B['vel' + s], B.statsOut], uniform));
    pass.dispatchWorkgroups(groups(activeCount));
  }
  afterSubmit() {
    if (this.destroyed) return;
    if (this.statsReadbackArmed && this.statsReadbackSlot >= 0) {
      this.statsReadbackArmed = false;
      const slot = this.statsReadbackSlot;
      this.statsReadbackSlot = -1;
      this.statsState[slot] = 2;
      const buf = this.statsRing[slot];
      const particleCount = this.n;
      buf.mapAsync(GPUMapMode.READ).then(() => {
        if (this.statsRing[slot] !== buf) { buf.destroy(); return; }
        const v = new Uint32Array(buf.getMappedRange());
        const SCALE = 1024;
        this.stats.avgRho = v[0] / SCALE / Math.max(1, particleCount);
        this.stats.maxRho = v[1] / SCALE;
        this.stats.maxSpeed = v[2] / SCALE;
        this.stats.ke = v[3] / SCALE;
        buf.unmap();
        this.statsState[slot] = 0;
      }).catch(() => { if (this.statsRing[slot] === buf) this.statsState[slot] = 0; });
    }

    if (this.poseReadbackArmed && this.nBodies && this.poseReadbackSlot >= 0) {
      this.poseReadbackArmed = false;
      const slot = this.poseReadbackSlot;
      this.poseReadbackSlot = -1;
      this.poseState[slot] = 2;
      const buf = this.poseRing[slot];
      buf.mapAsync(GPUMapMode.READ).then(() => {
        if (this.poseRing[slot] !== buf) { buf.destroy(); return; }
        const v = new Float32Array(buf.getMappedRange());
        const rotBase = this.nBodies * 4;
        for (let i = 0; i < this.nBodies; i++) {
          const p = this.bodyPose[i];
          p.centre[0] = v[i * 4 + 0];
          p.centre[1] = v[i * 4 + 1];
          p.centre[2] = v[i * 4 + 2];

          for (let r = 0; r < 3; r++)
            for (let c = 0; c < 3; c++)
              p.rot[c * 3 + r] = v[rotBase + (i * 3 + r) * 4 + c];
        }
        buf.unmap();
        this.poseState[slot] = 0;
      }).catch(() => { if (this.poseRing[slot] === buf) this.poseState[slot] = 0; });
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.gen = (this.gen || 0) + 1;
    const resources = new Set([
      ...Object.values(this.buf), ...(this.statsRing || []), ...(this.poseRing || []),
      ...(this.frameUni || []), this.uni, this.rayUni, this.dragUni, this.resizeUni,
    ]);
    // Invalidate asynchronous mappings before destroying their buffers.
    this.statsRing = []; this.poseRing = []; this.frameUni = [];
    this.statsState = []; this.poseState = [];
    this.statsReadbackArmed = false; this.poseReadbackArmed = false;
    this.statsReadbackSlot = -1; this.poseReadbackSlot = -1;
    this.buf = {};
    this.uni = null; this.rayUni = null; this.dragUni = null; this.resizeUni = null;
    for (const resource of resources) resource?.destroy?.();
  }

  applyRayImpulse(origin, dir, impulse, radius, speedLimit) {
    if (!this.n || radius <= 0) return;
    const len = Math.hypot(...impulse);
    if (len <= 0) return;
    const dl = Math.hypot(...dir) || 1;
    const F = this.rayF;
    F[0] = origin[0]; F[1] = origin[1]; F[2] = origin[2]; F[3] = radius;
    F[4] = dir[0] / dl; F[5] = dir[1] / dl; F[6] = dir[2] / dl; F[7] = speedLimit;
    F[8] = impulse[0]; F[9] = impulse[1]; F[10] = impulse[2];
    new Uint32Array(F.buffer, 44, 1)[0] = this.n;
    this.dev.queue.writeBuffer(this.rayUni, 0, F);
    this.pendingImpulse = true;
  }

  encodeResize(pass, activeCount = this.n, position = this.livePos()) {
    if (this.pendingResizeBindGroup) {
      pass.setPipeline(this.pipe.resize);
      // Grid priming may change parity after the wall update was scheduled.
      pass.setBindGroup(0, this.dev.createBindGroup({
        layout: this.pipe.resize.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.resizeUni } },
                  { binding: 1, resource: { buffer: position } }],
      }));
      pass.dispatchWorkgroups(groups(activeCount));
    }
  }

  encodeImpulse(pass, par, B, activeCount = this.n) {
    pass.setPipeline(this.pipe.impulse);
    const s = par === 0 ? 'A' : 'B';
    pass.setBindGroup(0, this.dev.createBindGroup({
      layout: this.pipe.impulse.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: this.rayUni } },
        { binding: 1, resource: { buffer: B['pos' + s] } },
        { binding: 2, resource: { buffer: B['vel' + s] } }],
    }));
    pass.dispatchWorkgroups(groups(activeCount));
  }

  holdBody(body1Based, target, rate, limit) {
    this.heldBody = (body1Based >= 1 && body1Based <= this.nBodies) ? body1Based : -1;
    this.heldTarget = target;
    this.heldRate = rate;
    this.heldLimit = limit;
  }

  releaseBody() { this.heldBody = -1; }

  resizeBox(newBox) {
    const dev = this.dev, p = this.params;
    const oldBox = [p.box[0], p.box[1], p.box[2]];
    const box = [newBox[0], newBox[1], newBox[2]];
    let moved = false;
    for (let a = 0; a < 3; a++) if (Math.abs(box[a] - oldBox[a]) > 1e-9) moved = true;
    if (!moved) return;

    for (let a = 0; a < 3; a++) p.box[a] = box[a];

    const h = this.h;
    const dim = [
      Math.max(1, Math.floor(box[0] / h)),
      Math.max(1, Math.floor(box[1] / h)),
      Math.max(1, Math.floor(box[2] / h)),
    ];
    const cells = dim[0] * dim[1] * dim[2];
    this.gridDim = dim;
    const cellsChanged = cells !== this.nCells;
    this.nCells = cells;

    const ST = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC;
    const realloc = (name, bytes) => {
      this.buf[name]?.destroy?.();
      this.buf[name] = dev.createBuffer({ label: name, size: Math.max(16, bytes),
        usage: ST | GPUBufferUsage.COPY_DST });
    };
    if (cellsChanged) {
      realloc('cellStart', (cells + 2) * 4);
    }

    const bd = boundaryFor(p, p.spacing, h);
    const nb = bd.count;
    this.nBoundary = nb;
    const bpos = new Float32Array(Math.max(1, nb) * 4);
    for (let i = 0; i < nb; i++) {
      bpos[i * 4 + 0] = bd.pts[i * 3 + 0];
      bpos[i * 4 + 1] = bd.pts[i * 3 + 1];
      bpos[i * 4 + 2] = bd.pts[i * 3 + 2];
    }
    const { sortedPos, sortedPsi, cellStart } = this.sortBoundary(bpos, bd.psi, nb);
    realloc('bpos', Math.max(1, nb) * 16);
    realloc('bpsi', Math.max(1, nb) * 4);
    realloc('bcellStart', (cells + 2) * 4);
    dev.queue.writeBuffer(this.buf.bpos, 0, sortedPos);
    dev.queue.writeBuffer(this.buf.bpsi, 0, sortedPsi);
    dev.queue.writeBuffer(this.buf.bcellStart, 0, cellStart);
    this.scene.boundary = bd;

    this.gen++;

    if (!this.resizeUni) {
      this.resizeUni = dev.createBuffer({ size: 96,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const module = dev.createShaderModule({ code: S.resizeWGSL, label: 'resize' });
      this.pipe.resize = dev.createComputePipeline({
        label: 'resize', layout: 'auto', compute: { module, entryPoint: 'main' } });
      this.resizeF = new Float32Array(24);
      this.resizeI = new Uint32Array(this.resizeF.buffer);
    }
    const F = this.resizeF, halfD = 0.5 * p.spacing;
    F[0] = 0; F[1] = 0; F[2] = 0;
    F[4] = oldBox[0]; F[5] = oldBox[1]; F[6] = oldBox[2];
    F[8] = 0; F[9] = 0; F[10] = 0;
    F[12] = box[0]; F[13] = box[1]; F[14] = box[2];
    F[16] = halfD; F[17] = halfD; F[18] = halfD;
    F[20] = box[0] - halfD; F[21] = box[1] - halfD; F[22] = box[2] - halfD;
    this.resizeI[23] = this.n;
    dev.queue.writeBuffer(this.resizeUni, 0, F);
    const bgResize = dev.createBindGroup({
      layout: this.pipe.resize.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.resizeUni } },
                { binding: 1, resource: { buffer: this.livePos() } }],
    });
    this.pendingResizeBindGroup = bgResize;
  }

  appendFluid(pos, vel) {
    const room = Math.max(0, (this.cap || this.n) - this.n);
    const count = Math.min(pos.length / 3 | 0, vel.length / 3 | 0, room);
    if (count <= 0) return 0;
    const dev = this.dev;
    const p4 = new Float32Array(count * 4), v4 = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      p4[i * 4 + 0] = pos[i * 3 + 0];
      p4[i * 4 + 1] = pos[i * 3 + 1];
      p4[i * 4 + 2] = pos[i * 3 + 2];
      p4[i * 4 + 3] = 1;
      v4[i * 4 + 0] = vel[i * 3 + 0];
      v4[i * 4 + 1] = vel[i * 3 + 1];
      v4[i * 4 + 2] = vel[i * 3 + 2];
    }
    const off4 = this.n * 16, off1 = this.n * 4;
    const s = this.parity === 0 ? 'A' : 'B';
    dev.queue.writeBuffer(this.buf['pos' + s], off4, p4);
    dev.queue.writeBuffer(this.buf['vel' + s], off4, v4);

    const rho = new Float32Array(count).fill(this.params.restDensity);
    dev.queue.writeBuffer(this.buf.density, off1, rho);
    const zero4 = new Float32Array(count * 4);
    for (const t of ['A', 'B']) {
      dev.queue.writeBuffer(this.buf['body' + t], off4, zero4);
      dev.queue.writeBuffer(this.buf['rest' + t], off4, zero4);
    }
    this.n += count;
    return count;
  }

  livePos() { return this.buf[this.parity === 0 ? 'posA' : 'posB']; }
  liveVel() { return this.buf[this.parity === 0 ? 'velA' : 'velB']; }
  liveBody() { return this.buf[this.parity === 0 ? 'bodyA' : 'bodyB']; }
}
