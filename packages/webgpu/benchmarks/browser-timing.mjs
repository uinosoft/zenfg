// Run with the site development server available at TIMING_URL.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const root=resolve(import.meta.dirname,'../../..').replaceAll('\\','/');
const browser=await chromium.launch({channel:process.env.GPU_TEST_CHANNEL??'msedge',headless:true,args:['--enable-unsafe-webgpu']});
try {
 const page=await browser.newPage({viewport:{width:800,height:600}});
 const origin=new URL(process.env.TIMING_URL??'http://127.0.0.1:5174/').origin;
 await page.route('**/__timing_benchmark__',route=>route.fulfill({headers:{'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'},contentType:'text/html',body:'<!doctype html><title>Timing benchmark</title><body></body>'}));
 await page.goto(origin+'/__timing_benchmark__');
 const result=await page.evaluate(async ({root})=>{
  // The dedicated blank page has no application rendering in the background.
  document.body.replaceChildren();
  const {FrameGraph}=await import('/@fs/'+root+'/packages/webgpu/src/index.ts');
  const {startThreeInterop}=await import('/@fs/'+root+'/apps/site/examples/three-interop/src/start.ts');
  const adapter=await navigator.gpu.requestAdapter();
  if(!adapter)throw Error('WebGPU unavailable');
  const device=await adapter.requestDevice({requiredFeatures:adapter.features.has('timestamp-query')?['timestamp-query']:[]});
  let clockStepMicros=Infinity,previous=performance.now();for(let i=0;i<10000;i++){const now=performance.now();if(now>previous)clockStepMicros=Math.min(clockStepMicros,(now-previous)*1000);previous=now;}
  const environment={crossOriginIsolated,clockStepMicros,userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description},timestampQuery:device.features.has('timestamp-query'),unit:'microseconds',warmup:50,samples:100,rounds:5};
  const results=[];
  const stats=values=>{values.sort((a,b)=>a-b);return {p50Micros:values[49],p95Micros:values[94]};};
  const graph=new FrameGraph(device),frame=graph.beginFrame();
  const color=frame.createTexture({label:'target',size:[128,128],format:'rgba8unorm'});
  for(let i=0;i<12;i++)frame.render({label:'render-'+i,sideEffect:true,colorAttachments:[{target:color,loadOp:'clear',storeOp:'store'}]});
  const compiled=frame.compile();
  for(let round=0;round<5;round++){
   const samples={off:[],cpu:[],both:[]};
   for(let i=0;i<150;i++){
    const modes=round%2?['both','cpu','off']:['off','cpu','both'];
    for(let j=0;j<3;j++){
     const mode=modes[(j+i)%3];
     const start=performance.now();const timing=mode==='off'?compiled.execute():compiled.executeWithTiming({timing:mode});const elapsed=(performance.now()-start)*1000;
     if(i>=50)samples[mode].push(elapsed);
     // Each family waits outside its timer before the next interleaved execution.
     if(timing?.gpu)await timing.gpu;await device.queue.onSubmittedWorkDone();
    }
   }
   for(const mode of ['off','cpu','both'])results.push({scene:'12-render-passes',round,mode,...stats(samples[mode])});
  }
  graph.destroy();device.destroy();
  // Instrument only the compiled execution entry on the real interop host.
  const canvas=document.createElement('canvas');canvas.style.cssText='width:320px;height:180px';document.body.append(canvas);
  const originalBegin=FrameGraph.prototype.beginFrame;
  let mode='off',samples=[],seen=0,done;
  const gpuResults={available:0,unavailable:0};const pendingGpu=new Set();let error;
  FrameGraph.prototype.beginFrame=function(...args){const frame=originalBegin.apply(this,args),compile=frame.compile.bind(frame);frame.compile=(...args)=>{const compiled=compile(...args),execute=compiled.execute.bind(compiled),timed=compiled.executeWithTiming.bind(compiled);compiled.execute=(options)=>{const start=performance.now();const timing=mode==='off'?execute(options):timed({...options,timing:mode});const elapsed=(performance.now()-start)*1000;if(seen++>=50)samples.push(elapsed);if(timing?.gpu){const pending=timing.gpu.then(report=>{gpuResults[report.status]++;},value=>{error=String(value);done?.();}).finally(()=>pendingGpu.delete(pending));pendingGpu.add(pending);}return undefined;};return compiled;};return frame;};
  const controller=await startThreeInterop(canvas,{onFrame(){if(samples.length===100)done?.();},onError(value){error=String(value);done?.();}});
  if(!controller)throw Error(error??'Interop startup failed');
  for(let round=0;round<5;round++)for(const next of round%2?['both','cpu','off']:['off','cpu','both']){
   mode=next;samples=[];seen=0;await new Promise(resolve=>{done=resolve;});if(error)throw Error(error);
   results.push({scene:'three-interop',round,mode,...stats(samples)});
  }
  await Promise.all(pendingGpu);if(error)throw Error(error);controller.dispose();FrameGraph.prototype.beginFrame=originalBegin;
  return {environment,results,gpuResults};
 },{root});
 const output=process.env.TIMING_OUTPUT??resolve(tmpdir(),'zenfg-timing-acceptance/browser.json');
 await mkdir(dirname(output),{recursive:true});
 await writeFile(output,JSON.stringify(result,null,2));console.log(output);
}finally{await browser.close();}
