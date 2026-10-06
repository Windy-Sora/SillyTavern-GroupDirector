/** Remaining support owners. This describes existing effects, never approves them. */
export function supportDescriptors(host, { providers, taskPlan, profiles, web, notes }) {
    const tools = (prefix, names, group = null) => names.map(name => ({ id: prefix + name, group }));
    return [
        { id: 'providers', module: providers, bindAssistant: null, budgetLifecycle: true,
            tools: tools('muyu.provider.', ['list', 'read', 'discover', 'execute', 'result', 'search', 'match']), artifacts: [] },
        { id: 'task-plan', module: taskPlan, bindAssistant: identity => taskPlan.bindRun(identity),
            tools: tools('muyu.task.', ['plan', ...(host.bindTaskStep ? ['bind_step'] : []), ...(host.bindTaskRead ? ['bind_read'] : [])]),
            artifacts: [{ moduleId: 'task-plan', kind: 'task-plan', actionOwner: null, review: 'read-scope', tools: ['muyu.task.plan'] }] },
        { id: 'profile-draft', module: profiles, bindAssistant: identity => profiles.bindRun(identity),
            tools: tools('muyu.profile.', ['preview'], { id: 'config-drafts', title: '领域配置、配置档与整单草稿 / Domain configuration, configuration profile and batch drafts' }),
            artifacts: [{ moduleId: 'generated-profile', kind: 'profile-draft', actionOwner: 'profileActions', tools: ['muyu.profile.preview'] }] },
        { id: 'web', module: web, bindAssistant: (identity, intent) => web.bindRun(identity, intent), taskLifecycle: true,
            tools: tools('muyu.web.', ['search']), artifacts: [] },
        { id: 'agent-memory', module: notes, bindAssistant: (identity, intent) => notes.bindRun(identity, intent),
            tools: tools('muyu.notes.', ['list', 'read', 'remember', 'forget']), artifacts: [] },
    ];
}
