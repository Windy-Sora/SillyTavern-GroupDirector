import { registerSection } from './registry.js';
import { createHostBridge } from '../../muyu/host/bridge.js';
import { createProfileWriter } from '../../muyu/host/profile-write.js';
import { createConfigWriter } from '../../muyu/host/config-write.js';
import { createMemoryLimitPort } from '../../muyu/host/memory-limit.js';
import { createStoryCompletionVariablePort } from '../../muyu/host/story-completion-variable.js';
import { createVariableDraftPort } from '../../muyu/host/variable-draft.js';
import { createVariableWriter } from '../../muyu/host/variable-write.js';
import { createTaskBundleDraftPort } from '../../muyu/host/task-bundle-draft.js';
import { createTaskBundleWriter } from '../../muyu/host/task-bundle-write.js';
import { createProviderPort } from '../../muyu/host/providers.js';
import { createCredentialStore } from '../../muyu/host/credentials.js';
import { createRunConfigStore } from '../../muyu/host/run-config.js';
import { createContextConfigStore } from '../../muyu/host/context-config.js';
import { createInstructionConfigStore } from '../../muyu/host/instruction-config.js';
import { createHistoryPort } from '../../muyu/host/history.js';
import { createWebSearchPort } from '../../muyu/host/web-search.js';
import { createMuyuController } from '../../muyu/application/controller.js';
import { mountMuyuPanel } from '../../muyu/ui/panel.js';
import { createFloatingRegistry } from '../floating/registry.js';
import { createFloatingShell } from '../floating/shell.js';
import { getQuickActions } from '../quick-actions.js';
import { syncConfigPromptEditors } from '../../muyu/ui/config-prompt-editors.js';
import { toggleContinuityMode } from '../i18n.js';

