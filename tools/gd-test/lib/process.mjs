import { spawn } from 'node:child_process';

export function runCommand(command, args, {
    cwd,
    env = process.env,
    timeoutMs = 120_000,
    echo = false,
    signal: abortSignal,
} = {}) {
    return new Promise(resolve => {
        const startedAt = Date.now();
        if (abortSignal?.aborted) {
            resolve({ command, args, code: null, signal: null, stdout: '', stderr: 'Command cancelled', timedOut: false, durationMs: 0 });
            return;
        }
        const child = spawn(command, args, {
            cwd,
            env,
            shell: false,
            windowsHide: true,
        });

        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const cancel = () => child.kill('SIGKILL');
        abortSignal?.addEventListener('abort', cancel, { once: true });
        const timer = timeoutMs > 0
            ? setTimeout(() => {
                timedOut = true;
                cancel();
            }, timeoutMs)
            : null;

        child.stdout?.on('data', chunk => {
            const text = chunk.toString();
            stdout += text;
            if (echo) process.stdout.write(text);
        });
        child.stderr?.on('data', chunk => {
            const text = chunk.toString();
            stderr += text;
            if (echo) process.stderr.write(text);
        });

        child.on('error', error => {
            abortSignal?.removeEventListener('abort', cancel);
            if (timer) clearTimeout(timer);
            resolve({
                command,
                args,
                code: null,
                signal: null,
                stdout,
                stderr: `${stderr}${error.stack || error.message}`,
                timedOut,
                durationMs: Date.now() - startedAt,
            });
        });

        child.on('close', (code, signal) => {
            abortSignal?.removeEventListener('abort', cancel);
            if (timer) clearTimeout(timer);
            resolve({
                command,
                args,
                code,
                signal,
                stdout,
                stderr,
                timedOut,
                durationMs: Date.now() - startedAt,
            });
        });
    });
}

export async function mapLimit(items, limit, worker) {
    if (!items.length) return [];
    const results = new Array(items.length);
    let nextIndex = 0;

    async function consume() {
        while (true) {
            const index = nextIndex++;
            if (index >= items.length) return;
            results[index] = await worker(items[index], index);
        }
    }

    const consumers = Array.from(
        { length: Math.max(1, Math.min(limit, items.length)) },
        () => consume(),
    );
    await Promise.all(consumers);
    return results;
}
