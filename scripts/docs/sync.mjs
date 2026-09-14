import { packages, workspace, cargo, read, write, repository, website, snapshotVersion } from './catalog.mjs';
import { markdownFiles } from './markdown.mjs';
import { relative, resolve } from 'node:path';
import { root } from './catalog.mjs';
const check = process.argv.includes('--check');
const failures = [];
const outputs = new Map();
function save(file, value) { outputs.set(file.replaceAll('\\', '/'), value); }
export function replaceBlock(text, name, content) {
    const start = `<!-- generated:${name}:start -->`, end = `<!-- generated:${name}:end -->`;
    const a = text.indexOf(start), b = text.indexOf(end);
    if (a < 0 || b < a || text.indexOf(start, a + 1) !== -1) throw new Error(`Missing or duplicate generated block ${name}`);
    return text.slice(0, a) + `${start}\n${content.trim()}\n${end}` + text.slice(b + end.length);
}
const wire = snapshotVersion();
const badge = (label, image, target) => `[![${label}](https://img.shields.io/${image})](${target})`;
const license = badge('MIT license', 'badge/license-MIT-blue.svg', `${repository}/blob/main/LICENSE`);
export function versionBadge(p) {
    return p.registry === 'npm'
        ? badge(`${p.name} published ${p.version.includes('-') ? 'next' : 'latest'} version`, `npm/v/${encodeURIComponent(p.name)}/${p.version.includes('-') ? 'next' : 'latest'}?label=npm`, `https://www.npmjs.com/package/${p.name}`)
        : badge(`${p.name} published version`, `crates/v/${p.name}?include_prereleases`, `https://crates.io/crates/${p.name}`);
}
for (const file of ['README.md', 'README.zh-CN.md']) {
    const chinese = file.includes('zh-CN');
    let text = replaceBlock(read(file), 'badges', [
        `[![CI main](${repository}/actions/workflows/ci.yml/badge.svg?branch=main&event=push)](${repository}/actions/workflows/ci.yml?query=branch%3Amain)`,
        badge('Documentation', 'badge/docs-online-blue', `${website}docs/`), license,
        badge('Public beta', 'badge/status-beta-orange', `${repository}/blob/main/CHANGELOG.md`),
    ].join('\n'));
    const descriptions = chinese ? ['TypeScript/WebGPU FrameGraph 运行时', `Snapshot ${wire} 类型、编解码、验证与规范`, '可嵌入的 DOM Inspector', 'Rust/wgpu FrameGraph 运行时', `Rust Snapshot ${wire} 编解码、验证与迁移`] : ['TypeScript/WebGPU FrameGraph runtime', `Snapshot ${wire} types, codec, validation and specification`, 'Embeddable DOM Inspector', 'Rust/wgpu FrameGraph runtime', `Rust Snapshot ${wire} codec, validation and migration`];
    text = replaceBlock(text, 'packages', [`| ${chinese ? '包 | 用途 | 发布版本 | 文档' : 'Package | Purpose | Published version | Documentation'} |`, '| --- | --- | --- | --- |',
        ...packages.map((p, i) => `| [\`${p.name}\`](${p.directory}/README.md) | ${descriptions[i]} | ${versionBadge(p)} | [${chinese ? '指南' : 'Guide'}](${website}docs/${p.route}.html) |`),
    ].join('\n'));
    save(file, text);
}
for (const p of packages) {
    const api = p.registry === 'npm' ? `${website}docs/api/${p.slug}/` : `https://docs.rs/${p.name}/${p.version}/`;
    let text = replaceBlock(read(`${p.directory}/README.md`), 'badges', [versionBadge(p), p.registry === 'npm' ? badge('API Docs (development)', 'badge/API_docs-development-blue', api) : badge('docs.rs', `docsrs/${p.name}/${p.version}`, api), license].join('\n'));
    text = replaceBlock(text, 'installation', `\`\`\`sh\n${p.registry === 'npm' ? `npm install ${p.name}@${p.version}` : `cargo add ${p.name}@=${p.version}`}\n\`\`\``);
    text = replaceBlock(text, 'documentation', [
        `This README describes **${p.name} ${p.version}**. Registry badges show the current published channel, not your installed version.`,
        '',
        p.registry === 'npm' ? '- Exact installed APIs: follow `package.json` → `exports` → `dist/*.d.ts`; declaration maps point to the included `src/`. Only declared export paths are public.' : '- Exact installed APIs: read the included `src/`, or run `cargo doc --open` in your consuming project.',
        `- [Online guide (development branch)](${website}docs/${p.route}.html). The site may describe changes newer than this package.`,
        `- [${p.registry === 'npm' ? 'TypeScript API (development branch)' : 'Rust API for this version'}](${api}).`,
        `- [Source and documentation for this release](${repository}/tree/${p.tag}/${p.directory}).`,
        `- [Shared concepts for this release](${repository}/blob/${p.tag}/docs/core-concepts.md) and [compatibility](${repository}/blob/${p.tag}/docs/compatibility.md).`,
        `- [Plain Markdown documentation index (development branch)](${website}docs/llms.txt).`,
        ...(p.slug === 'webgpu' ? ['- Local complete recipes: [examples](./examples/README.md).'] : []),
        ...(p.slug === 'snapshot' ? ['- Local wire contract: [SPEC.md](./SPEC.md), `schema/`, `fixtures/` and `conformance/`.'] : []),
        ...(p.slug === 'inspector' ? ['- Local guides: [workbench](./GUIDE.md) and [themes](./THEMING.md).'] : []),
        ...(p.registry === 'cargo' ? ['- Complete Cargo recipes are included in `examples/`.'] : []),
    ].join('\n'));
    save(`${p.directory}/README.md`, text);
    // Pin repository links to this artifact's release tag, including cross-package guides.
    for (const file of markdownFiles(resolve(root, p.directory))) {
        const path = relative(root, file);
        const source = outputs.get(path.replaceAll('\\', '/')) ?? read(path);
        const body = source.replace(/https:\/\/github\.com\/uinosoft\/zenfg\/(blob|tree)\/(?:main|(?:npm|cargo)\/[^/]+\/v[^/]+)\//g, `${repository}/$1/${p.tag}/`)
            .replace(/\]\((\.\.\/[^)#]+)(#[^)]*)?\)/g, (match, destination, fragment = '') => {
                const target = resolve(file, '..', destination);
                if (!relative(resolve(root, p.directory), target).startsWith('..')) return match;
                return `](${repository}/blob/${p.tag}/${relative(root, target).replaceAll('\\', '/')}${fragment})`;
            });
        save(path, body);
    }
}
let compatibility = read('docs/compatibility.md');
const requirements = [
    `Native WebGPU; tooling Node ${workspace.engines.node}`, 'ESM, ES2022', 'Modern DOM; no WebGPU dependency',
    `Rust ${cargo.workspace.package['rust-version']}; wgpu ${cargo.workspace.dependencies.wgpu}`, `Rust ${cargo.workspace.package['rust-version']}; no wgpu`,
];
compatibility = replaceBlock(compatibility, 'compatibility', ['| ZenFG package | Version | Runtime/toolchain | Snapshot |','| --- | --- | --- | --- |',
    ...packages.map((p,i) => `| \`${p.name}\` | \`${p.version}\` | ${requirements[i]} | ${p.slug === 'webgpu' || p.slug === 'zenfg' ? `produces ${wire}` : p.slug === 'inspector' ? 'reads through @zenfg/snapshot' : `reads Legacy V0, Legacy Candidate V1, 1.1 (migrated), ${wire}`} |`),
].join('\n'));
compatibility = replaceBlock(compatibility, 'toolchains', `Repository tooling: Node \`${workspace.engines.node}\`, npm \`${workspace.engines.npm}\`, TypeScript \`${workspace.devDependencies.typescript}\`, Rust \`${cargo.workspace.package['rust-version']}\`, wgpu \`${cargo.workspace.dependencies.wgpu}\`.`);
save('docs/compatibility.md', compatibility);
for (const [file, value] of outputs) {
    if (read(file) === value) continue;
    if (check) failures.push(file); else write(file, value);
}
if (failures.length) throw new Error(`Run npm run docs:generate; generated documentation differs: ${[...new Set(failures)].join(', ')}`);
console.log(check ? 'Documentation metadata is up to date.' : 'Updated documentation metadata.');
