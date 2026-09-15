import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const root=resolve(import.meta.dirname,'../../../../../../');
const output=resolve(root,'.test-dist/playcanvas-gsplat-gpu');
await mkdir(output,{recursive:true});
const bundle=await build({absWorkingDir:root,entryPoints:['apps/site/examples/playcanvas-gsplat-shared/tests/gpu/browser.ts'],
    external:['node:worker_threads'],bundle:true,format:'esm',platform:'browser',target:'es2022',write:false});
function ply(z) {
    const fields=['x','y','z','nx','ny','nz','f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3'];
    const header=Buffer.from('ply\nformat binary_little_endian 1.0\nelement vertex 9\n'+fields.map(f=>'property float '+f+'\n').join('')+'end_header\n');
    const bytes=Buffer.alloc(9*fields.length*4);
    for(let i=0;i<9;i++){
        const values=[(i%3-1)*0.15,(Math.floor(i/3)-1)*0.15,z,0,0,0,-1.5,1.2,1.7,0.5,-1.4,-1.4,-2,1,0,0,0];
        values.forEach((v,j)=>bytes.writeFloatLE(v,(i*fields.length+j)*4));
    }
    return Buffer.concat([header,bytes]);
}
const server=createServer((req,res)=>{
    if(req.url==='/suite.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(bundle.outputFiles[0].text);}
    else if(req.url.startsWith('/fixture.ply')){res.writeHead(200,{'Content-Type':'application/octet-stream'});res.end(ply(Number(new URL(req.url,'http://local').searchParams.get('z')??1)));}
    else {res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>PlayCanvas GPU acceptance</title><script type="module" src="/suite.js"></script>');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
const logs=[];
try {
    browser=await chromium.launch({...(process.env.GPU_TEST_BROWSER?{executablePath:process.env.GPU_TEST_BROWSER}:process.platform==='win32'?{channel:'msedge'}:{}),
        headless:true,args:['--enable-unsafe-webgpu']});
    const page=await browser.newPage({deviceScaleFactor:Number(process.env.GPU_TEST_DPR??1)});
    page.on('console',m=>{logs.push({type:m.type(),text:m.text()});if(m.type()==='error')console.error(m.text());});
    page.on('pageerror',e=>{logs.push({type:'pageerror',text:String(e)});console.error(e);});
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.waitForFunction(()=>globalThis.__playCanvasGsplatGpuResult!==undefined,undefined,{timeout:150000});
    const result=await page.evaluate(()=>globalThis.__playCanvasGsplatGpuResult);
    result.browser=browser.version();result.logs=logs;
    await writeFile(resolve(output,'result.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result,null,2));
    if(!result.ok)process.exitCode=1;
} catch(error) {console.error(error);await writeFile(resolve(output,'result.json'),JSON.stringify({ok:false,error:String(error),logs},null,2));process.exitCode=1;}
finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
