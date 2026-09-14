// Explicit pre-change revision; does not modify the checkout.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir, cpus, release } from 'node:os';
const revision=process.argv[2];
if(!revision)throw Error('Usage: node compare-timing.mjs <baseline-git-revision>');
const root=resolve(import.meta.dirname,'../../..');
const out=resolve(root,'.benchmark-dist/timing-comparison');await mkdir(out,{recursive:true});
const variants={};
for(const variant of ['baseline','current']){
 const outfile=resolve(out,variant+'.mjs');
 await build({entryPoints:[resolve(import.meta.dirname,'FrameGraphCompileBenchmark.ts')],outfile,bundle:true,platform:'node',format:'esm',target:'node24',plugins:variant==='baseline'?[{name:'historical-runtime',setup(builder){builder.onLoad({filter:/packages[\\/]webgpu[\\/]src[\\/].*\.ts$/},args=>({contents:execFileSync('git',['show',revision+':'+relative(root,args.path).replaceAll('\\','/')],{cwd:root,encoding:'utf8'}),loader:'ts',resolveDir:resolve(args.path,'..')}));}}]:[]});
 variants[variant]=await import(pathToFileURL(outfile).href);
}
const results=[];
for(let round=0;round<5;round++)for(const bodyNodeCount of [12,64,256,1024])for(const scenario of variants.current.FRAME_GRAPH_COMPILE_BENCHMARK_SCENARIOS)for(const mode of ['compact','report'])for(const variant of round%2?['current','baseline']:['baseline','current']){
 const result=variants[variant].runFrameGraphCompileBenchmarkCase({bodyNodeCount,scenario,mode,operation:'execute-repeated',cpuTiming:false,warmupCount:1000,sampleCount:1000});
 results.push({round,variant,...result});
}
const output=resolve(tmpdir(),'zenfg-timing-acceptance/isolated.json');
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify({environment:{node:process.version,platform:process.platform,release:release(),cpu:cpus()[0].model,baseline:revision,warmup:1000,samples:1000,rounds:5},results},null,2));console.log(output);
