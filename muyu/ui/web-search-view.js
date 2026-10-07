import { WEB_DEFAULTS, WEB_RANGES } from '../web/contract.js';
import { createFormFeedback } from './form-feedback.js';
import { bindAutoSave } from './auto-save.js';

/** Composer switch and stable settings editor; toggling never sends the user's draft. */
export function createWebSearchView({ doc, settings, toolbar, composer, controller, act, openSettings, lang }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const node = (tag, text, parent) => { const el = doc.createElement(tag); if (text) el.textContent = text; parent.append(el); return el; };
    const button = (text, parent) => { const el = node('button', text, parent); el.type = 'button'; el.className = 'menu_button'; return el; };
    const field = (label, type, parent) => { const wrap = node('label', label, parent), el = node('input', '', wrap); el.type = type; if (type !== 'checkbox') el.className = 'text_pole'; return el; };
    const toggle = button('', toolbar); toggle.className += ' gd-muyu-web-toggle';
    const icon = node('span', '', toggle); icon.className = 'fa-solid fa-globe'; icon.setAttribute('aria-hidden', 'true');
    const toggleLabel = node('span', t('联网', 'Web'), toggle);
    const hint = node('small', t('联网已开启 · 必要的搜索词会发送至 Brave，可能计费', 'Web enabled · Necessary queries go to Brave and may incur charges'), composer); hint.className = 'gd-muyu-web-hint'; hint.hidden = true;
    const editor = node('details', '', settings); editor.className = 'gd-muyu-web-settings';
    node('summary', t('联网搜索', 'Web search'), editor);
    node('p', t('小地球只控制暮羽的网页搜索。开启后由暮羽按需搜索，不必逐次授权；全权限模式也遵守这个开关。切换模型连接或刷新后关闭。', 'The globe controls Muyu web search. When enabled, Muyu searches as needed without per-search approval; full access respects this switch. Reconnecting or reloading turns it off.'), editor);
    node('small', t('搜索服务：Brave Search API。需要独立的搜索密钥；与模型 API Key 无关。', 'Provider: Brave Search API. Requires a separate search key, not your model API key.'), editor);
    const key = field(t('Brave Search API 密钥', 'Brave Search API key'), 'password', editor); key.autocomplete = 'off';
    const remember = field(t('记住搜索密钥', 'Remember search key'), 'checkbox', editor);
    node('small', t('勾选后保存在酒馆插件设置中，未加密，同源脚本及酒馆设置备份可能读取；配置档导出会剔除密钥。不勾选则仅本页保留。搜索密钥不会发给模型。', 'Remembered keys are stored unencrypted in ST extension settings and may be read by same-origin scripts or settings backups; config-profile exports strip them. Otherwise the key stays in this page only. It is never sent to the model.'), editor);
    const limits = node('details', '', editor); limits.className = 'gd-muyu-settings-advanced';
    node('summary', t('搜索次数与资料预算', 'Search limits and data budget'), limits);
    node('small', t('数字完成编辑后自动保存，下一轮生效；不改变密钥或联网开关。', 'Limits auto-save after editing for the next task; credentials and the web switch stay unchanged.'), limits);
    const fields = Object.entries({ maxSearches: t('每任务最多搜索次数', 'Search attempts per task'), maxResults: t('每次最多结果数', 'Results per search'), resultBytes: t('每任务搜索资料预算（UTF-8 字节）', 'Search-result budget per task (UTF-8 bytes)') }).map(([name, label]) => {
        const input = field(label, 'number', limits); [input.min, input.max] = WEB_RANGES[name]; input.step = 1;
        node('small', `${input.min}–${input.max}`, input.parentElement || input.parent); return { name, input };
    });
    const controls = node('div', '', editor); controls.className = 'gd-muyu-actions';
    const save = button(t('更新搜索密钥', 'Update search key'), controls), forget = button(t('清除搜索密钥', 'Forget search key'), controls);
    const saveLimits = button(t('重试保存搜索预算', 'Retry saving search limits'), limits);
    const limitFeedback = createFormFeedback({ doc, parent: limits, fields: fields.map(f => f.input), buttons: [saveLimits], retryButton: saveLimits, lang });
    saveLimits.onclick = () => act(() => limitFeedback.run(() => controller.saveWebSearchLimits(Object.fromEntries(fields.map(({ name, input }) => [name, Number(input.value)]))), () => limitFeedback.validateNumbers()));
    bindAutoSave(fields.map(f => f.input), saveLimits, lang, () => limitFeedback.dirty);
    const stateText = node('small', '', editor);
    const feedback = createFormFeedback({ doc, parent: controls, fields: [key, remember], buttons: [save, forget], lang,
        disabledWhen: control => control === forget && !controller.snapshot().webSearch?.hasKey,
        savedText: t('搜索设置已更新。', 'Search settings updated.'),
        errorText: error => error?.message === 'WEB_KEY_REQUIRED' ? t('请填写独立的搜索密钥。', 'Enter a separate search key.') : t('搜索配置未能保存，输入已保留。', 'Search settings could not be saved. Input retained.') });
    node('small', t('需要安装或更新暮羽服务端插件（muyu/server-plugin 下的全部 .cjs 文件），启用 ST 的 enableServerPlugins 并重启。搜索只返回链接与摘要，不读取网页全文。', 'Install or update the Muyu server plugin (all .cjs files under muyu/server-plugin), enable ST enableServerPlugins and restart. Search returns links and snippets, not full pages.'), editor);
    let signature = '', credentialSignature = '';
    toggle.onclick = () => act(async () => {
        const s = controller.snapshot();
        if (!s.webSearch?.enabled && (!s.enabled || !s.webSearch?.hasKey)) { editor.open = true; openSettings(s.enabled ? key : undefined); return; }
        try { await controller.setWebSearchEnabled(!s.webSearch.enabled); }
        catch (error) { editor.open = true; editor.setAttribute('tabindex', '-1'); openSettings(editor); throw error; }
    });
    save.onclick = () => act(() => feedback.run(async () => {
        const config = {}; for (const { name, input } of fields) { if (!input.value.trim()) throw Error('WEB_CONFIG_INVALID'); config[name] = Number(input.value); }
        await controller.saveWebSearchConfig({ config, apiKey: key.value.trim(), rememberKey: remember.checked }); key.value = ''; signature = '';
    }, () => {
        if (!limitFeedback.validateNumbers()) return false;
        if (!key.value.trim() && !controller.snapshot().webSearch?.hasKey) { feedback.invalid(key, t('请填写 Brave Search API 密钥。', 'Enter a Brave Search API key.')); return false; }
        return true;
    }));
    forget.onclick = () => act(() => feedback.run(async () => { await controller.forgetWebSearchKey(); key.value = ''; signature = ''; }));
    return {
        render(s) {
            const web = s.webSearch || { ...WEB_DEFAULTS, hasKey: false, remembered: false, backend: 'unknown' };
            toggle.hidden = s.mode !== 'assistant';
            toggle.disabled = !!s.resetting || !!web.saving || !!s.readOnly || !web.enabled && !!s.busy;
            toggle.setAttribute('aria-pressed', String(web.enabled === true));
            toggle.setAttribute('aria-label', web.enabled ? t('关闭联网搜索', 'Disable web search') : t('开启联网搜索', 'Enable web search'));
            toggle.title = web.enabled ? t('关闭联网搜索', 'Disable web search') : t('开启联网搜索 · 搜索词发送至 Brave，可能计费', 'Enable web search · Queries go to Brave and may incur charges');
            toggleLabel.hidden = web.enabled !== true;
            hint.hidden = web.enabled !== true || s.mode !== 'assistant';
            const next = JSON.stringify([web.maxSearches, web.maxResults, web.resultBytes]);
            if (signature !== next && !feedback.busy && !limitFeedback.dirty && !limitFeedback.busy) { for (const { name, input } of fields) input.value = String(web[name]); signature = next; limitFeedback.rebase(); }
            const nextCredential = JSON.stringify([web.hasKey, web.remembered]);
            if (credentialSignature !== nextCredential && !feedback.dirty && !feedback.busy) { remember.checked = web.remembered === true; credentialSignature = nextCredential; feedback.rebase(); }
            limitFeedback.update(web.saving || s.resetting || s.busy);
            feedback.update(web.saving || s.resetting || s.busy);
            stateText.textContent = (web.hasKey ? t('已提供搜索密钥', 'Search key provided') : t('尚未配置搜索密钥', 'Search key not configured')) + ' · ' + ({ available: t('服务端插件已连接', 'Server plugin connected'), missing: t('服务端插件未安装或尚未重启', 'Server plugin missing or restart required'), unavailable: t('服务端插件连接失败', 'Server plugin unavailable'), unknown: t('开启时检测服务端插件', 'Server plugin checked when enabling') }[web.backend] || '');
        },
        clearKey() { key.value = ''; },
    };
}
