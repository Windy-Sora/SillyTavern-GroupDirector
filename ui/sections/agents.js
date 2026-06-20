import { registerSection } from './registry.js';

const AGENT_DISPLAY = {
    director:    { zh: '导演 (Director)',        en: 'Director' },
    'force-speak': { zh: '强制发言 (Force Speak)', en: 'Force Speak' },
    profile:     { zh: '角色档案 (Profile)',       en: 'Profile' },
    summary:     { zh: '上下文总结 (Summary)',     en: 'Summary' },
};

const DEFAULT_AGENT_CONFIG = {
    useCustom: false,
    protocol: 'openai',
    endpoint: '',
    apiKey: '',
    model: '',
    call: { retries: 2, timeout: 30000 },
    strictMode: false,
};

function ensureConfig(settings, agentId) {
    if (!settings.agentConfigs) settings.agentConfigs = {};
    if (!settings.agentConfigs[agentId]) {
        settings.agentConfigs[agentId] = { ...DEFAULT_AGENT_CONFIG };
    }
    return settings.agentConfigs[agentId];
}

registerSection('agents', function (ctx) {
    const { settings, $c, saveSettings, AgentRegistry, createCaller, getContext } = ctx;
    const lang = settings.lang || 'zh';
    const agents = AgentRegistry.list();

    const container = $('#gd-agents-list');
    if (!container.length) return;

    container.empty();

    for (const agent of agents) {
        const cfg = ensureConfig(settings, agent.id);
        const displayName = (AGENT_DISPLAY[agent.id] || {})[lang] || agent.displayName || agent.id;

        const block = $(`
            <div class="gd-agent-block" style="border:1px solid var(--SmartThemeBorderColor);border-radius:6px;padding:8px;margin-bottom:8px;">
                <label class="checkbox_label" style="font-weight:bold;">
                    <input type="checkbox" class="gd-agent-use-custom" data-agent="${agent.id}">
                    <span>${displayName}</span>
                </label>
                <div class="gd-agent-config" data-agent="${agent.id}" style="display:none;margin-top:6px;">
                    <label>${lang === 'zh' ? '协议' : 'Protocol'}</label>
                    <select class="gd-agent-protocol text_pole" data-agent="${agent.id}" style="width:100%;">
                        <option value="openai">OpenAI Compatible</option>
                        <option value="anthropic">Anthropic Compatible</option>
                    </select>
                    <label style="margin-top:4px;">Endpoint</label>
                    <input type="text" class="gd-agent-endpoint text_pole" data-agent="${agent.id}" style="width:100%;" placeholder="https://api.openai.com">
                    <label style="margin-top:4px;">API Key</label>
                    <input type="password" class="gd-agent-apikey text_pole" data-agent="${agent.id}" style="width:100%;" placeholder="sk-...">
                    <label style="margin-top:4px;">Model</label>
                    <input type="text" class="gd-agent-model text_pole" data-agent="${agent.id}" style="width:100%;" placeholder="gpt-4o">
                    <div style="margin-top:6px;display:flex;gap:6px;align-items:center;">
                        <span class="menu_button menu_button_icon gd-agent-test" data-agent="${agent.id}" style="font-size:0.85em;">
                            <i class="fa-solid fa-plug"></i> ${lang === 'zh' ? '测试连通性' : 'Test Connection'}
                        </span>
                        <span class="gd-agent-test-result" data-agent="${agent.id}" style="font-size:0.85em;"></span>
                    </div>
                </div>
            </div>
        `);

        // Bind values
        block.find('.gd-agent-use-custom').prop('checked', cfg.useCustom);
        block.find('.gd-agent-config').toggle(cfg.useCustom);
        block.find('.gd-agent-protocol').val(cfg.protocol || 'openai');
        block.find('.gd-agent-endpoint').val(cfg.endpoint || '');
        block.find('.gd-agent-apikey').val(cfg.apiKey || '');
        block.find('.gd-agent-model').val(cfg.model || '');

        // Use custom toggle
        block.find('.gd-agent-use-custom').on('change', function () {
            const aid = $(this).data('agent');
            const c = ensureConfig(settings, aid);
            c.useCustom = !!$(this).prop('checked');
            block.find(`.gd-agent-config[data-agent="${aid}"]`).toggle(c.useCustom);
            saveSettings();
        });

        // Protocol
        block.find('.gd-agent-protocol').on('change', function () {
            const aid = $(this).data('agent');
            ensureConfig(settings, aid).protocol = $(this).val();
            saveSettings();
        });

        // Endpoint
        block.find('.gd-agent-endpoint').on('input', function () {
            const aid = $(this).data('agent');
            ensureConfig(settings, aid).endpoint = $(this).val();
            saveSettings();
        });

        // API Key
        block.find('.gd-agent-apikey').on('input', function () {
            const aid = $(this).data('agent');
            ensureConfig(settings, aid).apiKey = $(this).val();
            saveSettings();
        });

        // Model
        block.find('.gd-agent-model').on('input', function () {
            const aid = $(this).data('agent');
            ensureConfig(settings, aid).model = $(this).val();
            saveSettings();
        });

        // Test connection
        block.find('.gd-agent-test').on('click', async function () {
            const aid = $(this).data('agent');
            const c = ensureConfig(settings, aid);
            const resultEl = block.find(`.gd-agent-test-result[data-agent="${aid}"]`);
            const btn = $(this);

            if (!c.useCustom || !c.endpoint || !c.apiKey) {
                resultEl.css('color', 'orange').text(lang === 'zh' ? '请先填写端点、Key 和 Model' : 'Fill endpoint, key and model first');
                return;
            }

            btn.prop('disabled', true);
            resultEl.css('color', '').text(lang === 'zh' ? '测试中...' : 'Testing...');

            try {
                const stGenerateRaw = (opts) => getContext().generateRaw(opts);
                const caller = createCaller(c, stGenerateRaw);
                const result = await caller.test();
                if (result.ok) {
                    resultEl.css('color', 'green').text(lang === 'zh' ? '✓ 连通成功' : '✓ Connected');
                } else {
                    resultEl.css('color', 'red').text((lang === 'zh' ? '✗ 失败: ' : '✗ Failed: ') + (result.error || ''));
                }
            } catch (e) {
                resultEl.css('color', 'red').text((lang === 'zh' ? '✗ 错误: ' : '✗ Error: ') + e.message);
            } finally {
                btn.prop('disabled', false);
            }
        });

        container.append(block);
    }
});
