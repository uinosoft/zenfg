import fs from 'node:fs';
import { join } from 'node:path';

// Configured roots must exist, but may contain no Node tests (e.g. browser-only).
export function collectTestFiles(dir) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
        throw new Error(`Cannot read test directory "${dir}": ${error.message}`, { cause: error });
    }

    const files = [];
    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            // These suites have separate browser/GPU runners.
            if (entry.name !== 'browser' && entry.name !== 'gpu') {
                files.push(...collectTestFiles(fullPath));
            }
        } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
            files.push(fullPath);
        }
    }
    return files;
}
