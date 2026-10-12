import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import { checkSkill } from './docs/skills.mjs';
import { assertLocalLinks } from './docs/markdown.mjs';

export function checkPackageSkillDiscovery(directory, packages, pnpm, storeBase) {
    const env = { ...process.env, CODEX_THREAD_ID: 'zenfg-package-skill-check' };
    const options = { cwd: directory, env };
    const skillDirectory = join(directory, '.agents', 'skills');
    const names = packages.map(p => p.name);
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    const approvalKeys = packages.map(p => p.name + '@file:' + relative(directory, p.path).replaceAll('\\', '/'));
    assert.ok(names.every(name => manifest.dependencies[name].startsWith('file:')));
    const linked = () => existsSync(skillDirectory)
        ? readdirSync(skillDirectory).filter(name => name.startsWith('pnpm-')) : [];
    const install = () => pnpm(['install', '--offline', '--ignore-scripts', '--store-dir', storeBase], options);
    // These tarballs have exact source identities. Registry-name approval cannot approve them.
    install();
    assert.equal(linked().length, 0, 'Unapproved package Skills must remain unlinked.');
    const approved = pnpm(['approve', '--yes', ...approvalKeys], options);

    install();
    assert.equal(linked().length, packages.length, 'Expected one Skill per approved direct package. ' + approved);
    for (const name of names) {
        const installed = join(directory, 'node_modules', ...name.split('/'));
        const skill = checkSkill(installed);
        const alias = join(skillDirectory, 'pnpm-' + name.replaceAll('/', '+') + '-' + skill.name, 'SKILL.md');
        assert.equal(realpathSync(alias), realpathSync(skill.path), 'Discovery must link the packed Skill.');
        assert.equal(readFileSync(alias, 'utf8'), skill.content);
        assertLocalLinks(realpathSync(installed), [realpathSync(alias)]);
    }
    const approval = readFileSync(join(directory, 'pnpm-workspace.yaml'), 'utf8');
    assert.ok(approval.includes('skills: true'), 'Approval must be recorded in the temporary project.');
    assert.ok(!/build:\s*true/.test(approval) && !approval.includes('allowBuilds:'),
        'Skill verification must not authorize builds.');
    assert.ok(approvalKeys.every(key => approval.includes(key)), 'Approve only the exact tarball sources.');
    pnpm(['approve', '--yes', ...approvalKeys.map(key => '!' + key)], options);
    install();
    assert.equal(linked().length, 0, 'Revoking approval must remove generated links.');
    process.stdout.write('Verified pinned pnpm Skill discovery, exact-tarball approval, real-path references and revocation.\n');
}
