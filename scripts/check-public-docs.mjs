import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const rootDir = resolve(import.meta.dirname, '..');
const packageSpecs = [
    { name: '@zenfg/snapshot', directory: 'packages/snapshot' },
    { name: '@zenfg/webgpu', directory: 'packages/webgpu' },
    { name: '@zenfg/inspector', directory: 'packages/inspector' },
];

function discoverPublicTypeScriptEntrypoints() {
    return packageSpecs.flatMap((packageSpec) => {
        const manifest = JSON.parse(readFileSync(resolve(rootDir, packageSpec.directory, 'package.json'), 'utf8'));
        return Object.entries(manifest.exports ?? {}).flatMap(([exportPath, target]) => {
            const typesTarget = target && typeof target === 'object' && !Array.isArray(target)
                ? target.types
                : undefined;
            if (typeof typesTarget !== 'string') return [];
            const match = typesTarget.replaceAll('\\', '/').match(/^\.\/dist\/(.+)\.d\.ts$/u);
            if (!match) {
                throw new Error(`${packageSpec.name} export ${exportPath} has unsupported types target ${typesTarget}.`);
            }
            return [{
                name: exportPath === '.' ? packageSpec.name : `${packageSpec.name}/${exportPath.slice(2)}`,
                source: `${packageSpec.directory}/src/${match[1]}.ts`,
            }];
        });
    });
}

const entrypointSpecs = discoverPublicTypeScriptEntrypoints();

function loadPackageConfig(directory) {
    const configPath = resolve(rootDir, directory, 'tsconfig.json');
    const loaded = ts.readConfigFile(configPath, (file) => readFileSync(file, 'utf8'));
    if (loaded.error) {
        throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n'));
    }
    return ts.parseJsonConfigFileContent(loaded.config, ts.sys, resolve(rootDir, directory), {
        noEmit: true,
    }, configPath);
}

const parsedConfigs = packageSpecs.map(({ directory }) => loadPackageConfig(directory));
const rootNames = [...new Set(parsedConfigs.flatMap(({ fileNames }) =>
    fileNames.filter((file) => file.replaceAll('\\', '/').includes('/packages/') && file.replaceAll('\\', '/').includes('/src/')),
))];
const program = ts.createProgram({
    rootNames,
    options: {
        ...parsedConfigs.find((_, index) => packageSpecs[index].name === '@zenfg/webgpu').options,
        baseUrl: rootDir,
        paths: {
            '@zenfg/snapshot': ['packages/snapshot/src/index.ts'],
            '@zenfg/snapshot/format': ['packages/snapshot/src/format.ts'],
        },
        noEmit: true,
        skipLibCheck: true,
    },
});
const checker = program.getTypeChecker();
const failures = [];
let exportedSymbolCount = 0;
let callableMemberCount = 0;
let localLinkCount = 0;
let rustTopLevelTypeCount = 0;

function resolveAlias(symbol) {
    const seen = new Set();
    let current = symbol;
    while ((current.flags & ts.SymbolFlags.Alias) !== 0 && !seen.has(current)) {
        seen.add(current);
        current = checker.getAliasedSymbol(current);
    }
    return current;
}

function hasDescription(symbol) {
    return ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim().length > 0;
}

function firstDeclaration(symbol) {
    return symbol.valueDeclaration ?? symbol.declarations?.[0];
}

function locationOf(symbol, fallback) {
    const declaration = firstDeclaration(symbol) ?? fallback;
    const sourceFile = declaration.getSourceFile();
    const position = sourceFile.getLineAndCharacterOfPosition(declaration.getStart(sourceFile));
    return `${relative(rootDir, sourceFile.fileName).replaceAll('\\', '/')}:${position.line + 1}`;
}

function isPublicCallableDeclaration(declaration) {
    // Deliberately gate methods, not every property in data-heavy Snapshot wire
    // models. Exported object types still need a useful top-level description.
    if (!ts.isMethodDeclaration(declaration) && !ts.isMethodSignature(declaration)) return false;
    const modifierFlags = ts.getCombinedModifierFlags(declaration);
    return (modifierFlags & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) === 0;
}

