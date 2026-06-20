/**
 * Director Agent — decides who speaks and in what order.
 *
 * Extracted from index.js initRoundWithLLM() + getDefaultLlmPrompt().
 * Pipeline: context → prompt → call → parse → validate
 */
export function createDirectorAgent({
    renderPrompt,
    getDefaultLlmPrompt,
    parseLlmResponse,
    matchCharacterByName,
    buildCharacterProfilesText,
    getDirectorHistory,
    log,
}) {
    return {
        id: 'director',
        displayName: 'Director LLM',
        contextAccess: ['chat', 'recentMessages', 'characters', 'charactersRaw', 'profilesText', 'worldInfoText', 'ledger',
            'group', 'settings', 'llmWorldInfoEnabled', 'llmHistoryEnabled', 'llmScriptContinuity',
            'llmScriptContinuityMode', 'llmScriptContinuityCount', 'llmScriptContinuityWrapper',
            'llmScriptContinuityHistoryWrapper', 'llmWorldInfoWrapper', 'profileEnabled'],
        pipelineOrder: ['context', 'prompt', 'call', 'parse', 'validate'],
        pipeline: {
            async context(_input, _ctx, pool, settings) {
                const group = pool.group();
                const enabledMembers = group?.members?.filter(a => !group.disabled_members?.includes(a)) ?? [];
                const llmDepth = Math.min(settings.llmContextDepth ?? 10, pool.chat()?.length ?? 0);
                const recentMessages = pool.recentMessages(llmDepth);

                // Context for renderPrompt
                const runtimeContext = {
                    recentMessages,
                    enabledMembers,
                    maxSpeakers: settings.llmMaxSpeakers ?? 3,
                };

                return { recentMessages, enabledMembers, runtimeContext, group };
            },

            async prompt(ctx, _state, pool, settings) {
                const promptTemplate = settings.llmPrompt || getDefaultLlmPrompt();
                let filled = await renderPrompt(promptTemplate, ctx.runtimeContext, {
                    maxPasses: settings.templateMaxPasses ?? 5,
                    recursive: settings.templateRecursive ?? true,
                    debugPlaceholders: settings.templateDebugPlaceholders ?? false,
                });

                // Auto-inject WI
                const wiEnabled = pool.llmWorldInfoEnabled?.() ?? settings.llmWorldInfoEnabled;
                const wiText = pool.worldInfoText?.();
                if (wiEnabled && !promptTemplate.includes('{{worldInfo}}') && wiText) {
                    const wrapper = settings.llmWorldInfoWrapper || '{{worldInfo}}';
                    filled = wrapper.replace('{{worldInfo}}', wiText) + '\n\n' + filled;
                }

                // Auto-inject history continuity
                const histEnabled = pool.llmHistoryEnabled?.() ?? settings.llmHistoryEnabled;
                const continuity = pool.llmScriptContinuity?.() ?? settings.llmScriptContinuity;
                if (histEnabled && continuity) {
                    const hasPrevPlan = promptTemplate.includes('{{previousPlan}}');
                    const hasPrevPlans = promptTemplate.includes('{{previousPlans}}');
                    if (!hasPrevPlan && !hasPrevPlans) {
                        const history = getDirectorHistory();
                        if (history.length > 0) {
                            const mode = settings.llmScriptContinuityMode || 'last';
                            if (mode === 'history') {
                                const count = settings.llmScriptContinuityCount > 0
                                    ? Math.min(settings.llmScriptContinuityCount, history.length)
                                    : history.length;
                                const plansJson = JSON.stringify(history.slice(-count), null, 2);
                                const wrapper = settings.llmScriptContinuityHistoryWrapper || '{{previousPlans}}';
                                filled = wrapper.replace('{{previousPlans}}', plansJson) + '\n\n' + filled;
                            } else {
                                const lastJson = JSON.stringify(history[history.length - 1], null, 2);
                                const wrapper = settings.llmScriptContinuityWrapper || '{{previousPlan}}';
                                filled = wrapper.replace('{{previousPlan}}', lastJson) + '\n\n' + filled;
                            }
                        }
                    }
                }

                // Auto-inject profiles
                const profEnabled = pool.profileEnabled?.() ?? settings.profileEnabled;
                if (profEnabled && !promptTemplate.includes('{{character_profiles}}')) {
                    const profilesText = pool.profilesText?.() ?? buildCharacterProfilesText();
                    if (profilesText) filled = profilesText + '\n\n' + filled;
                }

                return filled;
            },

            parse(raw, ctx) {
                const parsed = parseLlmResponse(raw, log);
                if (!parsed || !Array.isArray(parsed.speakers) || parsed.speakers.length === 0) {
                    return null;
                }

                // Map names → avatars
                const orderedAvatars = [];
                const seen = new Set();
                for (const name of parsed.speakers) {
                    const c = matchCharacterByName(name, ctx.enabledMembers);
                    if (c && !seen.has(c.avatar)) {
                        seen.add(c.avatar);
                        orderedAvatars.push(c.avatar);
                    } else if (!c) {
                        log(`LLM returned unrecognized name: "${name}" — skipped`);
                    }
                }

                const maxSpeakers = ctx.runtimeContext?.maxSpeakers ?? 3;
                const capped = orderedAvatars.slice(0, maxSpeakers);

                return {
                    speakers: capped,
                    names: parsed.speakers,
                    reason: parsed.reason ?? '',
                    scripts: parsed.scripts ?? null,
                    loreAssignments: parsed.loreAssignments ?? null,
                };
            },

            validate(parsed, ctx) {
                if (!parsed || !parsed.speakers?.length) {
                    return null;
                }
                // Filter out invalid avatars
                parsed.speakers = parsed.speakers.filter(av => ctx.enabledMembers.includes(av));
                if (!parsed.speakers.length) return null;
                return parsed;
            },
        },
    };
}
