const DEFAULT_COMPLETION_VARIABLE = 'gd_story_chapter_done';

export const DEFAULT_STORY_BLUEPRINT_SCHEMA = `Reply with ONLY a JSON object, no prose, no code fences:
{
  "version": 1,
  "title": "story blueprint title",
  "meta": {
    "premise": "short premise",
    "style": "genre, tone, pacing"
  },
  "nodes": [
    {
      "id": "node_001",
      "type": "chapter",
      "title": "Chapter title",
      "content": {
        "purpose": "why this block exists",
        "director_prompt": "how the Director should guide this block",
        "completion_rule": "when this block counts as complete"
      },
      "children": []
    }
  ]
}`;

export const DEFAULT_STORY_BLUEPRINT_TEMPLATE = `[Story Blueprint]
Story: {{blueprint.title}}
Progress: {{progress.current}} / {{progress.total}}

Current Path:
{{current.path}}

Current Step JSON:
{{current.nodeJson}}

When and only when the current step is complete, set:
variable_update.global.{{completionVariable}} = true

Otherwise keep it false.`;

export const DEFAULT_STORY_BLUEPRINT_PROMPT_ZH = `请基于当前群聊上下文，生成一份结构化故事蓝图。

[最近消息]
{{newRecentMessages}}

[可用角色]
{{characters}}

[角色档案]
{{character_profiles}}

[世界信息]
{{worldInfo}}

[世界书条目]
{{worldBooks}}

[导演账本]
{{directorLedger}}

[上下文总结]
{{chatSummary}}

目标：
- 蓝图只描述“接下来故事可以如何推进”，不要记录运行进度。
- 使用动态 nodes 树，可以是一层，也可以有章、节、小结等多层。
- 每个可推进节点都要有稳定 id、type、title、content、children。
- content 是自由对象，但建议包含 purpose、director_prompt、completion_rule。
- director_prompt 负责指导 Director 如何推进当前节点。
- completion_rule 负责告诉 Director 什么时候可以把完成变量设为 true。
- 角色安排要符合可用角色的设定、关系和当前状态。
- 世界设定、地点、势力、道具、规则等应优先来自世界书/世界信息。
- 尊重玩家行动，不要在蓝图中强制替玩家做决定。

请生成约 {{storyBlueprintMaxNodes}} 个适合逐步推进的叶子节点。`;

export const DEFAULT_STORY_BLUEPRINT_PROMPT_EN = `Generate a structured Story Blueprint from the current group-chat context.

[Recent messages]
{{newRecentMessages}}

[Available characters]
{{characters}}

[Character profiles]
{{character_profiles}}

[World info]
{{worldInfo}}

[World book entries]
{{worldBooks}}

[Director ledger]
{{directorLedger}}

[Chat summary]
{{chatSummary}}

Goals:
- The blueprint describes how the story can proceed next. Do not store runtime progress in it.
- Use a dynamic nodes tree. It may be flat, or it may contain chapters, sections, beats, or deeper layers.
- Each node should have a stable id, type, title, content, and children.
- content is free-form, but purpose, director_prompt, and completion_rule are recommended.
- director_prompt guides the Director on how to advance the current node.
- completion_rule tells the Director when it may set the completion variable to true.
- Character usage should fit the available characters' profiles, relationships, and current state.
- World details, locations, factions, items, and rules should come primarily from world book / world info.
- Respect player agency. Do not force or overwrite user actions in the blueprint.

Generate about {{storyBlueprintMaxNodes}} leaf-level progression nodes.`;

export const DEFAULT_STORY_BLUEPRINT_CONTINUE_PROMPT_ZH = `请基于现有故事蓝图、当前进度和最近群聊上下文，续写下一段故事蓝图。

[当前进度]
{{storyBlueprintProgress}}

[现有蓝图]
{{storyBlueprintFullJson}}

[最近消息]
{{newRecentMessages}}

[可用角色]
{{characters}}

[角色档案]
{{character_profiles}}

[世界信息]
{{worldInfo}}

[世界书条目]
{{worldBooks}}

[导演账本]
{{directorLedger}}

[上下文总结]
{{chatSummary}}

要求：
- 不要重写旧蓝图，只输出要追加的新蓝图片段。
- 新节点应自然承接现有蓝图的最后阶段。
- 继续使用动态 nodes 树结构。
- 每个可推进节点都要有稳定 id、type、title、content、children。
- content 建议包含 purpose、director_prompt、completion_rule。
- 续写内容要尊重角色设定、世界书信息和已发生剧情。
- 不要记录运行进度，不要包含 done/status/currentIndex。

请续写约 {{storyBlueprintMaxNodes}} 个适合逐步推进的叶子节点。`;