// deps survives reloadSettingsUI; the section owns only the disposable view.
registerSection('muyu', ctx => {
    const root = document.getElementById('gd-muyu-root'); if (!root || !ctx.muyuOwner) return;
    const owner = ctx.muyuOwner;
    owner.currentContext = ctx;
    if (!owner.controller) {
        const providerPort = createProviderPort({ getContext: ctx.getContext, getSettings: () => ctx.settings, extensionKey: ctx.EXT_KEY, bindings: ctx.muyuProviderBindings, getProviders: ctx.getMuyuProviders,
            worldBooks: { getState: ctx.getMuyuWorldBookState, load: ctx.loadWorldInfo },
            stDirectories: { getSelectedPersona: ctx.getMuyuSelectedPersona, getExtensions: ctx.getMuyuExtensionDirectory } });
        const credentials = createCredentialStore({ getSettings: () => ctx.settings, saveSettings: ctx.saveMuyuCredentials });
        const runConfig = createRunConfigStore({ getSettings: () => ctx.settings, saveSettings: ctx.saveMuyuCredentials });
        const contextConfig = createContextConfigStore({ getSettings: () => ctx.settings, saveSettings: ctx.saveMuyuCredentials });
        const instructionConfig = createInstructionConfigStore({ getSettings: () => ctx.settings, saveSettings: ctx.saveMuyuCredentials });
        const history = createHistoryPort({ getAccount: ctx.getMuyuAccount, getSettings: () => ctx.settings, saveSettings: ctx.saveMuyuCredentials, fetcher: globalThis.fetch?.bind(globalThis), getHeaders: ctx.getRequestHeaders });
        const webSearch = createWebSearchPort({ getSettings: () => ctx.settings, saveSettings: ctx.saveMuyuCredentials, fetcher: globalThis.fetch?.bind(globalThis), getHeaders: ctx.getRequestHeaders });
        let host;
        const memoryLimitPort = createMemoryLimitPort({ getTarget: () => host?.currentTarget(), getMetadata: ctx.getChatMetadata, extensionKey: ctx.EXT_KEY, memorySystem: ctx.memorySystem,
            changed: () => { const live = owner.currentContext || ctx; live.refreshMemoryList?.(); window.__gdRefreshDashboard?.(); } });
        const completionVariablePort = createStoryCompletionVariablePort({ getTarget: () => host?.currentTarget(), getMetadata: ctx.getChatMetadata,
            getSettings: () => ctx.settings, extensionKey: ctx.EXT_KEY, saveChatConfirmed: ctx.saveVariablesChatConfirmed });
        const variableDraftPort = createVariableDraftPort({ getTarget: () => host?.currentTarget(), getMetadata: ctx.getChatMetadata, extensionKey: ctx.EXT_KEY });
        const variableWriter = createVariableWriter({ draftPort: variableDraftPort, getTarget: () => host?.currentTarget(),
            getMetadata: ctx.getChatMetadata, extensionKey: ctx.EXT_KEY, saveChatConfirmed: ctx.saveVariablesChatConfirmed,
            changed: () => { window.__gdRefreshVariables?.(); window.__gdRefreshDashboard?.(); } });
        const configWriter = createConfigWriter({ getSettings: () => ctx.settings, saveSettings: ctx.saveMuyuCredentials, memoryLimitPort, completionVariablePort,
            isBusy: () => !ctx.getMuyuGuards || Object.entries(ctx.getMuyuGuards()).some(([key, value]) => ['roundActive', 'takeoverPending', 'manualGenerating'].includes(key) && value) || !!ctx.summarySystem?.isGenerating?.() || !!ctx.critiqueSystem?.isGenerating?.() || !!ctx.profileSystem?.isGenerating?.() || !!ctx.storyBlueprintSystem?.isGenerating?.() || !!ctx.npcSystem?.isGenerating?.() || ['profiles', 'memory', 'summary', 'blueprint'].some(id => getQuickActions(ctx).unavailable(id) === 'busy'),
            changed: fields => {
                const live = owner.currentContext || ctx;
                getQuickActions(live).refresh();
                if (fields.includes('profileEnabled')) {
                    live.$c('profile-enabled').prop('checked', live.settings.profileEnabled);
                    live.$c('qs-profile-enabled').prop('checked', live.settings.profileEnabled);
                    $('#gd-profile-section').toggle(live.settings.profileEnabled);
                    if (live.settings.profileEnabled) {
                        live.refreshProfileManagementUI?.();
                        live.checkProfileStartupStatus?.();
                    }
                    window.__gdRefreshDashboard?.();
                }
                if (fields.includes('profileTokenBudget')) live.$c('profile-token-budget').val(live.settings.profileTokenBudget);
                if (fields.includes('profileConcurrency')) live.$c('profile-concurrency').val(live.settings.profileConcurrency);
                if (fields.includes('storyBlueprintAutoContinue')) live.$c('story-blueprint-auto-continue').prop('checked', live.settings.storyBlueprintAutoContinue);
                if (fields.includes('storyBlueprintMaxNodes')) live.$c('story-blueprint-max-nodes').val(live.settings.storyBlueprintMaxNodes);
                if (fields.includes('llmHistoryEnabled')) live.$c('llm-history-enabled').prop('checked', live.settings.llmHistoryEnabled);
                if (fields.includes('llmWorldInfoEnabled')) live.$c('llm-world-info-enabled').prop('checked', live.settings.llmWorldInfoEnabled);
                if (fields.includes('llmScriptEnabled')) { live.$c('llm-script-enabled').prop('checked', live.settings.llmScriptEnabled); window.__gdRefreshDashboard?.(); }
                if (fields.includes('llmScriptPosition')) live.$c('llm-script-position').val(String(live.settings.llmScriptPosition));
                if (fields.includes('llmScriptContinuity')) live.$c('llm-script-continuity').prop('checked', live.settings.llmScriptContinuity);
                if (fields.includes('llmScriptContinuityMode')) {
                    $(`input[name="gd-llm-script-continuity-mode"][value="${live.settings.llmScriptContinuityMode}"]`).prop('checked', true);
                    toggleContinuityMode(live.settings.llmScriptContinuityMode);
                }
                if (fields.includes('llmScriptContinuityCount') && live.$c('llm-script-continuity-count')[0] !== globalThis.document?.activeElement) live.$c('llm-script-continuity-count').val(live.settings.llmScriptContinuityCount);
                if (fields.includes('forceSpeakMode')) {
                    $(`input[name="gd-force-speak-mode"][value="${live.settings.forceSpeakMode}"]`).prop('checked', true);
                    $('#gd-force-speak-llm-section').toggle(live.settings.forceSpeakMode === 'llm');
                }
                if (fields.includes('templateMaxPasses') && live.$c('template-max-passes')[0] !== globalThis.document?.activeElement) live.$c('template-max-passes').val(live.settings.templateMaxPasses);
                if (fields.includes('templateRecursive')) live.$c('template-recursive').prop('checked', live.settings.templateRecursive);
                if (fields.includes('templateDebugPlaceholders')) live.$c('template-debug-placeholders').prop('checked', live.settings.templateDebugPlaceholders);
                if (fields.includes('storyBlueprintCompletionVariable')) live.$c('story-blueprint-var').val(live.settings.storyBlueprintCompletionVariable);
                if (fields.includes('npcEnabled')) {
                    live.$c('npc-enabled').prop('checked', live.settings.npcEnabled);
                    $('#gd-npc-section').toggle(live.settings.npcEnabled);
                    // Populate an untouched list, but never rebuild an open NPC editor draft.
                    if (live.settings.npcEnabled && !live.$c('npc-list').contents().length) live.refreshNpcList?.();
                    window.__gdRefreshDashboard?.();
                }
                if (fields.includes('npcMaxCount')) live.$c('npc-max-count').val(live.settings.npcMaxCount);
                if (fields.includes('npcBatchSize')) live.$c('npc-batch-size').val(live.settings.npcBatchSize);
                if (fields.includes('npcGenerateFirstMes')) live.$c('npc-generate-firstmes').prop('checked', live.settings.npcGenerateFirstMes);
                if (fields.includes('memoryKeepRecent')) live.$c('memory-keep-recent').val(live.settings.memoryKeepRecent);
                if (fields.includes('memoryMaxEntries')) live.$c('memory-max-entries').val(live.settings.memoryMaxEntries);
                if (fields.includes('traceMaxEntries')) {
                    live.AgentTrace?.setMax(live.settings.traceMaxEntries);
                    live.$c('trace-max').val(live.settings.traceMaxEntries);
                }
                if (fields.includes('postSpeechMessageEnabled')) {
                    live.$c('ps-msg-enabled').prop('checked', live.settings.postSpeechMessageEnabled);
                    $('#gd-ps-msg-section').toggle(live.settings.postSpeechMessageEnabled);
                    window.__gdRefreshDashboard?.();
                }
                if (fields.includes('postSpeechRoundEnabled')) {
                    live.$c('ps-round-enabled').prop('checked', live.settings.postSpeechRoundEnabled);
                    $('#gd-ps-round-section').toggle(live.settings.postSpeechRoundEnabled);
                    window.__gdRefreshDashboard?.();
                }
                if (fields.includes('postSpeechBlocking')) live.$c('ps-blocking').prop('checked', live.settings.postSpeechBlocking);
                if (fields.includes('postSpeechDecisionLimit')) {
                    live.$c('ps-decision-limit').val(live.settings.postSpeechDecisionLimit);
                    live.refreshPostSpeechDecisions?.();
                }
                syncConfigPromptEditors({ fields, settings: live.settings, getControl: id => live.$c(id), activeElement: globalThis.document?.activeElement });
                if (fields.includes('worldBookSourceMode') || fields.includes('worldBookMaxEntries')) {
                    live.worldBookScanner?.clearCache?.();
                    if (fields.includes('worldBookSourceMode')) {
                        live.$c('world-book-source-mode').val(live.settings.worldBookSourceMode);
                        try { Promise.resolve(live.renderWorldBookList?.()).catch(() => {}); } catch { /* UI refresh only. */ }
                    }
                    if (fields.includes('worldBookMaxEntries')) live.$c('world-book-max-entries').val(live.settings.worldBookMaxEntries);
                }
            } });
        const bundleDraftPort = createTaskBundleDraftPort({ getTarget: () => host?.currentTarget(), getSettings: () => ctx.settings, variableDraftPort });
        const bundleWriter = createTaskBundleWriter({ draftPort: bundleDraftPort, getTarget: () => host?.currentTarget(), variableWriter, configWriter });
        const profileWriter = createProfileWriter({ getSettings: () => ctx.settings, saveSettings: ctx.saveMuyuCredentials,
            getDrawerKeys: () => ctx.configProfileSystem.getDrawerKeys(), onSaved: () => window.__gdRefreshConfigList?.() });
        host = createHostBridge({ getContext: ctx.getContext, getSettings: () => ctx.settings, extensionKey: ctx.EXT_KEY, getGuards: ctx.getMuyuGuards, providerPort, credentials, runConfig, contextConfig, instructionConfig, history, webSearch, configWriter, variableDraftPort, variableWriter, bundleDraftPort, bundleWriter, profileWriter, memoryLimitPort, completionVariablePort });
        owner.controller = createMuyuController({ host });
        owner.floatingRegistry = createFloatingRegistry();
        owner.floatingRegistry.register({
            id: 'muyu', label: { zh: '暮羽助手', en: 'Muyu assistant' }, icon: '✦', order: 10,
            isAvailable: () => true,
            getStatus: () => {
                const s = owner.controller.snapshot();
                if (s.busy || s.resetting || s.draining) return 'running';
                if (s.interaction?.status === 'pending') return 'attention';
                if (s.runs.at(-1)?.status === 'failed') return 'error';
                return s.notice ? 'attention' : 'idle';
            },
            subscribe: notify => owner.controller.subscribe(notify).unsubscribe,
            mount: (container, options) => mountMuyuPanel(container, owner.controller, {
                ...options, standalone: true,
                navigateDirector: () => {
                    options.close();
                    const panel = document.getElementById('gd-settings-panel');
                    if (panel && !panel.getClientRects().length) document.querySelector('#gd-settings-button .drawer-toggle')?.click();
                    document.querySelector('.group-director-settings')?.__gdNavigation?.navigate('rules', { focus: true });
                    const control = document.getElementById('gd-mode-formula');
                    for (let p = control?.parentElement; p; p = p.parentElement) {
                        if (p.classList.contains('inline-drawer-content')) p.style.display = 'block';
                    }
                    control?.scrollIntoView({ block: 'center', behavior: 'smooth' }); control?.focus();
                },
                navigateMemory: () => {
                    const control = document.getElementById('gd-memory-enabled'); if (!control) return;
                    options.close();
                    document.querySelector('.group-director-settings')?.__gdNavigation?.navigate('memory', { focus: false });
                    for (let p = control.parentElement; p; p = p.parentElement) {
                        if (p.classList.contains('inline-drawer-content')) p.style.display = 'block';
                    }
                    const panel = document.getElementById('gd-settings-panel');
                    if (panel && !panel.getClientRects().length) document.querySelector('#gd-settings-button .drawer-toggle')?.click();
                    control.scrollIntoView({ block: 'center', behavior: 'smooth' }); control.focus();
                },
            }),
        });
        owner.floating = createFloatingShell({ registry: owner.floatingRegistry, lang: ctx.settings.lang });
        window.addEventListener('pagehide', event => {
            if (event.persisted) return;
            owner.floating.dispose(); owner.floatingRegistry.dispose(); void owner.controller.dispose().catch(() => {});
        });
    }
    owner.refreshView = () => {
        root.__gdMuyuDispose?.(); owner.floating.setLanguage(ctx.settings.lang);
        const en = ctx.settings.lang === 'en'; root.classList.add('gd-muyu-entry');
        const open = document.createElement('button'); open.type = 'button'; open.className = 'menu_button';
        open.textContent = en ? 'Open Muyu chat window' : '打开暮羽聊天窗口'; open.onclick = () => owner.floating.open('muyu');
        const hint = document.createElement('small'); hint.textContent = en ? 'Connection settings are in the window. Closing it does not stop tasks.' : '连接设置在窗口内；关闭窗口不会停止任务。';
        root.append(open, hint);
        root.__gdMuyuDispose = () => { root.replaceChildren(); delete root.__gdMuyuDispose; };
    };
    owner.refreshView();
});
