import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { walkFiles } from '../lib/files.mjs';
import { runCheckerWorker } from './check-worker-client.mjs';

export async function discoverCheckers(checkDirectory) {
    const files = (await walkFiles(checkDirectory))
        .filter(file => file.endsWith('.check.mjs'))
        .sort((a, b) => a.localeCompare(b));
    const checkers = [];
    const ids = new Map();
    for (const file of files) {
        const relative = path.relative(checkDirectory, file).replaceAll('\\', '/');
        const checker = await runCheckerWorker({
            action: 'describe',
            moduleUrl: pathToFileURL(file).href,
            file: relative,
        }, 30_000);
        if (ids.has(checker.id)) {
            throw new Error(`Duplicate checker id "${checker.id}" in ${ids.get(checker.id)} and ${checker.file}`);
        }
        ids.set(checker.id, checker.file);
        checkers.push(checker);
    }
    return checkers.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