export const DEFAULT_STORY_BLUEPRINT_CONTINUE_PROMPT_EN = `Continue the existing Story Blueprint from the current progress and recent group-chat context.

[Current progress]
{{storyBlueprintProgress}}

[Existing blueprint]
{{storyBlueprintFullJson}}

[Recent messages]
{{newRecentMessages}}

[Available characters]
{{characters}}

[Character profiles]
{{character_profiles}}

[World info]
{{worldInfo}}

[World book entries]
{{worldBooks}}

[Director ledger]
{{directorLedger}}

[Chat summary]
{{chatSummary}}

Requirements:
- Do not rewrite the old blueprint. Output only the new blueprint segment to append.
- New nodes should naturally follow the current blueprint's latest stage.
- Keep using the dynamic nodes tree structure.
- Each progression node should have a stable id, type, title, content, and children.
- content should usually include purpose, director_prompt, and completion_rule.
- Continue from established character details, world book context, and already-played plot.
- Do not store runtime progress. Do not include done, status, or currentIndex.

Generate about {{storyBlueprintMaxNodes}} leaf-level progression nodes.`;

function clone(value) {
    if (value === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(value)); } catch (_) { return null; }
}

function getChatLength(getChat) {
    return getChat?.()?.length ?? 0;
}

function slug(input) {
    return String(input || 'node')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_\-\u4e00-\u9fff]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48) || 'node';
}

function ensureArray(value) {
    return Array.isArray(value) ? value : [];
}

function normalizeNode(node, path = []) {
    const obj = node && typeof node === 'object' && !Array.isArray(node) ? (clone(node) || {}) : {};
    const indexPath = path.join('_') || '0';
    if (!obj.id) obj.id = `${slug(obj.type || obj.title || 'node')}_${indexPath}`;
    if (!obj.type) obj.type = 'node';
    if (!obj.title) obj.title = obj.id;
    if (!obj.content || typeof obj.content !== 'object' || Array.isArray(obj.content)) {
        const { id, type, title, children, content, ...rest } = obj;
        obj.content = Object.keys(rest).length ? rest : {};
        if (content !== undefined && content !== null && content !== '') {
            obj.content.text = String(content);
        }
    }
    obj.children = ensureArray(obj.children).map((child, idx) => normalizeNode(child, path.concat(idx)));
    return obj;
}

function normalizeBlueprint(input) {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? (clone(input) || {}) : {};
    if (!source.version) source.version = 1;
    if (!source.title) source.title = 'Story Blueprint';
    if (!source.meta || typeof source.meta !== 'object' || Array.isArray(source.meta)) source.meta = {};
    if (!Array.isArray(source.nodes) && Array.isArray(source.chapters)) {
        source.nodes = source.chapters;
        delete source.chapters;
    }
    source.nodes = ensureArray(source.nodes).map((node, idx) => normalizeNode(node, [idx]));
    return source;
}

function flattenNodes(nodes, options = {}, parents = [], depth = 0, out = []) {
    const mode = options.mode || 'leaf';
    const level = Number(options.level || 0);
    for (const node of ensureArray(nodes)) {
        const path = parents.concat(node);
        const isLeaf = !node.children || node.children.length === 0;
        const include = mode === 'all' || (mode === 'level' ? depth === level : isLeaf);
        if (include) {
            out.push({
                id: node.id,
                node,
                depth,
                path,
                pathText: path.map(n => n.title || n.id).join(' > '),
            });
        }
        flattenNodes(node.children, options, path, depth + 1, out);
    }
    return out;
}

