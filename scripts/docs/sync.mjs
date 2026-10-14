import { packages, pages, workspace, cargo, read, write, repository, website, snapshotVersion } from './catalog.mjs';
import { existsSync } from 'node:fs';
import { generatedBlocks, localizeLinks, syncLanguage, sourceHeadings, translationMetadata, withTranslationMetadata, translationPath } from './i18n.mjs';
import GithubSlugger from 'github-slugger';
import { usagePath } from './usage.mjs';
import { anchors, markdown, markdownFiles, packageRepositoryLinks, mapProseLinks } from './markdown.mjs';
import { dirname, relative, resolve } from 'node:path';
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
        badge('Documentation', 'badge/docs-online-blue', `${website}docs/${chinese ? 'zh-CN/' : ''}`), license,
        badge('Release status', packages.some(p => p.version.includes('-')) ? 'badge/status-prerelease-orange' : 'badge/status-released-blue', `${repository}/blob/main/CHANGELOG.md`),
    ].map(value => value.replace(/^\[!\[([^\]]+)\]\(([^)]+)\)\]\(([^)]+)\)$/, '<a href="$3"><img src="$2" alt="$1"></a>')).join('\n').replace(/^/, '<p align="center">\n').concat('\n</p>'));
    const descriptions = chinese ? ['TypeScript/WebGPU FrameGraph 运行时', `Snapshot ${wire} 类型、编解码、验证与规范`, '可嵌入的 DOM Inspector', 'Rust/wgpu FrameGraph 运行时', `Rust Snapshot ${wire} 编解码、验证与迁移`] : ['TypeScript/WebGPU FrameGraph runtime', `Snapshot ${wire} types, codec, validation and specification`, 'Embeddable DOM Inspector', 'Rust/wgpu FrameGraph runtime', `Rust Snapshot ${wire} codec, validation and migration`];
    text = replaceBlock(text, 'packages', [`| ${chinese ? '包 | 用途 | 发布版本 | 文档' : 'Package | Purpose | Published version | Documentation'} |`, '| --- | --- | --- | --- |',
        ...packages.map((p, i) => `| [\`${p.name}\`](${p.directory}/README${chinese ? '.zh-CN' : ''}.md) | ${descriptions[i]} | ${versionBadge(p)} | [${chinese ? '指南' : 'Guide'}](${website}docs/${chinese ? 'zh-CN/' : ''}${p.route}.html) |`),
    ].join('\n'));
    save(file, text);
}
for (const p of packages) {
    const api = p.registry === 'npm' ? `${website}docs/api/${p.slug}/` : `https://docs.rs/${p.name}/${p.version}/`;
    let text = replaceBlock(read(`${p.directory}/README.md`), 'badges', [versionBadge(p), p.registry === 'npm' ? badge('API Docs (development)', 'badge/API_docs-development-blue', api) : badge('docs.rs', `docsrs/${p.name}/${p.version}`, api), license.replace('/blob/main/', '/blob/' + p.tag + '/')].join('\n'));
    text = replaceBlock(text, 'installation', `\`\`\`sh\n${p.registry === 'npm' ? `npm install ${p.name}@${p.version}` : `cargo add ${p.name}@=${p.version}`}\n\`\`\``);
    text = replaceBlock(text, 'documentation', [
        `The package manifest declares **${p.name} ${p.version}**. Registry badges show the current published channel, not your installed version.`,
        '',
        p.registry === 'npm' ? '- Exact installed APIs: follow `package.json` → `exports` → `dist/*.d.ts`; declaration maps point to the included `src/`. Only declared export paths are public.' : '- Exact installed APIs: read the included `src/`, or run `cargo doc --open` in your consuming project.',
        `- [Online guide (development branch)](${website}docs/${p.route}.html). The site may describe changes newer than this package.`,
        `- [${p.registry === 'npm' ? 'TypeScript API (development branch)' : 'Rust API for this version'}](${api}).`,
        `- [Source and documentation for this release](${repository}/tree/${p.tag}/${p.directory}).`,
        '- Usage contracts are maintained in this package; follow its local guides. Historical source links describe the named release, which may precede current development changes.',
        p.slug === 'zenfg-snapshot' ? '- [Package upgrade notes][zenfg-snapshot-migration].' : '- [Package upgrade notes](./docs/MIGRATION.md).',
        `- [Plain Markdown documentation index (development branch)](${website}docs/llms.txt).`,
        ...(p.slug === 'webgpu' ? ['- Local complete recipes: [examples](./examples/README.md).'] : []),
        ...(p.slug === 'snapshot' ? ['- Local wire contract: [SPEC.md](./SPEC.md), `schema/`, `fixtures/` and `conformance/`.'] : []),
        ...(p.slug === 'inspector' ? ['- Local guides: [workbench](./GUIDE.md) and [themes](./THEMING.md).'] : []),
        ...(p.registry === 'cargo' ? ['- Complete Cargo recipes are included in `examples/`.'] : []),
    ].join('\n'));
    const usage = relative(root, usagePath(resolve(root, p.directory))).replaceAll('\\', '/');
    if (usage !== p.directory + '/README.md') {
        const source = read(usage), slugger = new GithubSlugger(), rows = [];
        const existing = anchors(text.replace(/<!-- generated:usage:start -->[\s\S]*?<!-- generated:usage:end -->/g, ''));
        const tokens = markdown.parse(source, {});
        tokens.forEach((token, i) => {
            if (token.type !== 'heading_open') return;
            const title = tokens[i + 1].content;
            const plain = tokens[i + 1].children?.filter(t => t.type !== 'html_inline').map(t => t.content).join('') ?? title;
            const id = slugger.slug(plain);
            if (!['h2', 'h3'].includes(token.tag) || existing.has(id)) return;
            const local = relative(resolve(root, p.directory), resolve(root, usage)).replaceAll('\\', '/');
            rows.push('<a id="' + id + '"></a>\n\n- [' + title + '](./' + local + '#' + id + ')');
        });
        text = replaceBlock(text, 'usage', rows.join('\n\n'));
    }
    save(`${p.directory}/README.md`, text);
    // Explicit revisions are historical choices, not manifest-version metadata.
    for (const file of markdownFiles(resolve(root, p.directory)).filter(file => !relative(resolve(root, p.directory), file).replaceAll('\\', '/').startsWith('skills/'))) {
        const path = relative(root, file);
        const source = outputs.get(path.replaceAll('\\', '/')) ?? read(path);
        save(path, packageRepositoryLinks(source, file, resolve(root, p.directory), root, repository));
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
compatibility = replaceBlock(compatibility, 'toolchains', `Repository tooling: Node \`${workspace.engines.node}\`, pnpm \`${workspace.packageManager.split('@')[1]}\`, npm publishing client \`${workspace.devDependencies.npm}\`, TypeScript \`${workspace.devDependencies.typescript}\`, Rust \`${cargo.workspace.package['rust-version']}\`, wgpu \`${cargo.workspace.dependencies.wgpu}\`.`);
save('docs/compatibility.md', compatibility);
// Generated facts stay under the existing metadata owner. Translations never
// become a second manually editable source of versions or install commands.
const metadataLabels = new Map([
    ['The package manifest declares', '包清单声明'],
    ['Registry badges show the current published channel, not your installed version.', '注册表徽章显示当前发布渠道，并非已安装版本。'],
    ['Exact installed APIs: follow', '已安装版本的准确 API：查看'],
    ['declaration maps point to the included', '声明映射指向包内的'],
    ['Only declared export paths are public.', '只有声明的导出路径属于公共 API。'],
    ['Exact installed APIs: read the included', '已安装版本的准确 API：阅读包内的'],
    ['or run', '或运行'], ['in your consuming project.', '（在使用该包的项目中）。'],
    ['Online guide (development branch)', '在线指南（开发分支）'],
    ['The site may describe changes newer than this package.', '网站可能包含晚于此包版本的变更。'],
    ['TypeScript API (development branch)', 'TypeScript API（开发分支，英文）'], ['Rust API for this version', '此版本的 Rust API（英文）'],
    ['Source and documentation for this release', '此发布版本的源码与文档'],
    ['Usage contracts are maintained in this package; follow its local guides. Historical source links describe the named release, which may precede current development changes.', '使用约定由本包维护，请阅读包内指南。历史源码链接对应指定发布版本，可能早于当前开发分支。'],
    ['Package upgrade notes', '包升级说明'], ['Plain Markdown documentation index (development branch)', '纯 Markdown 文档索引（开发分支）'],
    ['Local complete recipes:', '包内完整示例：'], ['Local wire contract:', '包内数据格式约定：'], ['Local guides:', '包内指南：'],
    ['Complete Cargo recipes are included in', '完整 Cargo 示例位于'], ['workbench', '工作台'], ['themes', '主题'],
    ['| ZenFG package | Version | Runtime/toolchain | Snapshot |', '| ZenFG 包 | 版本 | 运行环境／工具链 | Snapshot |'],
    ['Repository tooling:', '仓库工具链：'],
]);
for (const page of pages) save(page.source, syncLanguage(outputs.get(page.source) ?? read(page.source), page.source));
for (const page of pages) {
    const file = translationPath(page.source);
    if (!existsSync(resolve(root, file))) continue;
    let text = outputs.get(file) ?? read(file);
    const english = outputs.get(page.source) ?? read(page.source);
    for (const block of generatedBlocks(english)) {
        if (page.source === 'README.md') continue; // Root bilingual blocks are rendered above.
        let value = block.text.replace(/^<!-- generated:[^\n]+ -->\n|\n<!-- generated:[^\n]+ -->$/g, '');
        if (block.name === 'usage') {
            const usage = relative(root, usagePath(resolve(root, dirname(page.source)))).replaceAll('\\', '/');
            const original = sourceHeadings(read(usage));
            const translated = existsSync(resolve(root, translationPath(usage))) ? sourceHeadings(read(translationPath(usage))) : original;
            const titles = new Map(original.map((h, i) => [h.id, translated[i]?.title ?? h.title]));
            value = value.replace(/\n- \[[^\n]+?\]\(([^\n]+)#([^)]*)\)/g, (match, path, id) => titles.has(id) ? `\n- [${titles.get(id)}](${path}#${id})` : match);
        } else if (block.name !== 'language') {
            const destinations = [];
            value = mapProseLinks(value, url => { destinations.push(url); return `@METADATA_LINK_${destinations.length - 1}@`; });
            value = value.split(/(```[^\n]*\n[\s\S]*?```|`+[^`\n]*`+)/g).map((part, i) => {
                if (i % 2) return part;
                for (const [en, zh] of metadataLabels) part = part.replaceAll(en, zh);
                return part;
            }).join('');
            value = value.replace(/@METADATA_LINK_(\d+)@/g, (_, index) => destinations[Number(index)]);
        }
        if (!text.includes(`<!-- generated:${block.name}:start -->`)) text += '\n' + block.text + '\n';
        text = replaceBlock(text, block.name, value);
    }
    text = syncLanguage(localizeLinks(text, page.source), page.source, true);
    if (text.includes('<!-- translation: ')) {
        const metadata = translationMetadata(text);
        text = withTranslationMetadata(text, page.source, metadata.sourceHash, metadata.state);
    }
    save(file, text);
}
for (const [file, value] of outputs) {
    if (read(file) === value) continue;
    if (check) failures.push(file); else write(file, value);
}
if (failures.length) throw new Error(`Run pnpm run docs:generate; generated documentation differs: ${[...new Set(failures)].join(', ')}`);
console.log(check ? 'Documentation metadata is up to date.' : 'Updated documentation metadata.');