function checkCallableMembers(entrypointName, exportedName, symbol, entrypoint) {
    for (const member of symbol.members?.values() ?? []) {
        const callableDeclarations = (member.declarations ?? []).filter(isPublicCallableDeclaration);
        if (callableDeclarations.length === 0) continue;
        callableMemberCount += 1;
        if (!hasDescription(member)) {
            failures.push(`${locationOf(member, entrypoint)} ${entrypointName} export ${exportedName}.${member.getName()} has no public documentation.`);
        }
    }
}

for (const entrypointSpec of entrypointSpecs) {
    const entrypointPath = resolve(rootDir, entrypointSpec.source);
    const entrypoint = program.getSourceFile(entrypointPath);
    if (!entrypoint) {
        failures.push(`${entrypointSpec.source} is missing from the documentation program.`);
        continue;
    }
    const firstStatementStart = entrypoint.statements[0]?.getStart(entrypoint) ?? entrypoint.text.length;
    const packageDocumentation = /@packageDocumentation\b/u.test(entrypoint.text.slice(0, firstStatementStart));
    if (!packageDocumentation) {
        failures.push(`${entrypointSpec.source}:1 ${entrypointSpec.name} needs an @packageDocumentation comment.`);
    }
    const moduleSymbol = checker.getSymbolAtLocation(entrypoint);
    if (!moduleSymbol) {
        failures.push(`${entrypointSpec.source}:1 ${entrypointSpec.name} has no resolvable module symbol.`);
        continue;
    }
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
        if (exported.getName() === 'default') continue;
        exportedSymbolCount += 1;
        const resolved = resolveAlias(exported);
        if (!hasDescription(resolved)) {
            failures.push(`${locationOf(resolved, entrypoint)} ${entrypointSpec.name} export ${exported.getName()} has no public documentation.`);
        }
        checkCallableMembers(entrypointSpec.name, exported.getName(), resolved, entrypoint);
    }
}

const deferredRustDocSpecs = [
    'crates/zenfg/src/report.rs',
    'crates/zenfg-snapshot/src/types.rs',
];

for (const rustSource of deferredRustDocSpecs) {
    const sourcePath = resolve(rootDir, rustSource);
    if (!existsSync(sourcePath)) {
        failures.push(`${rustSource}:1 deferred Rust documentation source is missing.`);
        continue;
    }
    const lines = readFileSync(sourcePath, 'utf8').split(/\r?\n/u);
    let pendingDoc = false;
    let pendingDocHasText = false;
    let attributeDepth = 0;
    let fileTypeCount = 0;
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const trimmed = line.trim();
        if (attributeDepth > 0) {
            attributeDepth += [...line].filter((character) => character === '[').length;
            attributeDepth -= [...line].filter((character) => character === ']').length;
            continue;
        }
        if (/^\/\/\/(?:\s|$)/u.test(trimmed)) {
            pendingDoc = true;
            pendingDocHasText ||= trimmed.slice(3).trim().length > 0;
            continue;
        }
        if (trimmed.startsWith('#[')) {
            attributeDepth = [...line].filter((character) => character === '[').length
                - [...line].filter((character) => character === ']').length;
            continue;
        }
        // These two data-model files are rustfmt-gated, so a column-zero public
        // item is a reliable narrow definition of top level. This intentionally
        // does not try to parse fields, variants, impls, macros, or visibility
        // narrower than `pub`.
        const declaration = line.match(/^pub\s+(struct|enum|type)\s+([A-Za-z_][A-Za-z0-9_]*)/u);
        if (declaration) {
            fileTypeCount += 1;
            rustTopLevelTypeCount += 1;
            if (!pendingDoc || !pendingDocHasText) {
                failures.push(`${rustSource}:${index + 1} public ${declaration[1]} ${declaration[2]} needs an adjacent /// description before its attributes.`);
            }
        }
        pendingDoc = false;
        pendingDocHasText = false;
    }
    if (attributeDepth !== 0) {
        failures.push(`${rustSource}:1 contains an unterminated top-level attribute while checking Rust documentation.`);
    }
    if (fileTypeCount === 0) {
        failures.push(`${rustSource}:1 contains no recognized top-level public data-model types.`);
    }
}

