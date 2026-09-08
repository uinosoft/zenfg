

import { rayWGSL } from './ray_wgsl.js';

export class RayMarch {
  constructor(device, format) {
    this.dev = device;
    const m = device.createShaderModule({ code: rayWGSL, label: 'raymarch' });
    this.pipe = device.createRenderPipeline({
      label: 'raymarch', layout: 'auto',
      vertex: { module: m, entryPoint: 'vs' },
      fragment: { module: m, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });

    this.uni = device.createBuffer({ size: 288,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.F = new Float32Array(72);
    this.I = new Int32Array(this.F.buffer);

    this.ior = 1.333;
    this.absorption = 1.0;
    this.transmit = [0.35, 0.62, 0.78];
    this.thicknessSteps = 48;
    this.groundReflection = 0.0;
    this.skinWidth = 0.05;
    this.roughness = 0.055;
    this.sunIntensity = 3.0;
    this.sunElevation = 38.0;
    this.sunAzimuth = 40.0;
    this.exposure = 1.0;
    this.debug = 0;
    this.floorPlane = true;

    this.fallbackZ = device.createTexture({
      label: 'particles4all.ray.fallback-eye-z', size: [1, 1], format: 'r32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.fallbackNormal = device.createTexture({
      label: 'particles4all.ray.fallback-normal', size: [1, 1], format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture(
      { texture: this.fallbackZ }, new Float32Array([-1e4]), { bytesPerRow: 4 }, [1, 1, 1],
    );
    device.queue.writeTexture(
      { texture: this.fallbackNormal }, new Uint16Array(4), { bytesPerRow: 8 }, [1, 1, 1],
    );
    this.fallbackViews = {
      z: this.fallbackZ.createView(),
      n: this.fallbackNormal.createView(),
    };
  }

  prepareFrame(mesh, sim, cam, view, proj, invViewProj, invView,
       bodyCount, iso, surf, bodyGen) {
    const F = this.F, I = this.I;
    F.set(invViewProj, 0);
    F.set(invView, 16);
    const eye = cam.eye();
    F.set([eye[0], eye[1], eye[2], 0], 32);
    F.set([mesh.origin[0], mesh.origin[1], mesh.origin[2], mesh.voxel], 36);
    F.set([0, 0, 0, iso], 40);
    F.set([sim.params.box[0], sim.params.box[1], sim.params.box[2], this.ior], 44);

    const t = this.transmit.map(v => Math.min(1, Math.max(1e-3, v)));
    const absorb = t.map(v => this.absorption * -Math.log(v));
    F.set([absorb[0], absorb[1], absorb[2], this.skinWidth], 48);
    const el = this.sunElevation * Math.PI / 180, az = this.sunAzimuth * Math.PI / 180;
    const sun = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
    const sl = Math.hypot(...sun);
    F.set([sun[0] / sl, sun[1] / sl, sun[2] / sl, this.sunIntensity], 52);
    I[56] = mesh.vertDim[0]; I[57] = mesh.vertDim[1]; I[58] = mesh.vertDim[2];
    I[59] = this.thicknessSteps;
    F[60] = this.roughness;
    F[61] = this.exposure;
    F[62] = this.groundReflection;
    I[63] = bodyCount;
    I[64] = this.floorPlane ? 1 : 0;
    I[65] = this.debug;
    I[66] = surf ? 1 : 0;
    F[67] = proj[0];
    F[68] = proj[5];
    const env = this.env;
    I[69] = env?.has ? 1 : 0;
    F[70] = env ? env.intensity : 1;
    F[71] = env ? env.yaw : 0;
    this.dev.queue.writeBuffer(this.uni, 0, this.F);

    return { bodyCount, surf, bodyGen };
  }

  createBind(mesh, bodies, surfaceViews, field) {
    const env = this.env;
    return this.dev.createBindGroup({
      layout: this.pipe.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uni } },
                { binding: 1, resource: { buffer: field } },

                { binding: 2, resource: { buffer: bodies || field } },
                { binding: 3, resource: surfaceViews.z },
                { binding: 4, resource: surfaceViews.n },
                { binding: 5, resource: env.view },
                { binding: 6, resource: env.sampler }],
    });
  }

  draw(pass, bind) {
    pass.setPipeline(this.pipe);
    pass.setBindGroup(0, bind);
    pass.draw(3);
  }
}
