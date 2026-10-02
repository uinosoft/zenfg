import assert from 'node:assert/strict';
import test from 'node:test';
import { createFrameFlowVisualFixture } from '../../webgpu/tests/frameFlowVisualFixture.ts';
import { createDebugViewModel } from '../src/debugCaptureModel.ts';
import { graphRelationFocus } from '../src/panelGraphFocus.ts';
import { createGraphScene, graphGroupElementId } from '../src/panelGraphScene.ts';

test('pass focus includes only its direct recorded neighbors, not the whole resource association', () => {
    const model = createDebugViewModel(createFrameFlowVisualFixture());
    const scene = createGraphScene(model, { groupsEnabled: false, showResourceDeclarations: true, expandedGroupPaths: new Set() });
    const pass = model.nodes.find(node => node.label === 'Lighting.stage3')!;
    const focus = graphRelationFocus(scene, { kind: 'node', id: pass.id })!;
    const includesPass = (name: string) => focus.has('pass:' + model.nodes.find(node => node.label === name)!.id);
    assert.ok(includesPass('Lighting.stage2'));
    assert.ok(includesPass('Lighting.stage3'));
    assert.ok(includesPass('Lighting.stage4'));
    assert.equal(includesPass('Lighting.stage1'), false, 'no transitive upstream traversal');
    assert.equal(includesPass('Lighting.stage5'), false, 'no transitive downstream traversal');
    assert.equal(includesPass('Bloom.stage3'), false, 'sharing imported settings does not imply a dependency');
    const incident = scene.edges.filter(edge => edge.relations.some(relation => relation.nodeIds.includes(pass.id)));
    assert.ok(incident.every(edge => focus.has(edge.id)));
    assert.ok(scene.edges.some(edge => edge.resourceId === model.resources.find(resource => resource.label === 'Shared settings')!.id && !focus.has(edge.id)));
});

test('focus preserves collapsed projection and includes compound ancestors without expanding groups', () => {
    const model = createDebugViewModel(createFrameFlowVisualFixture());
    const frame = model.debugGroups.find(group => group.label === 'Frame')!;
    const lighting = model.debugGroups.find(group => group.label === 'Lighting')!;
    const expanded = new Set([frame.pathKey]);
    const scene = createGraphScene(model, { groupsEnabled: true, showResourceDeclarations: false, expandedGroupPaths: expanded });
    const pass = model.nodes.find(node => node.label === 'Lighting.stage5')!;
    const focus = graphRelationFocus(scene, { kind: 'node', id: pass.id })!;
    assert.ok(focus.has(graphGroupElementId(lighting.pathKey)));
    assert.ok(focus.has(graphGroupElementId(frame.pathKey)));
    assert.ok(focus.has('pass:' + model.nodes.find(node => node.label === 'Combine branches')!.id));
    assert.deepEqual([...expanded], [frame.pathKey]);
    const groupFocus = graphRelationFocus(scene, { kind: 'group', pathKey: frame.pathKey })!;
    assert.ok(groupFocus.has(graphGroupElementId(lighting.pathKey)), 'expanded-group focus includes descendants');
    assert.equal(graphRelationFocus(scene, { kind: 'resource', id: model.resources[0]!.id }), undefined);
    assert.equal(graphRelationFocus(scene, { kind: 'node', id: 'missing' }), undefined);
    assert.equal(graphRelationFocus(scene, undefined), undefined);
    const collapsed = createGraphScene(model, { groupsEnabled: true, showResourceDeclarations: false, expandedGroupPaths: new Set() });
    assert.equal(graphRelationFocus(collapsed, { kind: 'group', pathKey: lighting.pathKey }), undefined,
        'a hidden subgroup must not focus every member of its visible ancestor');
});
