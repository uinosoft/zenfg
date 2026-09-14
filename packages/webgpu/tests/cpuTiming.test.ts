import { ResourcePool } from '../src/resourcePool.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { FrameGraph } from '../src/index.ts';
import { cpuClock } from '../src/cpuTiming.ts';
import { mockDevice, mockCommandEncoder, buffer } from './testUtils.ts';

function graphWithAllKinds() {
 const graph = new FrameGraph(mockDevice());
 const frame = graph.beginFrame();
 const source = frame.importBuffer(buffer('source'), { label: 'source' });
 const target = frame.createBuffer({ label: 'target', size: 64 });
 const color = frame.createTexture({ label: 'color', size: [4, 4], format: 'rgba8unorm' });
 frame.render({ label: 'render', sideEffect: true, colorAttachments: [{target: color, loadOp: 'clear', storeOp: 'store'}] });
 frame.compute({ label: 'compute', sideEffect: true });
 frame.copy({ label: 'copy', sideEffect: true, operations: [{type: 'buffer-to-buffer', source, destination: target, size: 4}] });
 frame.externalSubmission({ label: 'external', submit() {} });
 frame.clearBuffer({ label: 'clear', sideEffect: true, operations: [{target}] });
 frame.command({ label: 'command', sideEffect: true });
 frame.command({ label: 'culled', sideEffect: false, encode() { throw Error('culled'); } });
 return { graph, compiled: frame.compile() };
}

test('CPU timing covers all six kinds and counts only executed nodes', t => {
 const { graph, compiled } = graphWithAllKinds(); let ticks = 0;
 t.mock.method(cpuClock, 'now', () => ticks++);
 const result = compiled.executeWithTiming({ frameIndex: 7, timing: 'cpu' });
 assert.equal(ticks, 14); assert.equal(result.gpu, undefined);
 assert.deepEqual(result.cpu!.nodes.map(n => n.kind), ['render','compute','copy','external-submission','clear-buffer','command']);
 assert.deepEqual(result.cpu!.nodes.map(n => n.durationMicros), Array(6).fill(1000));
 assert.equal(result.cpu!.executionDurationMicros, 13000);
 assert.ok(graph.getResourcePoolStats().retainedCount > 0);
 const saved = structuredClone(result.cpu);
 compiled.executeWithTiming({frameIndex: 8, timing: 'cpu'});
 assert.deepEqual(result.cpu, saved);
});

test('ordinary and GPU-only execution never read the CPU clock', async t => {
 const { compiled } = graphWithAllKinds();
 t.mock.method(cpuClock, 'now', () => { throw Error('CPU clock disabled'); });
 t.mock.method(globalThis, 'Float64Array', () => { throw Error('CPU records disabled'); });
 assert.equal(compiled.execute(), undefined);
 const result = compiled.executeWithTiming({timing: 'gpu'});
 assert.equal(result.cpu, undefined); assert.equal((await result.gpu!).status, 'unavailable');
});

test('empty execution has an empty report and two clock reads', t => {
 const frame = new FrameGraph(mockDevice()).beginFrame().compile(); let ticks=0;
 t.mock.method(cpuClock, 'now', () => ticks++);
 assert.deepEqual(frame.executeWithTiming({timing: 'cpu'}).cpu, {frameIndex:0,executionDurationMicros:1000,nodes:[]});
 assert.equal(ticks,2);
});

test('total includes hooks, submit and release; per-node samples exclude hooks', t => {
 let time=0;
 const device=mockDevice(mockCommandEncoder({finish(){time+=5;return {};}}));
 const frame=new FrameGraph(device).beginFrame();
 frame.command({sideEffect:true,encode(){time+=2;}});
 const buffer=frame.createBuffer({size:16});
 frame.clearBuffer({sideEffect:true,operations:[{target:buffer}]});
 const release=ResourcePool.prototype.release;
 t.mock.method(ResourcePool.prototype,'release',function(this:ResourcePool,...args:Parameters<ResourcePool['release']>){time+=11;release.apply(this,args);});
 t.mock.method(cpuClock,'now',()=>time);
 const cpu=frame.compile().executeWithTiming({timing:'cpu',beforeSubmit(){time+=3;},afterSubmit(){time+=7;}}).cpu!;
 assert.equal(cpu.nodes[0]!.durationMicros,2000); assert.equal(cpu.executionDurationMicros,28000);
});

for (const failure of ['node','submit'] as const) test('failed '+failure+' execution throws and subsequent execution succeeds', t => {
 let fail=true;
 const device=mockDevice();
 if(failure==='submit') t.mock.method(device.queue,'submit',()=>{if(fail)throw Error('failure');});
 const graph=new FrameGraph(device),frame=graph.beginFrame();
 frame.command({sideEffect:true,encode(){if(fail&&failure==='node')throw Error('failure');}});
 const compiled=frame.compile();
 assert.throws(()=>compiled.executeWithTiming({timing:'both'}),/failure/);
 fail=false; assert.equal(compiled.executeWithTiming({timing:'cpu'}).cpu!.nodes.length,1);
});