function markdownWithoutCodeOrComments(markdown) {
    const withoutComments = markdown.replace(/<!--[\s\S]*?-->/gu, (comment) => comment.replace(/[^\r\n]/gu, ' '));
    let fence;
    return withoutComments.split(/\r?\n/u).map((line) => {
        const marker = line.match(/^\s*(`{3,}|~{3,})/u)?.[1];
        if (marker) {
            if (!fence) fence = marker[0];
            else if (marker[0] === fence) fence = undefined;
            return '';
        }
        return fence ? '' : line;
    }).join('\n');
}

function localMarkdownDestinations(markdown) {
    const destinations = [];
    const text = markdownWithoutCodeOrComments(markdown);
    for (const match of text.matchAll(/!?\[[^\]]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+[^)]*)?\)/gu)) {
        destinations.push({ destination: match[1], line: lineAt(text, match.index) });
    }
    for (const match of text.matchAll(/^\s*\[[^\]]+\]:\s*(<[^>]+>|\S+)/gmu)) {
        destinations.push({ destination: match[1], line: lineAt(text, match.index) });
    }
    return destinations;
}

function lineAt(text, offset) {
    return text.slice(0, offset).split(/\r?\n/u).length;
}

const markdownFiles = [
    'README.md',
    'README.zh-CN.md',
    ...readdirSync(resolve(rootDir, 'docs'), { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map((entry) => `docs/${entry.name}`),
    'packages/snapshot/README.md',
    'packages/webgpu/README.md',
    'packages/webgpu/README.zh-CN.md',
    'packages/webgpu/examples/README.md',
    'packages/inspector/README.md',
    'crates/zenfg/README.md',
    'crates/zenfg-snapshot/README.md',
];

for (const markdownFile of markdownFiles) {
    const filePath = resolve(rootDir, markdownFile);
    if (!existsSync(filePath)) {
        failures.push(`${markdownFile}:1 expected documentation file is missing.`);
        continue;
    }
    const markdown = readFileSync(filePath, 'utf8');
    for (const { destination: rawDestination, line } of localMarkdownDestinations(markdown)) {
        const destination = rawDestination.startsWith('<') && rawDestination.endsWith('>')
            ? rawDestination.slice(1, -1)
            : rawDestination;
        if (
            destination.startsWith('#')
            || destination.startsWith('/')
            || destination.startsWith('//')
            || /^[a-z][a-z0-9+.-]*:/iu.test(destination)
        ) {
            continue;
        }
        const pathOnly = destination.split('#', 1)[0].split('?', 1)[0];
        if (!pathOnly) continue;
        let decodedPath;
        try {
            decodedPath = decodeURIComponent(pathOnly);
        }
        catch {
            failures.push(`${markdownFile}:${line} has an invalid encoded local link: ${destination}`);
            continue;
        }
        localLinkCount += 1;
        const target = resolve(dirname(filePath), decodedPath);
        const workspacePath = relative(rootDir, target);
        const outsideWorkspace = workspacePath === '..' || workspacePath.startsWith(`..${sep}`) || isAbsolute(workspacePath);
        if (outsideWorkspace) {
            failures.push(`${markdownFile}:${line} local link escapes the workspace: ${destination}`);
        }
        else if (!existsSync(target)) {
            failures.push(`${markdownFile}:${line} links to missing local path: ${destination}`);
        }
    }
}

const verificationSummary = `${entrypointSpecs.length} public TypeScript entrypoints, ${exportedSymbolCount} exports, ${callableMemberCount} public callable members, ${rustTopLevelTypeCount} deferred Rust top-level types, and ${localLinkCount} local Markdown links`;
if (failures.length > 0) {
    process.stderr.write(`Public documentation check failed (${failures.length} issue${failures.length === 1 ? '' : 's'}):\n`);
    for (const failure of failures) process.stderr.write(`- ${failure}\n`);
    process.stderr.write(`Checked ${verificationSummary}.\n`);
    process.exitCode = 1;
}
else {
    process.stdout.write(`Verified ${verificationSummary}.\n`);
}