function renderObject(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    return JSON.stringify(value, null, 2);
}

    function renderTemplate(template, data) {
    return String(template || '').replace(/\{\{([^}]+)\}\}/g, (match, rawPath) => {
        const path = rawPath.trim().split('.');
        let cur = data;
        for (const key of path) {
            if (cur === undefined || cur === null) return '';
            cur = cur[key];
        }
        return renderObject(cur);
    });
}

function renderInlineSettings(template, settings) {
    return String(template || '')
        .replace(/\{\{storyBlueprintMaxNodes\}\}/g, String(settings.storyBlueprintMaxNodes || 8));
}

function validateImportData(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, error: 'Not a JSON object' };
    const payload = obj.type === 'group-director-story-blueprint' ? obj.storyBlueprint : obj;
    if (!payload || typeof payload !== 'object') return { ok: false, error: 'Missing storyBlueprint payload' };
    const blueprint = payload.blueprint || payload;
    if (!blueprint || typeof blueprint !== 'object') return { ok: false, error: 'Missing blueprint object' };
    if (!Array.isArray(blueprint.nodes) && !Array.isArray(blueprint.chapters)) return { ok: false, error: 'Missing nodes array' };
    return { ok: true, payload };
}

export function createStoryBlueprintSystem({
    settings,
    getChatMetadata,
    getChat,
    EXT_KEY,
    saveChatConditional,
    renderPrompt,
    generateRaw,
    createCaller,
    parseJson,
    variableSystem,
    getCurrentGroup,
    getLang,
    log = console.log,
}) {
    let generating = false;

    function lang() { return getLang?.() || settings.lang || 'zh'; }
    function completionVariable() { return settings.storyBlueprintCompletionVariable || DEFAULT_COMPLETION_VARIABLE; }

    function root() {
        const meta = getChatMetadata();
        if (!meta[EXT_KEY]) meta[EXT_KEY] = {};
        if (!meta[EXT_KEY].storyBlueprint) {
            meta[EXT_KEY].storyBlueprint = {
                blueprint: null,
                doneSignals: [],
                lastGeneratedAt: 0,
                lastError: '',
                completeNoticeKey: '',
            };
        }
        const state = meta[EXT_KEY].storyBlueprint;
        if (!Array.isArray(state.doneSignals)) state.doneSignals = [];
        if (typeof state.completeNoticeKey !== 'string') state.completeNoticeKey = '';
        return state;
    }

    function ensureCompletionVariable() {
        const id = completionVariable();
        const existing = variableSystem?.getDefinition?.(id);
        if (!existing) {
            const zh = lang() === 'zh';
            variableSystem?.upsertDefinition?.({
                id,
                label: zh ? '故事蓝图当前块完成' : 'Story Chapter Done',
                labelZh: '故事蓝图当前块完成',
                scope: 'global',
                type: 'boolean',
                defaultValue: false,
                value: false,
                rule: zh ? '仅当当前故事蓝图推进块完成时设为 true。' : 'Set to true only when the current Story Blueprint step is complete.',
                ruleZh: '仅当当前故事蓝图推进块完成时设为 true。',
                showInDashboard: true,
                injectMode: 'manual',
                locked: false,
            });
        } else if (settings.storyBlueprintEnabled && (!existing.locked && (existing.injectMode !== 'manual' || existing.autoUpdate === false))) {
            variableSystem?.upsertDefinition?.({
                ...existing,
                autoUpdate: true,
                injectMode: 'manual',
            });
        }
    }

    function clearCompletionSignal(reason = 'clear') {
        const id = completionVariable();
        if (settings.storyBlueprintEnabled) ensureCompletionVariable();
        else if (!variableSystem?.getDefinition?.(id)) return;
        variableSystem?.setValue?.(id, false, {
            source: 'story-blueprint',
            reason,
        });
    }

    function getBlueprint() {
        const state = root();
        if (!state.blueprint) return null;
        state.blueprint = normalizeBlueprint(state.blueprint);
        return state.blueprint;
    }

    function setBlueprint(blueprint, options = {}) {
        const state = root();
        state.blueprint = normalizeBlueprint(blueprint);
        if (options.resetProgress !== false) state.doneSignals = [];
        state.completeNoticeKey = '';
        state.lastGeneratedAt = Date.now();
        state.lastError = '';
        saveChatConditional?.();
        return state.blueprint;
    }

    function getSteps() {
        const blueprint = getBlueprint();
        if (!blueprint) return [];
        return flattenNodes(blueprint.nodes, {
            mode: settings.storyBlueprintProgressionMode || 'leaf',
            level: settings.storyBlueprintProgressionLevel || 0,
        });
    }

    function pruneDoneSignals() {
        const state = root();
        const steps = getSteps();
        const ids = new Set(steps.map(s => s.id));
        const chatLen = getChatLength(getChat);
        const next = state.doneSignals.filter(s => ids.has(s.nodeId) && (s.chatLength == null || s.chatLength <= chatLen));
        const changed = next.length !== state.doneSignals.length;
        if (changed) {
            state.doneSignals = next;
            saveChatConditional?.();
        }
        return changed;
    }

    function getProgress() {
        pruneDoneSignals();
        const steps = getSteps();
        const doneCount = root().doneSignals.length;
        const complete = steps.length > 0 && doneCount >= steps.length;
        const idx = complete ? Math.max(steps.length - 1, 0) : doneCount;
        const current = steps[idx] || null;
        return {
            currentIndex: idx,
            doneCount,
            total: steps.length,
            complete,
            current,
            steps,
            completionVariable: completionVariable(),
            completionValue: variableSystem?.getValue?.(completionVariable()) === true,
        };
    }

    function getProviderData() {
        const blueprint = getBlueprint();
        const progress = getProgress();
        const current = progress.current ? {
            id: progress.current.id,
            depth: progress.current.depth,
            path: progress.current.pathText,
            node: progress.current.node,
            nodeJson: JSON.stringify(progress.current.node, null, 2),
            content: progress.current.node?.content || {},
        } : null;
        return {
            blueprint,
            progress: {
                current: progress.complete ? progress.total : Math.min(progress.doneCount + 1, progress.total),
                done: progress.doneCount,
                total: progress.total,
                complete: progress.complete,
                currentIndex: progress.currentIndex,
            },
            current,
            completionVariable: completionVariable(),
            doneSignals: root().doneSignals,
        };
    }

    function completeNoticeKey(data) {
        const last = data.doneSignals[data.doneSignals.length - 1];
        return `${data.progress.total}:${data.progress.done}:${last?.nodeId || 'complete'}`;
    }

    function renderCurrent(options = {}) {
        if (!settings.storyBlueprintEnabled) return '';
        const data = getProviderData();
        if (!data.blueprint || !data.current || data.progress.total === 0) return '';
        if (data.progress.complete) {
            if (options.consumeCompleteNotice) {
                const state = root();
                const key = completeNoticeKey(data);
                if (state.completeNoticeKey === key) return '';
                state.completeNoticeKey = key;
                saveChatConditional?.();
            }
            return lang() === 'zh'
                ? '[Story Blueprint]\n当前故事蓝图已完成。请生成或续写新的蓝图。'
                : '[Story Blueprint]\nThe current story blueprint is complete. Generate or continue a new blueprint.';
        }
        const template = settings.storyBlueprintProviderTemplate || DEFAULT_STORY_BLUEPRINT_TEMPLATE;
        return renderTemplate(template, data);
    }

    function renderProgress() {
        const p = getProgress();
        if (!p.total) {
            return getBlueprint()
                ? (lang() === 'zh' ? '蓝图存在，但当前推进模式无匹配节点' : 'Blueprint loaded, but current progression mode has no matching steps')
                : (lang() === 'zh' ? '无蓝图' : 'No blueprint');
        }
        const label = p.complete ? (lang() === 'zh' ? '已完成' : 'complete') : (p.current?.pathText || '');
        return `${p.doneCount}/${p.total} ${label}`;
    }

    function healthCheck() {
        const blueprint = getBlueprint();
        const issues = [];
        if (!blueprint) issues.push('Missing blueprint');
        else {
            if (!Array.isArray(blueprint.nodes) || !blueprint.nodes.length) issues.push('Missing or empty nodes');
            const steps = getSteps();
            if (!steps.length) issues.push('No progression steps for current mode');
            for (const step of steps) {
                if (!step.node.title) issues.push(`Node ${step.id} has no title`);
                if (!step.node.content || typeof step.node.content !== 'object') issues.push(`Node ${step.id} has no content object`);
            }
        }
        const p = getProgress();
        if (root().doneSignals.length > p.total && p.total >= 0) issues.push('More done signals than available steps');
        return { ok: issues.length === 0, issues };
    }

    function consumeCompletionSignal(source = 'director') {
        if (!settings.storyBlueprintEnabled) {
            if (variableSystem?.getValue?.(completionVariable()) === true) {
                clearCompletionSignal('disabled-reset');
            }
            return { advanced: false, complete: false, reason: 'disabled' };
        }
        ensureCompletionVariable();
        const id = completionVariable();
        if (variableSystem?.getValue?.(id) !== true) return { advanced: false, complete: getProgress().complete, reason: 'not-set' };

        const state = root();
        const progress = getProgress();
        if (!progress.total || !progress.current) {
            variableSystem.setValue(id, false, { source: 'story-blueprint', reason: 'no-progress-step-reset' });
            return { advanced: false, complete: false, reason: 'no-progress-step', progress };
        }
        const chatLen = getChatLength(getChat);
        const last = state.doneSignals[state.doneSignals.length - 1];
        if (last && last.chatLength === chatLen && last.nodeId === progress.current?.id) {
            variableSystem.setValue(id, false, { source: 'story-blueprint', reason: 'dedupe-reset' });
            return { advanced: false, complete: progress.complete, reason: 'duplicate' };
        }

        if (!progress.complete && progress.current) {
            state.doneSignals.push({
                nodeId: progress.current.id,
                stepIndex: progress.doneCount,
                chatLength: chatLen,
                time: Date.now(),
                source,
            });
        }
        variableSystem.setValue(id, false, { source: 'story-blueprint', reason: 'advance-reset' });
        saveChatConditional?.();

        const next = getProgress();
        return { advanced: true, complete: next.complete, progress: next };
    }

    function rollbackOne() {
        const state = root();
        if (!state.doneSignals.length) return false;
        state.doneSignals.pop();
        state.completeNoticeKey = '';
        variableSystem?.setValue?.(completionVariable(), false, { source: 'story-blueprint', reason: 'rollback' });
        saveChatConditional?.();
        return true;
    }

    function setCurrentStep(stepIndex) {
        const steps = getSteps();
        const idx = Math.max(0, Math.min(Number(stepIndex) || 0, steps.length));
        const state = root();
        state.doneSignals = steps.slice(0, idx).map((step, i) => ({
            nodeId: step.id,
            stepIndex: i,
            chatLength: getChatLength(getChat),
            time: Date.now(),
            source: 'manual',
        }));
        state.completeNoticeKey = '';
        variableSystem?.setValue?.(completionVariable(), false, { source: 'story-blueprint', reason: 'set-current-step' });
        saveChatConditional?.();
        return getProgress();
    }

    function resetProgress() {
        const state = root();
        state.doneSignals = [];
        state.completeNoticeKey = '';
        variableSystem?.setValue?.(completionVariable(), false, { source: 'story-blueprint', reason: 'reset-progress' });
        saveChatConditional?.();
    }

    function resetBlueprint() {
        const state = root();
        state.blueprint = null;
        state.doneSignals = [];
        state.completeNoticeKey = '';
        saveChatConditional?.();
    }

    function buildGenerationPrompt(mode = 'new') {
        const schema = settings.storyBlueprintJsonSchema || DEFAULT_STORY_BLUEPRINT_SCHEMA;
        const maxNodes = settings.storyBlueprintMaxNodes || 8;
        const baseTemplate = mode === 'continue'
            ? (settings.storyBlueprintContinuePrompt || getDefaultContinuePrompt())
            : (settings.storyBlueprintPrompt || getDefaultPrompt());
        const base = renderInlineSettings(baseTemplate, { ...settings, storyBlueprintMaxNodes: maxNodes });
        return `${base}

[Output Format]
${schema}`;
    }

    function buildRenderContext() {
        const group = getCurrentGroup?.();
        const enabledMembers = group?.members?.filter(a => !group.disabled_members?.includes(a)) || [];
        return {
            group,
            enabledMembers,
        };
    }

    async function generateBlueprint(mode = 'new') {
        if (generating) throw new Error('Story Blueprint generation already in progress');
        if (mode === 'continue' && !getBlueprint()) {
            throw new Error(lang() === 'zh' ? '没有可续写的故事蓝图，请先生成蓝图。' : 'No Story Blueprint to continue. Generate one first.');
        }
        generating = true;
        try {
            const agentConfig = settings.agentConfigs?.['story-blueprint'] || {};
            const caller = createCaller(agentConfig, (opts) => generateRaw(opts));
            const prompt = await renderPrompt(buildGenerationPrompt(mode), buildRenderContext(), {
                maxPasses: settings.templateMaxPasses,
                recursive: settings.templateRecursive,
                debugPlaceholders: settings.templateDebugPlaceholders,
            });
            const raw = await caller.generate(prompt);
            const parsed = parseJson(raw);
            if (!parsed) throw new Error('LLM returned no valid JSON blueprint');
            if (mode === 'continue' && getBlueprint()) {
                const current = getBlueprint();
                const incoming = normalizeBlueprint(parsed);
                current.nodes = current.nodes.concat(incoming.nodes);
                current.meta = { ...(current.meta || {}), ...(incoming.meta || {}) };
                setBlueprint(current, { resetProgress: false });
            } else {
                setBlueprint(parsed, { resetProgress: true });
            }
            return getBlueprint();
        } catch (e) {
            root().lastError = e.message || String(e);
            saveChatConditional?.();
            throw e;
        } finally {
            generating = false;
        }
    }

    async function renderGenerationPrompt(mode = 'new') {
        return await renderPrompt(buildGenerationPrompt(mode), buildRenderContext(), {
            maxPasses: settings.templateMaxPasses,
            recursive: settings.templateRecursive,
            debugPlaceholders: settings.templateDebugPlaceholders,
        });
    }

    function buildExportFile(includeProgress = true) {
        return {
            version: 1,
            type: 'group-director-story-blueprint',
            exportedAt: new Date().toISOString(),
            storyBlueprint: includeProgress ? clone(root()) : { blueprint: clone(getBlueprint()), doneSignals: [] },
        };
    }

    function applyImportText(text, options = {}) {
        let obj;
        try { obj = JSON.parse(text); } catch (e) { return { ok: false, error: `Invalid JSON: ${e.message}` }; }
        const valid = validateImportData(obj);
        if (!valid.ok) return valid;
        const payload = valid.payload;
        const hasProgress = options.includeProgress && Array.isArray(payload.doneSignals);
        setBlueprint(payload.blueprint || payload, { resetProgress: !hasProgress });
        if (options.includeProgress && Array.isArray(payload.doneSignals)) {
            root().doneSignals = payload.doneSignals;
            root().completeNoticeKey = '';
            pruneDoneSignals();
            saveChatConditional?.();
        }
        return { ok: true };
    }

    function getState() { return root(); }

    function getDefaultPrompt() {
        return lang() === 'zh' ? DEFAULT_STORY_BLUEPRINT_PROMPT_ZH : DEFAULT_STORY_BLUEPRINT_PROMPT_EN;
    }

    function getDefaultContinuePrompt() {
        return lang() === 'zh' ? DEFAULT_STORY_BLUEPRINT_CONTINUE_PROMPT_ZH : DEFAULT_STORY_BLUEPRINT_CONTINUE_PROMPT_EN;
    }

    return {
        ensureCompletionVariable,
        clearCompletionSignal,
        getState,
        getBlueprint,
        setBlueprint,
        getSteps,
        getProgress,
        getProviderData,
        renderCurrent,
        renderProgress,
        healthCheck,
        consumeCompletionSignal,
        rollbackOne,
        setCurrentStep,
        resetProgress,
        resetBlueprint,
        renderGenerationPrompt,
        generateBlueprint,
        buildExportFile,
        applyImportText,
        getDefaultTemplate: () => DEFAULT_STORY_BLUEPRINT_TEMPLATE,
        getDefaultSchema: () => DEFAULT_STORY_BLUEPRINT_SCHEMA,
        getDefaultPrompt,
        getDefaultContinuePrompt,
        isGenerating: () => generating,
    };
}
