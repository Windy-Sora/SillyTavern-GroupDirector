import { WEB_DEFAULTS, WEB_RANGES } from '../web/contract.js';

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
    const fields = Object.entries({ maxSearches: t('每任务最多搜索次数', 'Search attempts per task'), maxResults: t('每次最多结果数', 'Results per search'), resultBytes: t('每任务搜索资料预算（UTF-8 字节）', 'Search-result budget per task (UTF-8 bytes)') }).map(([name, label]) => {
        const input = field(label, 'number', editor); [input.min, input.max] = WEB_RANGES[name]; input.step = 1; return { name, input };
    });
    const controls = node('div', '', editor); controls.className = 'gd-muyu-actions';
    const save = button(t('保存搜索配置', 'Save search settings'), controls), forget = button(t('清除搜索密钥', 'Forget search key'), controls);
    const stateText = node('small', '', editor);
    node('small', t('需要安装或更新暮羽服务端插件（muyu/server-plugin 下的全部 .cjs 文件），启用 ST 的 enableServerPlugins 并重启。搜索只返回链接与摘要，不读取网页全文。', 'Install or update the Muyu server plugin (all .cjs files under muyu/server-plugin), enable ST enableServerPlugins and restart. Search returns links and snippets, not full pages.'), editor);
    let signature = '';
    toggle.onclick = () => act(async () => {
        const s = controller.snapshot();
        if (!s.webSearch?.enabled && (!s.enabled || !s.webSearch?.hasKey)) { openSettings(); editor.open = true; (s.enabled ? key : editor).focus?.(); return; }
        try { await controller.setWebSearchEnabled(!s.webSearch.enabled); }
        catch (error) { openSettings(); editor.open = true; throw error; }
    });
    save.onclick = () => act(async () => {
        const config = {}; for (const { name, input } of fields) { if (!input.value.trim()) throw Error('WEB_CONFIG_INVALID'); config[name] = Number(input.value); }
        await controller.saveWebSearchConfig({ config, apiKey: key.value.trim(), rememberKey: remember.checked }); key.value = ''; signature = '';
    });
    forget.onclick = () => act(async () => { await controller.forgetWebSearchKey(); key.value = ''; signature = ''; });
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
            const next = JSON.stringify([web.maxSearches, web.maxResults, web.resultBytes, web.remembered]);
            if (signature !== next) { for (const { name, input } of fields) input.value = String(web[name]); remember.checked = web.remembered === true; signature = next; }
            save.disabled = !!web.saving || !!s.resetting || !!s.busy;
            forget.disabled = !web.hasKey || !!web.saving || !!s.resetting;
            stateText.textContent = (web.hasKey ? t('已提供搜索密钥', 'Search key provided') : t('尚未配置搜索密钥', 'Search key not configured')) + ' · ' + ({ available: t('服务端插件已连接', 'Server plugin connected'), missing: t('服务端插件未安装或尚未重启', 'Server plugin missing or restart required'), unavailable: t('服务端插件连接失败', 'Server plugin unavailable'), unknown: t('开启时检测服务端插件', 'Server plugin checked when enabling') }[web.backend] || '');
        },
        clearKey() { key.value = ''; },
    };
}
