import { Worker } from 'node:worker_threads';

const workerUrl = new URL('./check-worker.mjs', import.meta.url);

export function runCheckerWorker(workerData, timeoutMs) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(workerUrl, { workerData });
        let settled = false;

        const finish = async (callback, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            worker.removeAllListeners();
            await worker.terminate();
            callback(value);
        };
        const timer = setTimeout(() => {
            const error = Object.assign(new Error(`Checker exceeded ${timeoutMs}ms`), { code: 'CHECK_TIMEOUT' });
            void finish(reject, error);
        }, timeoutMs);

        worker.once('message', message => {
            if (message.ok) {
                void finish(resolve, message.value);
                return;
            }
            const error = Object.assign(new Error(message.error?.message || 'Checker worker failed'), {
                code: message.error?.code,
                stack: message.error?.stack,
            });
            void finish(reject, error);
        });
        worker.once('error', error => void finish(reject, error));
        worker.once('exit', code => {
            if (!settled) void finish(reject, new Error(`Checker worker exited before returning a result (code ${code})`));
        });
    });
}
