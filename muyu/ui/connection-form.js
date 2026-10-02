import { validateConnection } from '../model/connection.js';

/** Use the same connection contract as execution; never expose a credential in errors. */
export function validateConnectionFields(fields, saved, report, kind = 'test') {
    const { endpoint, model, key, profile, thinking, effort } = fields;
    try {
        validateConnection({ endpoint: endpoint.value.trim(), apiKey: key.value || (saved?.endpoint === endpoint.value.trim() ? 'saved-credential' : ''), model: kind === 'models' ? 'catalog-probe' : model.value.trim(), profile: profile.value, thinking: profile.value === 'deepseek' && thinking.checked, reasoningEffort: effort.value });
        return true;
    } catch (error) {
        const field = ({ 'Invalid model endpoint': endpoint, 'Invalid model credential': key, 'Invalid model name': model })[error?.message] || profile;
        report(field, error?.message); return false;
    }
}
/** One connection draft; changing fields never connects or sends a request. */
export function createConnectionForm({ doc, parent, lang }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const node = (tag, text, owner = parent) => { const el = doc.createElement(tag); el.textContent = text; owner.append(el); return el; };
    const field = (text, type, owner) => {
        const label = node('label', text, owner); label.className = type === 'checkbox' ? 'gd-muyu-connection-check' : 'gd-muyu-connection-field';
        const el = node(type === 'select' ? 'select' : 'input', '', label);
        if (type !== 'select') el.type = type;
        if (type !== 'checkbox') el.className = 'text_pole';
        return el;
    };
    const option = (select, value, text) => { const el = node('option', text, select); el.value = value; };
    const card = node('div', ''); card.className = 'gd-muyu-connection-card';
    node('h3', t('AI 接口配置', 'AI connection setup'), card);
    const activeStatus = node('p', '', card); activeStatus.className = 'gd-muyu-active-connection'; activeStatus.setAttribute('role', 'status');
    node('p', t('先填写接口与密钥，再选择模型并启用；编辑表单不会改变当前连接。', 'Enter the endpoint and key, choose a model, then enable. Editing does not change the active connection.'), card);
    const profile = field(t('接口协议', 'API protocol'), 'select', card);
    option(profile, 'deepseek', t('DeepSeek（支持思考）', 'DeepSeek (thinking supported)'));
    option(profile, 'chat-completions', t('通用 Chat Completions', 'Generic Chat Completions'));
    profile.value = 'deepseek';
    const endpoint = field(t('完整接口地址', 'Full endpoint'), 'url', card);
    endpoint.value = 'https://api.deepseek.com/chat/completions'; endpoint.placeholder = 'https://…/chat/completions'; endpoint.spellcheck = false;
    node('small', t('填写完整 /chat/completions 地址；通用协议不发送 DeepSeek 专用思考参数，不支持 Responses 或 Anthropic 原生协议。', 'Use the full /chat/completions URL. Generic mode omits DeepSeek thinking fields; Responses and native Anthropic protocols are not supported.'), card);
    const key = field(t('API 密钥', 'API key'), 'password', card); key.autocomplete = 'off'; key.spellcheck = false;
    key.placeholder = t('输入密钥；同地址已保存时可留空', 'Enter a key, or leave blank for a saved key at this endpoint');
    const savedKeyStatus = node('small', '', card);
    const modelArea = node('div', '', card); modelArea.className = 'gd-muyu-connection-model';
    const model = field(t('模型', 'Model'), 'text', modelArea); model.value = 'deepseek-flash'; model.spellcheck = false;
    model.placeholder = t('模型 ID，可手动填写', 'Model ID, manual entry supported');
    const advanced = node('details', '', card); advanced.className = 'gd-muyu-connection-advanced';
    node('summary', t('高级与保存选项', 'Advanced & storage options'), advanced);
    const thinking = field(t('开启 DeepSeek 思考', 'Enable DeepSeek thinking'), 'checkbox', advanced); thinking.checked = true;
    const effort = field(t('DeepSeek 思考强度', 'DeepSeek reasoning effort'), 'select', advanced);
    for (const [value, zh, en] of [['low', '低', 'Low'], ['high', '高（默认）', 'High (default)'], ['max', '最高', 'Maximum']]) option(effort, value, t(zh, en));
    effort.value = 'high';
    node('small', t('思考选项仅用于 DeepSeek 协议，具体模型是否支持由服务决定。', 'Thinking options apply only to DeepSeek; support depends on the service and model.'), advanced);
    const rememberKey = field(t('记住 API Key', 'Remember API key'), 'checkbox', advanced);
    const autoConnect = field(t('下次打开时自动启用此连接（默认开启）', 'Enable this connection automatically next time (on by default)'), 'checkbox', advanced);
    const forgetKey = node('button', t('清除已保存密钥', 'Forget saved key'), advanced); forgetKey.type = 'button'; forgetKey.className = 'menu_button';
    node('small', t('自动启用需要记住密钥。密钥明文保存在酒馆插件设置，同源脚本及备份可能读取；不恢复授权，也不主动发送消息。', 'Auto-enable requires saving the key. It is stored unencrypted in ST settings and may be read by same-origin scripts/backups. It does not restore grants or send messages.'), advanced);
    const actions = node('div', '', card); actions.className = 'gd-muyu-connection-actions';
    node('small', t('输入及获授权资料发送至该服务；启用新连接会取消任务并清除运行产物和授权，历史仍可查看。', 'Input and authorized data go to this service. Enabling a new connection cancels tasks and clears live artifacts/grants, not saved history.'), card);
    const refreshOptions = () => { thinking.disabled = profile.value !== 'deepseek'; effort.disabled = thinking.disabled || !thinking.checked; };
    profile.addEventListener('change', refreshOptions); thinking.addEventListener('change', refreshOptions);
    refreshOptions();
    return { endpoint, model, key, profile, thinking, effort, rememberKey, autoConnect, savedKeyStatus, forgetKey, activeStatus, actions, modelArea, refreshOptions };
}
