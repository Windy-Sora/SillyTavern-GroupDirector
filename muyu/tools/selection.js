import { copyJson } from '../core/json-contract.js';

// Grouping changes model-visible definitions, NEVER permission or executable capabilities.
const groups = Object.freeze({
    'muyu.skills.': ['skills', 'Skill管理 / Skill management'],
    'muyu.prompts.': ['prompts', '自定义Prompt / Custom Prompts'],
    'muyu.agents.': ['agents', '自定义Agent / Custom Agents'],
    'muyu.scripts.': ['scripts', '脚本执行器 / Script Executors'],
    'muyu.libraries.': ['libraries', '档案库 / Profile libraries'],
    'muyu.library_chat.': ['library-chat', '聊天与档案库 / Chat and profile library'],
    'muyu.npc_libraries.': ['npc-libraries', 'NPC库 / NPC libraries'],
    'muyu.npc_library_chat.': ['npc-library-chat', '聊天与NPC库 / Chat and NPC library'],
    'muyu.blueprint_libraries.': ['blueprint-libraries', '蓝图库 / Blueprint libraries'],
    'muyu.blueprint_library_chat.': ['blueprint-library-chat', '聊天与蓝图库 / Chat and blueprint library'],
    'muyu.memory_editor.': ['memory-editor', '角色记忆编辑 / Character memory editing'],
    'muyu.profile_editor.': ['profile-editor', '角色档案编辑 / Profile editing'],
    'muyu.npc_editor.': ['npc-editor', 'NPC编辑 / NPC editing'],
    'muyu.blueprint_node_editor.': ['blueprint-editor', '蓝图节点编辑 / Blueprint editing'],
    'muyu.variable_editor.': ['variable-editor', '变量编辑 / Variable editing'],
    'muyu.ledger_editor.': ['ledger-editor', '导演账本编辑 / Director ledger editing'],
    'muyu.selection.': ['selection', '世界书与自动加载选择 / Worldbooks and auto-load selection'],
    'muyu.memory_generation.': ['memory-generation', '记忆生成 / Memory generation'],
    'muyu.profile_generation.': ['profile-generation', '档案生成 / Profile generation'],
    'muyu.npc_generation.': ['npc-generation', 'NPC生成 / NPC generation'],
    'muyu.generation_batch.': ['generation-batch', '整单生成 / Generation batch'],
});
const providerAssets = new Set(['muyu.provider.assets', 'muyu.provider.source', 'muyu.provider.preview', 'muyu.provider.update_preview', 'muyu.provider.remove_preview', 'muyu.provider.test']);
export function createToolSelection(definitions, allowedTools) {
    const allowed = new Set(allowedTools), values = definitions.filter(row => allowed.has(row.id)), base = [], optional = new Map();
    for (const row of values) {
        const group = ['muyu.skills.discover', 'muyu.skills.load'].includes(row.id) ? null : providerAssets.has(row.id) ? ['provider-assets', 'Provider资产 / Provider assets'] : Object.entries(groups).find(([prefix]) => row.id.startsWith(prefix))?.[1];
        if (!group) base.push(row);
        else { if (!optional.has(group[0])) optional.set(group[0], { id: group[0], title: group[1], tools: [] }); optional.get(group[0]).tools.push(row); }
    }
    const enabled = values.length > 64 && allowed.has('muyu.tools.select') && allowed.has('muyu.tools.list');
    if (enabled && base.length > 61) throw Error('TOOL_BASE_CAPACITY'); // Leave recovery slots, never truncate.
    return Object.freeze({
        enabled,
        list: () => ({ grouped: enabled, baseCount: base.length, limit: 64, groups: [...optional.values()].map(row => ({ id: row.id, title: row.title, tools: row.tools.map(tool => tool.id), count: row.tools.length })) }),
        select(ids = []) {
            if (!Array.isArray(ids) || ids.length > 8 || new Set(ids).size !== ids.length || ids.some(id => !optional.has(id))) throw Error('INVALID_TOOL_GROUP');
            const selected = enabled ? [...base, ...ids.flatMap(id => optional.get(id).tools)] : values;
            if (selected.length > 61 && enabled || selected.length > 64) throw Error('TOOL_GROUP_CAPACITY');
            return selected.map(copyJson);
        },
    });
}
