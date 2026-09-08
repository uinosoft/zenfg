import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { FrameGraphSnapshot } from '@zenfg/snapshot';
import { Window } from 'happy-dom';
import { createDebugViewModel } from '../src/debugCaptureModel.ts';
import { DiagnosticsView } from '../src/panelDiagnosticsView.ts';
import { ResourcesView } from '../src/panelResourcesView.ts';
import { resolveNodeSelection } from '../src/panelSelection.ts';
import type { Selection } from '../src/panelTypes.ts';

function fixture(): FrameGraphSnapshot {
 return JSON.parse(readFileSync('packages/snapshot/fixtures/full-webgpu.fgsnapshot.json','utf8'));
}
function dom() {
 const window = new Window();
 Reflect.set(globalThis, 'window', window); Reflect.set(globalThis, 'document', window.document); Reflect.set(globalThis, 'Event', window.Event);
 return window;
}
test('diagnostic messages remain complete and ordered, including both associations and culled identity', () => {
 const window = dom();
 try {
  const selections: Selection[] = [];
  const original = fixture();
  const vm = createDebugViewModel({...original, diagnostics:[
   {severity:'info',code:'repeated',message:'info'},
   {severity:'warning',code:'repeated',message:'first warning',nodeId:'node:unused',resourceId:'resource:backbuffer'},
   {severity:'error',code:'repeated',message:'long '.repeat(900)},
   {severity:'warning',code:'repeated',message:'second warning'},
  ]});
  const view = new DiagnosticsView({onSelect: selection => selections.push(selection),onHover:()=>{},onGroupToggle:()=>{},isGroupExpanded:()=>false},'diagnostics');
  view.setSnapshot(vm);
  const messages = [...view.root.querySelectorAll<HTMLElement>('.zenfg-inspector-diagnostic-message')];
  assert.deepEqual(messages.map(message=>message.dataset.severity),['error','warning','warning','info']);
  assert.equal(messages[0]!.querySelector('p')!.textContent,'long '.repeat(900));
  assert.equal(messages[1]!.querySelectorAll('.zenfg-inspector-diagnostic-links').length,2);
  messages[1]!.querySelector<HTMLButtonElement>('.zenfg-inspector-diagnostic-links button')!.click();
  assert.deepEqual(selections,[{kind:'culled',id:'node:unused'}]);
  assert.deepEqual(resolveNodeSelection(vm,'node:unused'),{kind:'culled',id:'node:unused'});
  assert.deepEqual(resolveNodeSelection(vm,'node:scene'),{kind:'node',id:'node:scene'});
  assert.equal(vm.diagnosticsByNodeId.get('node:unused')!.length,1);
 } finally {window.close();}
});
test('Surface resources use the protocol value in origin filtering', () => {
 const window = dom();
 try {
  const view = new ResourcesView({onSelect:()=>{},onHover:()=>{},onGroupToggle:()=>{},isGroupExpanded:()=>false},'resources');
  view.setSnapshot(createDebugViewModel(fixture()));
  const select = view.root.querySelector<HTMLSelectElement>('[aria-label="Resource origin"]')!;
  select.value='surface'; select.dispatchEvent(new Event('change'));
  const rows = view.root.querySelectorAll('tbody tr[data-selection-key]');
  assert.equal(rows.length,1); assert.equal(rows[0]!.getAttribute('data-selection-key'),'resource:resource:backbuffer');
 } finally {window.close();}
});
