/**
 * Protocol layer for Agent Runtime.
 *
 * createCaller(config) → { generate, test }
 *   config.useCustom = false → ST native generateRaw
 *   config.useCustom = true → openaiCompatible or anthropicCompatible
 *
 * Unified return: { text: string }
 */

/**
 * Create a model caller based on runtime config.
 * @param {object} config - Agent config (useCustom, protocol, endpoint, apiKey, model)
 * @param {Function} stGenerateRaw - ST's native ctx.generateRaw (for non-custom fallback)
 * @returns {{ generate: (prompt: string) => Promise<string>, test: () => Promise<{ok: boolean, error?: string}> }}
 */
export function createCaller(config, stGenerateRaw) {
    if (!config?.useCustom) {
        return makeNativeCaller(stGenerateRaw);
    }
    if (config.protocol === 'anthropic') {
        return makeAnthropicCaller(config);
    }
    return makeOpenAICaller(config);
}

// ─── Native ST caller ────────────────────────────────────────────────

function makeNativeCaller(stGenerateRaw) {
    return {
        async generate(prompt) {
            const response = await stGenerateRaw({ prompt });
            return (typeof response === 'string') ? response : String(response ?? '');
        },
        async test() {
            return { ok: true }; // native always "connected" — user's main model is working
        },
    };
}

// ─── OpenAI Compatible ────────────────────────────────────────────────

function makeOpenAICaller(config) {
    const base = config.endpoint.replace(/\/+$/, '');

    return {
        async generate(prompt) {
            const resp = await fetch(`${base}/v1/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`,
                    'X-CSRF-Token': window.csrfToken ?? '',
                },
                body: JSON.stringify({
                    model: config.model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.7,
                    max_tokens: 4096,
                }),
            });
            if (!resp.ok) {
                const err = await resp.text().catch(() => '');
                throw new Error(`OpenAI API error ${resp.status}: ${err.substring(0, 200)}`);
            }
            const data = await resp.json();
            return data.choices?.[0]?.message?.content ?? '';
        },

        async test() {
            try {
                const resp = await fetch(`${base}/v1/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${config.apiKey}`,
                        'X-CSRF-Token': window.csrfToken ?? '',
                    },
                    body: JSON.stringify({
                        model: config.model,
                        messages: [{ role: 'user', content: 'Hi. Respond with just "ok".' }],
                        temperature: 0,
                        max_tokens: 10,
                    }),
                });
                if (!resp.ok) {
                    const err = await resp.text().catch(() => '');
                    return { ok: false, error: `HTTP ${resp.status}: ${err.substring(0, 300)}` };
                }
                const data = await resp.json();
                const text = data.choices?.[0]?.message?.content ?? '';
                if (text.trim()) return { ok: true };
                return { ok: false, error: 'Empty response from API' };
            } catch (e) {
                return { ok: false, error: e.message };
            }
        },
    };
}

// ─── Anthropic Compatible ─────────────────────────────────────────────

function makeAnthropicCaller(config) {
    const base = config.endpoint.replace(/\/+$/, '');

    return {
        async generate(prompt) {
            const resp = await fetch(`${base}/v1/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': config.apiKey,
                    'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({
                    model: config.model,
                    max_tokens: 4096,
                    messages: [{ role: 'user', content: prompt }],
                }),
            });
            if (!resp.ok) {
                const err = await resp.text().catch(() => '');
                throw new Error(`Anthropic API error ${resp.status}: ${err.substring(0, 200)}`);
            }
            const data = await resp.json();
            return data.content?.[0]?.text ?? '';
        },

        async test() {
            try {
                const resp = await fetch(`${base}/v1/messages`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': config.apiKey,
                        'anthropic-version': '2023-06-01',
                    },
                    body: JSON.stringify({
                        model: config.model,
                        max_tokens: 10,
                        messages: [{ role: 'user', content: 'Hi' }],
                    }),
                });
                if (!resp.ok) {
                    const err = await resp.text().catch(() => '');
                    return { ok: false, error: `HTTP ${resp.status}: ${err.substring(0, 300)}` };
                }
                const data = await resp.json();
                return data.content?.[0]?.text ? { ok: true } : { ok: false, error: 'Empty response' };
            } catch (e) {
                return { ok: false, error: e.message };
            }
        },
    };
}
