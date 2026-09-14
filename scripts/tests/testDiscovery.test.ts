import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { collectTestFiles } from '../test-discovery.mjs';

function fixture(t) {
    const dir = fs.mkdtempSync(join(tmpdir(), 'zenfg-test-discovery-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

test('discovers nested Node tests and ignores helpers and browser/GPU suites', (t) => {
    const dir = fixture(t);
    for (const child of ['nested', 'browser', 'gpu']) fs.mkdirSync(join(dir, child));
    for (const file of ['root.test.ts', 'helper.ts', 'runner.mjs', 'nested/child.test.ts', 'browser/page.test.ts', 'gpu/device.test.ts']) {
        fs.writeFileSync(join(dir, file), '');
    }
    assert.deepEqual(collectTestFiles(dir).sort(), [join(dir, 'root.test.ts'), join(dir, 'nested/child.test.ts')].sort());
});

test('allows existing empty and browser-only directories', (t) => {
    const dir = fixture(t);
    assert.deepEqual(collectTestFiles(dir), []);
    fs.mkdirSync(join(dir, 'browser'));
    fs.writeFileSync(join(dir, 'browser', 'page.test.ts'), '');
    assert.deepEqual(collectTestFiles(dir), []);
});

test('fails a missing root even when another root contains tests', (t) => {
    const dir = fixture(t);
    fs.writeFileSync(join(dir, 'valid.test.ts'), '');
    const missing = join(dir, 'misspelled');
    assert.throws(() => [dir, missing].flatMap(collectTestFiles), (error) => {
        assert.ok(error.message.includes(missing));
        assert.equal(error.cause.code, 'ENOENT');
        return true;
    });
});

test('fails when a configured directory has been replaced by a file', (t) => {
    const path = join(fixture(t), 'tests');
    fs.writeFileSync(path, '');
    assert.throws(() => collectTestFiles(path), (error) => {
        assert.ok(error.message.includes(path));
        assert.equal(error.cause.code, 'ENOTDIR');
        return true;
    });
});

test('does not silently skip unreadable roots or nested directories', (t) => {
    const dir = fixture(t);
    const nested = join(dir, 'nested');
    fs.mkdirSync(nested);
    fs.writeFileSync(join(dir, 'valid.test.ts'), '');
    const original = fs.readdirSync;
    let denied = dir;
    t.mock.method(fs, 'readdirSync', (path, options) => {
        if (path === denied) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
        return original(path, options);
    });
    for (denied of [dir, nested]) {
        assert.throws(() => collectTestFiles(dir), (error) => {
            assert.ok(error.message.includes(denied));
            assert.equal(error.cause.code, 'EACCES');
            return true;
        });
    }
});
