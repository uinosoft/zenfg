import { Application } from 'typedoc';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, read, write, pages, recipes, packages, publicEntrypoints, contentDir, repository, website, git, publishedVersion, siteBase } from './catalog.mjs';
import { hideRustDoctestLines } from './markdown.mjs';

export function transformContent(text, source, mapping, commit) {
    // Repository presentation has local HTML picture URLs and GitHub-specific layout.
    // Docs already display the brand in navigation; retain the semantic article below it.
    text = text.replace(/<!-- readme-hero:start -->[\s\S]*?<!-- readme-hero:end -->\s*/g, '');
    text = text.replace(/<!-- readme-showcase:start -->[\s\S]*?<!-- readme-showcase:end -->\s*/g, '');
    const history = [];
    text = text.replace(/<!-- generated:documentation:start -->[\s\S]*?<!-- generated:documentation:end -->/g, block => block.replace(/https:\/\/github\.com\/uinosoft\/zenfg\/(?:blob|tree)\/(?:npm|cargo)\/[^)\s]+/g, url => { history.push(url); return `@HISTORY@${history.length - 1}`; }));
    text = text.replace(/<!-- generated:badges:start -->[\s\S]*?<!-- generated:badges:end -->/g, '')
        .replace(/\[!\[[^\]]*\]\([^)]*\)\]\(([^)]*)\)/g, '[Published package]($1)')
        .replace(/^English \|.*$|^\[English\].*$/gm, '');
    const rewrite = destination => {
        if (destination.startsWith('@HISTORY@')) return destination;
        let value = destination;
        const repoMatch = value.match(/^https:\/\/github\.com\/uinosoft\/zenfg\/(?:blob|tree)\/(?:main|(?:npm|cargo)\/[^/]+\/v[^/]+)\/(.+)$/);
        if (repoMatch) value = `/${repoMatch[1]}`;
        else if (value.startsWith(website + 'docs/')) return `@DOCS@/${value.slice((website + 'docs/').length)}`;
        else if (value.startsWith(website)) return value;
        else if (/^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(value)) return value;
        const [pathname, fragment] = value.split('#');
        const target = value.startsWith('/') ? pathname.slice(1) : relative(root, resolve(root, dirname(source), decodeURIComponent(pathname.split('?')[0]))).replaceAll('\\', '/');
        if (target === 'assets/brand/zenfg-icon.svg') return '@DOCS@/brand/zenfg-icon.svg';
        const route = mapping.get(target);
        if (route) return `@DOCS@/${route === 'index' ? '' : route + '.html'}${fragment ? '#' + fragment : ''}`;
        return `${repository}/blob/${commit}/${target}${fragment ? '#' + fragment : ''}`;
    };
    // Keep code samples literal. Transform links in prose only.
    text = text.split(/(```[^\n]*\n[\s\S]*?```|~~~[^\n]*\n[\s\S]*?~~~)/g).map((part, i) => i % 2 ? part : part
        .replace(/(\]\()([^\s)]+)(\))/g, (_, left, destination, right) => left + rewrite(destination) + right)
        .replace(/^(\[[^\]]+\]:\s*)(\S+)/gm, (_, left, destination) => left + rewrite(destination))).join('');
    return hideRustDoctestLines(text).replace(/@HISTORY@(\d+)/g, (_, index) => history[Number(index)]).replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
