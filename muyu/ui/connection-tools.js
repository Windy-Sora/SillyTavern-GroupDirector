/** Explicit connection diagnostics; draft edits/unmount invalidate late replies. */
export function createConnectionTools({ doc, parent, endpoint, model, key, thinking, controller, lang }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const node = (tag, text, owner = parent) => { const el = doc.createElement(tag); el.textContent = text; owner.append(el); return el; };
    const row = node('div', ''); row.className = 'gd-muyu-connection-tools';
    const test = node('button', t('测试连接', 'Test connection'), row), list = node('button', t('获取模型', 'Fetch models'), row);
    for (const b of [test, list]) { b.type = 'button'; b.className = 'menu_button'; }
    const label = node('label', t('模型菜单（也可手动填写上方模型）', 'Model menu (manual entry above is also supported)'));
    const select = node('select', '', label); select.className = 'text_pole';
    const manual = node('option', t('手动填写模型', 'Enter model manually'), select); manual.value = '';
    const status = node('p', ''); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    node('small', t('获取模型只请求此接口的模型目录。连接测试会发送一条固定测试消息，可能产生少量费用；不发送聊天正文，也不自动启用连接。', 'Model discovery requests only this endpoint’s directory. Testing sends a fixed message and may incur a small charge; it sends no chat content and does not enable the connection.'));
    let abort = null, epoch = 0, disposed = false;
    const signature = () => JSON.stringify([endpoint.value, model.value, key.value, thinking.checked]);
    const invalidate = () => { epoch++; abort?.abort(); abort = null; test.disabled = list.disabled = false; status.textContent = ''; select.replaceChildren(); const option = node('option', t('手动填写模型', 'Enter model manually'), select); option.value = ''; };
    for (const field of [endpoint, model, key, thinking]) field.addEventListener('input', invalidate);
    select.onchange = () => {
        if (!select.value) return;
        epoch++; abort?.abort(); abort = null; test.disabled = list.disabled = false;
        model.value = select.value; status.textContent = '';
    };
    async function run(kind) {
        const current = ++epoch, draft = signature(); abort?.abort(); const request = abort = new AbortController();
        test.disabled = list.disabled = true; status.textContent = t('正在请求…', 'Requesting…');
        try {
            const result = await controller.probeConnection({ endpoint: endpoint.value.trim(), apiKey: key.value, model: model.value.trim(), profile: 'deepseek', thinking: thinking.checked, supportsTools: true }, { kind, signal: request.signal });
            if (disposed || current !== epoch || draft !== signature()) return;
            if (kind === 'models') {
                select.replaceChildren(); const option = node('option', t('手动填写模型', 'Enter model manually'), select); option.value = '';
                for (const id of result) { const option = node('option', id, select); option.value = id; }
                select.value = result.includes(model.value) ? model.value : '';
                status.textContent = t(`已获取 ${result.length} 个模型；选择后仍需启用连接。`, `Fetched ${result.length} models; enable the connection after choosing.`);
            } else status.textContent = t('连接测试成功：收到模型回复。工具调用兼容性尚未验证。', 'Connection test passed: model replied. Tool-call compatibility has not been verified.');
        } catch (error) {
            if (disposed || current !== epoch || draft !== signature()) return;
            const messages = { MODEL_AUTH_ERROR: t('服务拒绝认证，请检查密钥及访问权限。', 'Authentication rejected. Check the key and access rights.'), MODEL_NETWORK_ERROR: t('网络请求失败，可能是断网或 CORS；不能据此判断密钥错误。', 'Network failure, possibly connectivity or CORS; this does not prove the key is wrong.'), MODEL_RATE_LIMIT: t('服务限流，请稍后重试。', 'Rate limited. Try again later.'), CONNECTION_TEST_TIMEOUT: t('请求超时，请稍后重试。', 'Request timed out. Try again later.') };
            status.textContent = messages[error?.code || error?.message] || t('请求未成功，请检查接口、密钥、模型及服务支持情况。', 'Request failed. Check endpoint, key, model and service support.');
        } finally { if (!disposed && current === epoch) { test.disabled = list.disabled = false; abort = null; } }
    }
    test.onclick = () => run('test'); list.onclick = () => run('models');
    return { dispose() { disposed = true; epoch++; abort?.abort(); } };
}
