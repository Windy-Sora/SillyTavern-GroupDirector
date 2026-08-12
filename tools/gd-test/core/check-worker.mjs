import { parentPort, workerData } from 'node:worker_threads';
import { normalizeCheckResult, validateChecker } from './check-contract.mjs';
import { projectServices } from './project-index.mjs';

function serializeError(error) {
    return {
        code: error?.code,
        message: error?.message || String(error),
        stack: error?.stack,
    };
}

try {
    const loaded = await import(workerData.moduleUrl);
    const checker = validateChecker(loaded.default, workerData.file);
    if (workerData.action === 'describe') {
        parentPort.postMessage({
            ok: true,
            value: {
                id: checker.id,
                title: checker.title,
                version: checker.version,
                order: checker.order,
                timeoutMs: checker.timeoutMs,
                file: checker.file,
                moduleUrl: workerData.moduleUrl,
            },
        });
    } else if (workerData.action === 'run') {
        if (checker.id !== workerData.checkerId) {
            throw new Error(`Checker id changed from "${workerData.checkerId}" to "${checker.id}"`);
        }
        const project = workerData.project;
        const context = Object.freeze({
            root: project.root,
            config: project.config,
            project,
            services: projectServices,
        });
        parentPort.postMessage({
            ok: true,
            value: normalizeCheckResult(await checker.run(context), checker.id),
        });
    } else {
        throw new Error(`Unknown checker worker action: ${workerData.action}`);
    }
} catch (error) {
    parentPort.postMessage({ ok: false, error: serializeError(error) });
}
