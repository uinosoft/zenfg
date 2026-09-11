import assert from 'node:assert/strict';
import test from 'node:test';
import { createParticles4AllControls, particles4AllExample } from '../src/catalog/particles4All.ts';
import { createPresetSettings } from '../../examples/particles4all-framegraph/src/settings.ts';
import type { Particles4AllController, Particles4AllSettings } from '../../examples/particles4all-framegraph/src/index.ts';

class TestControl {
    readonly callbacks = new Map<string, () => void>();
    constructor(readonly object: Record<string, unknown>, readonly key: string) {}
    on(event: string, callback: () => void) { this.callbacks.set(event, callback); return this; }
    change(value: unknown) { this.object[this.key] = value; this.callbacks.get('change')?.(); }
    click() { this.callbacks.get('click')?.(); }
}
class TestPane {
    static latest: TestPane;
    readonly controls = new Map<string, TestControl>();
    readonly folders: { title: string; expanded: boolean }[] = [];
    constructor() { TestPane.latest = this; }
    addBinding(object: object, key: string) {
        const control = new TestControl(object as Record<string, unknown>, key); this.controls.set(key, control); return control;
    }
    addButton(options: { title: string }) { return this.addBinding({}, options.title); }
    addFolder(options: { title: string; expanded: boolean }) { this.folders.push(options); return this; }
    refresh() {
        // Real Tweakpane can emit changes when refreshing externally changed values.
        for (const control of this.controls.values()) control.callbacks.get('change')?.();
    }
    dispose() {}
}

function controlsFixture() {
    let settings = createPresetSettings('small');
    let calls = 0;
    const warnings: string[][] = [];
    const files: string[] = [];
    const controller = {
        getSettings: () => ({ ...settings, transmission: [...settings.transmission] }),
        setSettings(patch: Partial<Particles4AllSettings>) {
            calls++;
            if (patch.meshResolution === 512) throw new Error('Field exceeds device capacity');
            settings = { ...(patch.preset && patch.preset !== settings.preset ? createPresetSettings(patch.preset) : settings), ...patch };
        },
        reset() {}, resetCamera() {}, togglePour() {}, clearEnvironment() {},
    } as Particles4AllController;
    const controls = createParticles4AllControls({} as HTMLElement, controller,
        (messages) => warnings.push([...messages]), TestPane, (kind) => files.push(kind));
    return { controller, controls, pane: TestPane.latest, warnings, files, get calls() { return calls; } };
}

test('Particles4All controls expose four modes, all settings and file actions with advanced groups folded', () => {
    const fixture = controlsFixture();
    const defaults = createPresetSettings('small');
    for (const key of Object.keys(defaults).filter((name) => name !== 'transmission')) assert.ok(fixture.pane.controls.has(key), key);
    for (const key of ['r', 'g', 'b']) assert.ok(fixture.pane.controls.has(key));
    assert.deepEqual(fixture.pane.folders.filter((folder) => folder.expanded).map((folder) => folder.title), ['Scene']);
    fixture.pane.controls.get('Load panorama')!.click(); fixture.pane.controls.get('Load pbf_settings.ini')!.click();
    assert.deepEqual(fixture.files, ['environment', 'ini']);
    for (const mode of ['particles', 'surface-mesh', 'ray-march', 'ssfr']) {
        fixture.pane.controls.get('displayMode')!.change(mode);
        assert.equal(fixture.controller.getSettings().displayMode, mode);
    }
    assert.equal(particles4AllExample.sourceFiles[0]!.role, 'example');
    assert.equal(particles4AllExample.sourceFiles.find((file) => file.path.endsWith('wgsl.js'))!.language, 'javascript');
});

test('preset controls preserve explicitly chosen SSFR quality in one update and refresh without recursive changes', () => {
    const fixture = controlsFixture();
    fixture.pane.controls.get('ssfrScale')!.change(0.75);
    assert.equal(fixture.calls, 1);
    fixture.pane.controls.get('preset')!.change('large');
    assert.equal(fixture.calls, 2);
    assert.equal(fixture.controller.getSettings().preset, 'large');
    assert.equal(fixture.controller.getSettings().ssfrScale, 0.75);
    fixture.controls.refreshFromFeature(); assert.equal(fixture.calls, 2);
    fixture.pane.controls.get('preset')!.change('small');
    assert.equal(fixture.controller.getSettings().ssfrScale, 0.75);
});

test('rejected control settings revert their displayed values and preserve current configuration', () => {
    const fixture = controlsFixture();
    const before = fixture.controller.getSettings();
    fixture.pane.controls.get('meshResolution')!.change(512);
    assert.deepEqual(fixture.controller.getSettings(), before);
    assert.equal(fixture.pane.controls.get('meshResolution')!.object.meshResolution, before.meshResolution);
    assert.deepEqual(fixture.warnings, [['Field exceeds device capacity']]);
});

test('transmission controls follow imported settings and preserve the other color channels', () => {
    const fixture = controlsFixture();
    fixture.controller.setSettings({ transmission: [0.2, 0.3, 0.4] });
    fixture.controls.refreshFromFeature();
    assert.equal(fixture.pane.controls.get('r')!.object.r, 0.2);
    fixture.pane.controls.get('g')!.change(0.9);
    assert.deepEqual(fixture.controller.getSettings().transmission, [0.2, 0.9, 0.4]);
});
