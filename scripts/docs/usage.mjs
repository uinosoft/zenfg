import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

export function within(directory, file) {
    const path = relative(directory, file);
    return path !== '..' && !path.startsWith('../') && !path.startsWith('..\\') && !isAbsolute(path);
}
export function usagePath(directory) {
    const readme = resolve(directory, 'README.md');
    const text = readFileSync(readme, 'utf8');
    const markers = [...text.matchAll(/<!-- usage-source: ([^\r\n]+?) -->/g)];
    if (markers.length > 1) throw new Error('Duplicate usage-source in ' + readme);
    const local = markers[0]?.[1] ?? 'README.md';
    const path = resolve(directory, local);
    if (isAbsolute(local) || !within(resolve(directory), path) || !existsSync(path)
        || !within(realpathSync(directory), realpathSync(path))) {
        throw new Error('Usage source must exist inside its package: ' + local);
    }
    return path;
}
export function usageText(directory) {
    return readFileSync(usagePath(directory), 'utf8').replaceAll('\r\n', '\n');
}
