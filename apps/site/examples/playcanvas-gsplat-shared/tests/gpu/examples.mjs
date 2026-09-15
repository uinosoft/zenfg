import {chromium} from 'playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
const output='.test-dist/playcanvas-gsplat-site';await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-webgpu']});
const page=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:Number(process.env.GPU_TEST_DPR??1)});
const base=process.env.EXAMPLES_URL??'http://127.0.0.1:4175/playground/';
const errors=[],requests=[],checks=[];const requested=new Set();
page.on('request',r=>{if(r.url().includes('example_roman_parish_02'))requested.add(r.url());});
page.on('pageerror',e=>errors.push(String(e)));
page.on('response',r=>{if(/examples_data|toy-cat/.test(r.url()))requests.push({url:r.url(),status:r.status()});});
const canvas=page.locator('[data-effect-canvas]');
const ready=()=>page.waitForFunction(()=>Number(document.querySelector('[data-effect-canvas]')?.dataset.renderedSplats)>0,null,{timeout:100000});
const frames=async(n=30)=>page.evaluate(n=>new Promise(resolve=>{const tick=()=>--n<=0?resolve():requestAnimationFrame(tick);requestAnimationFrame(tick);}),n);
try{
for(const id of ['playcanvas-gsplat-interop','playcanvas-gsplat-streaming-interop']){
await page.goto(base+'?example='+id+'&panel=none');await ready();await frames(60);
await page.screenshot({path:output+'/'+id+'.png'});
const box=await canvas.boundingBox();const before=await canvas.screenshot();
await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+50,box.y+box.height/2+10,{steps:10});await page.mouse.up();await frames();
if(before.equals(await canvas.screenshot()))throw Error('Drag has no visible effect');
checks.push(id+': first frame, drag');
if(id.includes('streaming')){
await page.getByRole('button',{name:'Reset View',exact:true}).click();await page.waitForFunction(()=>Number(document.querySelector('[data-effect-canvas]')?.dataset.renderedSplats)>1200000,null,{timeout:300000});await frames(180);
const high=Number(await canvas.getAttribute('data-rendered-splats'));
const input=page.locator('[data-controls-host] input').first();await input.fill('0.5');await input.press('Enter');await frames(180);
await page.waitForFunction(high=>Number(document.querySelector('[data-effect-canvas]')?.dataset.renderedSplats)<high,high,{timeout:90000});const low=Number(await canvas.getAttribute('data-rendered-splats'));
checks.push({budget:{high,low}});if(!(low<high))throw Error('Budget did not reduce actual splats');
await input.fill('4');await input.press('Enter');await frames(180);
const count=requested.size;
await canvas.focus();await page.keyboard.down('Shift');await page.keyboard.down('w');await frames(180);await page.keyboard.up('w');await page.keyboard.up('Shift');await frames(120);
for(let n=0;n<60&&requested.size<=count;n++){await new Promise(r=>setTimeout(r,1000));}const moved=requested.size;checks.push({streamingRequests:{before:count,after:moved}});if(moved<=count)throw Error('Movement produced no new requests');
await page.context().setOffline(true);await page.keyboard.down('a');await frames(90);await page.keyboard.up('a');await frames(120);
if(Number(await canvas.getAttribute('data-rendered-splats'))<=0)throw Error('Offline lost existing content');
checks.push('offline retains rendered content');await page.context().setOffline(false);
}
await page.locator('[data-panel-button=code]').click();await page.waitForFunction(()=>document.querySelector('[data-source-path]')?.textContent?.endsWith('/main.ts'));
await page.locator('[data-panel-button=inspector]').click();await page.getByRole('button',{name:'Export',exact:true}).waitFor();await page.getByRole('button',{name:'Export',exact:true}).click();
const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('menuitem',{name:'Download JSON',exact:true}).click()]);
const path=output+'/'+id+'.snapshot.json';await download.saveAs(path);const snapshot=JSON.parse(await readFile(path,'utf8'));
if(snapshot.graph.nodes.length!==5)throw Error('Snapshot graph does not contain five real nodes');
checks.push(id+': source, snapshot export');
if(await page.locator('[data-overlay-close]').isVisible())await page.locator('[data-overlay-close]').click();await page.setViewportSize({width:390,height:844});await frames();
await page.screenshot({path:output+'/'+id+'-mobile.png'});await page.setViewportSize({width:1280,height:800});
}
await page.goto(base+'?example=playcanvas-gsplat-interop&panel=none');await ready();
for(const id of ['three-interop','playcanvas-gsplat-interop']){
await page.locator('[data-example-id="'+id+'"]').click();
await page.waitForFunction(()=>document.querySelector('[data-effect-status-text]')?.textContent?.startsWith('Live'),null,{timeout:100000});}
checks.push('switch Three.js and PlayCanvas');
await page.route('**/toy-cat.sog',r=>r.abort());await page.goto(base+'?example=playcanvas-gsplat-interop&panel=none');
await page.getByRole('button',{name:'Retry loading',exact:true}).waitFor({timeout:80000});await page.unroute('**/toy-cat.sog');await page.getByRole('button',{name:'Retry loading',exact:true}).click();await ready();checks.push('initial failure and explicit retry');
if(errors.length)throw Error(JSON.stringify(errors));
await writeFile(output+'/result.json',JSON.stringify({ok:true,browser:browser.version(),checks,requests,errors},null,2));console.log(JSON.stringify({ok:true,checks}));
}catch(error){await page.screenshot({path:output+'/failure.png'});console.log((await page.locator('body').innerText()).slice(-3500));await writeFile(output+'/result.json',JSON.stringify({ok:false,error:String(error),checks,requests,errors},null,2));console.error(error);process.exitCode=1;}
finally{await browser.close();}