function allMarkdown(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(e => e.isDirectory() ? allMarkdown(resolve(directory, e.name)) : e.name.endsWith('.md') ? [resolve(directory, e.name)] : []);
}
export async function prepare({ api = true } = {}) {
    const commit = git('rev-parse', 'HEAD');
    const base = siteBase();
    const docsBase = `${base}docs/`;
    const allPages = [...pages, ...recipes];
    const mapping = new Map(allPages.map(p => [p.source, p.route]));
    // This literal directory is exclusively generated content inside the workspace.
    if (api && existsSync(contentDir)) {
        if (![resolve(root, 'apps/docs/.generated/production'), resolve(root, 'apps/docs/.generated/development')].includes(contentDir)) throw new Error('Unexpected generated directory.');
        rmSync(contentDir, { recursive: true, force: true });
    }
    const meta = { commit, base, docsBase, packages: packages.map(p => ({ name: p.name, version: p.version, registry: p.registry, slug: p.slug, tag: p.tag, published: publishedVersion(p) })), pages: [] };
    for (const page of allPages) {
        const raw = read(page.source);
        let body = page.code ? `# ${page.title}\n\nThis is the complete, compile-checked package recipe. The caller owns the device and application state.\n\n\`\`\`${page.code}\n${raw}\n\`\`\`\n` : transformContent(raw, page.source, mapping, commit);
        body = body.replaceAll('@SITE@/', base).replaceAll('@DOCS@/', '/');
        const sourceUrl = `${repository}/blob/${commit}/${page.source}`;
        const item = { ...page, sourceUrl, editUrl: `${repository}/edit/main/${page.source}`, markdownUrl: `${docsBase}${page.route}.md` };
        meta.pages.push(item);
        const frontmatter = `---\ntitle: ${JSON.stringify(page.title)}\nsourceUrl: ${JSON.stringify(sourceUrl)}\neditUrl: ${JSON.stringify(item.editUrl)}\nmarkdownUrl: ${JSON.stringify(item.markdownUrl)}\n---\n\n`;
        write(resolve(contentDir, `${page.route}.md`), frontmatter + body);
    }
    if (api) {
        const entrypoints = publicEntrypoints();
        // Generated per-package configuration feeds exactly the same public entries as docs:check.
        const apiPackages = packages.filter(p => p.registry === 'npm');
        const app = await Application.bootstrapWithPlugins({
            entryPointStrategy: 'packages', entryPoints: apiPackages.map(p => resolve(root, p.directory).replaceAll('\\', '/')),
            packageOptions: { tsconfig: 'tsconfig.build.json', readme: 'none', validation: { notExported: false }, compilerOptions: { rootDir: root, paths: { '@zenfg/snapshot': [resolve(root, 'packages/snapshot/src/index.ts')], '@zenfg/snapshot/format': [resolve(root, 'packages/snapshot/src/format.ts')] } } },
            plugin: ['typedoc-plugin-markdown', 'typedoc-vitepress-theme'],
            externalSymbolLinkMappings: { typescript: { GPUBuffer: 'https://gpuweb.github.io/gpuweb/#gpubuffer', GPUTexture: 'https://gpuweb.github.io/gpuweb/#gputexture' } },
            name: 'ZenFG TypeScript API', readme: 'none', entryFileName: 'index',
            out: resolve(contentDir, 'api'), docsRoot: contentDir,
            gitRevision: commit, excludePrivate: true, excludeProtected: true,
            validation: { invalidLink: true, notExported: false },
        });
        app.options.addReader({
            name: 'zenfg-public-exports', order: 150, supportsPackages: true,
            read(container, _logger, cwd) {
                const p = apiPackages.find(p => resolve(root, p.directory) === resolve(cwd));
                if (!p) return;
                container.setValue('entryPoints', entrypoints.filter(e => e.slug === p.slug).map(e => resolve(root, e.source).replaceAll('\\', '/')));
                container.setValue('tsconfig', resolve(root, p.directory, 'tsconfig.build.json'));
            },
        });
        const project = await app.convert();
        if (!project || app.logger.hasErrors()) throw new Error('TypeDoc conversion failed.');
        app.validate(project);
        if (app.logger.hasErrors() || app.logger.hasWarnings()) throw new Error('TypeDoc reported invalid documentation.');
        for (const pkg of project.children ?? []) {
            const p = apiPackages.find(p => p.name === pkg.name);
            if (!p) throw new Error(`Unexpected documented package ${pkg.name}`);
            pkg.name = p.slug;
            const documented = new Set((pkg.children ?? []).map(c => c.name === 'index' ? '.' : c.name || '.'));
            for (const e of entrypoints.filter(e => e.slug === p.slug)) {
                if (!documented.has(e.subpath === '.' ? '.' : e.subpath.slice(2))) throw new Error(`Missing public API entrypoint ${e.name}`);
            }
            for (const child of pkg.children ?? []) if (!child.name || child.name === 'index') child.name = 'root';
        }
        await app.generateOutputs(project);
        if (app.logger.hasErrors()) throw new Error('TypeDoc generation failed.');
    }
    for (const file of allMarkdown(resolve(contentDir, 'api'))) {
        const route = relative(contentDir, file).replaceAll('\\', '/').replace(/\.md$/, '');
        const body = read(file);
        const sourceUrl = body.match(/https:\/\/github\.com\/uinosoft\/zenfg\/blob\/[^)\s]+/)?.[0] ?? `${repository}/tree/${commit}/packages`;
        meta.pages.push({ route, title: body.match(/^# (.+)$/m)?.[1] ?? route, group: 'TypeScript API', sourceUrl, editUrl: sourceUrl.includes('/blob/') ? sourceUrl.replace(`/blob/${commit}/`, '/edit/main/') : undefined, markdownUrl: `${docsBase}${route}.md` });
    }
    write(resolve(contentDir, 'metadata.json'), JSON.stringify(meta, null, 2));
    console.log(`Prepared ${meta.pages.length} documentation pages at ${docsBase} (${commit.slice(0, 8)}).`);
    return meta;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepare();
