import test from 'node:test';

for (const lang of ['zh', 'en']) for (const action of ['rename', 'archive', 'remove']) test(`Floating narrow history row confirmation remains visible and requires explicit confirmation / ${lang}/${action}`, async () => {
    const launcher = new Element('div', {}), f = fixture(lang, true, { actionsRoot: launcher });
    f.state.history = managedHistory(); f.emit();
    const labels = { rename: ['重命名', 'Rename'], archive: ['归档', 'Archive'], remove: ['删除', 'Delete'] };
    const choose = values => values[lang === 'en' ? 1 : 0];
    await launcher.children.find(e => e.textContent === choose(['历史', 'History'])).click();
    const popup = f.all().find(e => e.className === 'gd-muyu-row-menu-list');
    const before = JSON.stringify(f.state.history);
    await popup.children.find(e => e.textContent === choose(labels[action])).click();
    const form = f.all().find(e => e.className === 'gd-muyu-history-confirm');
    for (let ancestor = form; ancestor; ancestor = ancestor.parent) assert.notEqual(ancestor.hidden, true, 'confirmation and all ancestors must be visible');
    assert.equal(JSON.stringify(f.state.history), before, 'opening confirmation must not mutate history');
    const expectedId = f.state.history.sessionId, calls = [];
    f.controller.renameSession = (...args) => calls.push(['rename', ...args]);
    f.controller.archiveSession = (...args) => calls.push(['archive', ...args]);
    f.controller.deleteSession = (...args) => calls.push(['remove', ...args]);
    const input = f.all(form).find(e => e.tag === 'input');
    if (action === 'rename') { assert.equal(f.root.ownerDocument.activeElement, input); input.value = 'New title'; }
    const confirm = f.all(form).find(e => e.tag === 'button' && e.textContent === choose(['确认', 'Confirm']));
    if (action !== 'rename') assert.equal(f.root.ownerDocument.activeElement, confirm);
    await confirm.click();
    assert.equal(calls.length, 1); assert.equal(calls[0][0], action); assert.equal(calls[0][1], expectedId);
    assert.equal(form.hidden, true); assert.equal(f.sent.length, 0); f.root.__gdMuyuDispose();
});

for (const lang of ['zh', 'en']) test('Header theme segments precede settings, preserve detail and input, and sync settings / ' + lang, async () => {
    const launcher = new Element('div', {}), f = fixture(lang, true, { actionsRoot: launcher });
    f.state.displayConfig = { processDetail: 'full', theme: 'host' }; f.emit();
    const group = launcher.children[0], gear = launcher.children[1];
    assert.equal(group.className, 'gd-muyu-theme-switcher'); assert.equal(gear.textContent, '⚙');
    assert.equal(group.getAttribute('role'), 'group'); assert.equal(group.children.length, 3);
    const light = group.children[2], dusk = group.children[1];
    assert.equal(light.getAttribute('aria-label'), lang === 'en' ? 'Morning · Light' : '晨光 · 浅色');
    f.controller.saveDisplayConfig = async value => { f.state.displayConfig = value; f.emit(); };
    const composer = f.find('textarea'); composer.value = 'unsent message'; composer.oninput();
    await light.click(); assert.deepEqual(f.state.displayConfig, { processDetail: 'full', theme: 'light' });
    assert.equal(light.getAttribute('aria-pressed'), 'true'); assert.equal(composer.value, 'unsent message');
    const label = lang === 'en' ? 'Muyu appearance' : '暮羽界面主题';
    const select = f.all().find(e => e.tag === 'select' && e.parent.textContent === label);
    assert.equal(select.value, 'light'); select.value = 'dusk'; await select.onchange();
    assert.equal(dusk.getAttribute('aria-pressed'), 'true'); assert.equal(light.getAttribute('aria-pressed'), 'false');
    assert.equal(f.sent.length, 0); assert.equal(f.configs.length, 0);
    f.root.__gdMuyuDispose(); assert.equal(launcher.children.length, 0);
    f.mount(); assert.equal(launcher.children[0].children[1].getAttribute('aria-pressed'), 'true'); f.root.__gdMuyuDispose();
});

test('Header theme save guards concurrent clicks and failure; disposed controls cannot save', async () => {
    const launcher = new Element('div', {}), f = fixture('en', true, { actionsRoot: launcher });
    const group = launcher.children[0], dusk = group.children[1], light = group.children[2];
    let reject, saves = 0;
    f.controller.saveDisplayConfig = () => { saves++; return new Promise((_, no) => reject = no); };
    const pending = dusk.onclick(); assert.ok(group.children.every(button => button.disabled));
    await light.onclick(); assert.equal(saves, 1);
    reject(Error('sensitive backend details')); await pending;
    assert.equal(group.children[0].getAttribute('aria-pressed'), 'true'); assert.ok(group.children.every(button => !button.disabled));
    assert.ok(f.all().some(e => /Theme could not be saved/.test(e.textContent || '')));
    assert.ok(!f.all().some(e => /sensitive backend/.test(e.textContent || '')));
    f.root.__gdMuyuDispose(); await dusk.onclick(); assert.equal(saves, 1);
});

test('History row actions use a separate popup; Escape keeps history open and returns focus', async () => {
    const f = fixture('en', true); f.state.history = managedHistory(); f.emit();
    await f.find('button', 'History').click();
    const menu = f.all().find(e => e.className === 'gd-muyu-row-menu');
    const list = menu.children.find(e => e.className === 'gd-muyu-row-menu-list');
    assert.equal(list.children.filter(e => e.tag === 'button').length, 5);
    menu.open = true;
    let prevented = false, stopped = false;
    menu.onkeydown({ key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
    assert.equal(menu.open, false); assert.equal(prevented, true); assert.equal(stopped, true);
    assert.equal(f.root.ownerDocument.activeElement, menu.children[0]);
    assert.equal(f.find('aside').hidden, false);
    menu.open = true;
    await list.children.find(e => e.textContent === 'Rename').click();
    assert.equal(menu.open, false); assert.ok(f.all().some(e => e.className === 'gd-muyu-history-confirm' && !e.hidden));
    assert.equal(f.sent.length, 0); f.root.__gdMuyuDispose();
});

for (const lang of ['zh', 'en']) test('History date headings, metadata and selected row are display-only / ' + lang, () => {
    const f = fixture(lang, true); f.state.history = managedHistory();
    const now = new Date(), previous = new Date(now); previous.setDate(previous.getDate() - 1);
    f.state.history.sessions = [
        { ...f.state.history.sessions[0], updatedAt: now.getTime(), status: 'running' },
        { ...f.state.history.sessions[0], id: 'previous', title: '<script>literal</script>', updatedAt: previous.getTime(), status: 'failed' },
    ];
    const original = JSON.stringify(f.state.history); f.emit();
    const headings = f.all().filter(e => e.className === 'gd-muyu-history-date');
    assert.deepEqual(headings.map(e => e.textContent), lang === 'en' ? ['Today', 'Yesterday'] : ['今天', '昨天']);
    const selected = f.all().find(e => e.className === 'gd-muyu-session-row' && e.getAttribute('data-selected') === 'true');
    assert.ok(selected);
    assert.equal(f.all(selected).find(e => e.className === 'gd-muyu-session-status').getAttribute('data-state'), 'running');
    assert.ok(f.all().some(e => e.tag === 'time' && e.getAttribute('datetime')));
    assert.equal(f.find('script'), undefined); assert.equal(JSON.stringify(f.state.history), original);
    assert.equal(f.sent.length, 0); f.root.__gdMuyuDispose();
});

test('Theme projects only to the floating ancestor and never remounts the conversation', async () => {
    const f = fixture('en', true);
    const host = f.root.ownerDocument.createElement('div');
    host.classList.contains = name => name === 'gd-floating-root';
    host.append(f.root); f.mount();
    const shell = f.root.children[0], composer = f.find('textarea');
    assert.equal(host.getAttribute('data-muyu-theme'), 'host');
    f.state.displayConfig = { processDetail: 'compact', theme: 'dusk' }; f.emit();
    assert.equal(host.getAttribute('data-muyu-theme'), 'dusk');
    assert.equal(f.root.children[0], shell); assert.equal(f.find('textarea'), composer);
    f.state.displayConfig.theme = 'light'; f.emit();
    assert.equal(host.getAttribute('data-muyu-theme'), 'light');
    assert.equal(f.root.getAttribute('data-muyu-theme'), undefined);
    f.root.__gdMuyuDispose();
});

for (const lang of ['zh', 'en']) test('Appearance auto-saves without losing execution detail, composer draft or invoking a model / ' + lang, async () => {
    const f = fixture(lang, true);
    f.state.displayConfig = { processDetail: 'detailed', theme: 'host' }; f.emit();
    const label = lang === 'en' ? 'Muyu appearance' : '暮羽界面主题';
    const theme = f.all().find(e => e.tag === 'select' && e.parent.textContent === label);
    f.controller.saveDisplayConfig = async value => { f.state.displayConfig = value; f.emit(); };
    const input = f.find('textarea'); input.value = 'Keep my unsent message'; input.oninput();
    theme.value = 'light'; await theme.onchange();
    assert.deepEqual(f.state.displayConfig, { processDetail: 'detailed', theme: 'light' });
    assert.equal(input.value, 'Keep my unsent message');
    assert.equal(f.sent.length, 0); assert.equal(f.configs.length, 0);
    f.root.__gdMuyuDispose(); f.mount();
    assert.equal(f.all().find(e => e.tag === 'select' && e.parent.textContent === label).value, 'light');
    f.root.__gdMuyuDispose();
});

for (const lang of ['zh', 'en']) test('Ordinary preferences auto-save without applying credentials or sending a model request / ' + lang, async () => {
    const f = fixture(lang, true), en = lang === 'en';
    const control = label => f.all().find(e => e.parent?.textContent === label && ['input', 'select'].includes(e.tag));
    const calls = [];
    f.controller.saveDisplayConfig = async value => { calls.push(['display', value]); f.state.displayConfig = value; f.emit(); };
    const display = control(en ? 'Execution detail' : '执行过程显示');
    assert.equal(f.find('button', en ? 'Save display settings' : '保存显示设置').hidden, true);
    display.value = 'standard'; await display.onchange();
    assert.equal(f.state.displayConfig.processDetail, 'standard');
    f.controller.saveRunConfig = async value => { calls.push(['budget', value]); f.state.runConfig = value; f.emit(); };
    const budget = control(en ? 'Model calls' : '模型调用次数');
    budget.value = ''; await budget.onchange(); assert.equal(calls.length, 1);
    budget.value = '7'; await budget.onchange(); assert.equal(f.state.runConfig.modelCalls, 7);
    await budget.onblur(); assert.equal(calls.length, 2, 'change followed by blur must not save twice');
    f.controller.saveWebSearchLimits = async value => { calls.push(['web', value]); f.state.webSearch = { ...f.state.webSearch, ...value }; f.emit(); };
    const key = control(en ? 'Brave Search API key' : 'Brave Search API 密钥'); key.value = 'UNSUBMITTED_KEY'; key.events.input();
    const limits = control(en ? 'Search attempts per task' : '每任务最多搜索次数');
    limits.value = '2'; await limits.onchange();
    assert.equal(calls.at(-1)[0], 'web'); assert.equal(calls.at(-1)[1].maxSearches, 2);
    assert.equal(key.value, 'UNSUBMITTED_KEY'); assert.equal(f.configs.length, 0); assert.equal(f.sent.length, 0);
    f.root.__gdMuyuDispose();
});

test('Behavior switches auto-save; text commits on blur and disposed editors cancel delayed saves', async () => {
    const f = fixture('en', true);
    f.state.instructionSettings = { saved: { enabled: false, text: '' }, draft: { enabled: false, text: '' }, dirty: false, saving: false };
    let writes = 0;
    f.controller.setInstructionDraft = value => { f.state.instructionSettings.draft = value; f.state.instructionSettings.dirty = true; f.emit(); };
    f.controller.saveInstructions = async () => { writes++; const s = f.state.instructionSettings; s.saved = structuredClone(s.draft); s.dirty = false; f.emit(); };
    f.emit();
    const toggle = f.all().find(e => e.type === 'checkbox' && e.parent.textContent === 'Enable additional instructions (off by default)');
    toggle.checked = true; await toggle.onchange(); assert.equal(writes, 1);
    const text = f.all().find(e => e.tag === 'textarea' && e.parent.textContent === 'Additional instructions');
    text.value = 'Be concise'; await text.oninput(); assert.equal(writes, 1);
    await text.onblur(); assert.equal(writes, 2); assert.equal(f.state.instructionSettings.saved.text, 'Be concise');
    text.value = 'After typing'; await text.oninput();
    await new Promise(resolve => setTimeout(resolve, 650)); assert.equal(writes, 3); assert.equal(f.state.instructionSettings.saved.text, 'After typing');
    text.value = 'Retained draft'; await text.oninput(); f.root.__gdMuyuDispose();
    await new Promise(resolve => setTimeout(resolve, 650)); assert.equal(writes, 3);
});

test('Context and collection switches save automatically; failed collection saves retain input for retry', async () => {
    const f = fixture('en', true), calls = [];
    const control = label => f.all().find(e => e.parent?.textContent === label && ['input', 'select'].includes(e.tag));
    f.controller.saveContextConfig = async value => { calls.push(['context', value]); f.state.contextConfig = value; f.emit(); };
    const summary = control('Auto-summarize on send (extra model call, off by default)');
    summary.checked = true; await summary.onchange(); assert.equal(calls.at(-1)[0], 'context'); assert.equal(calls.at(-1)[1].autoSummary, true);
    let fail = true;
    f.controller.saveDiagnosticsConfig = async value => { if (fail) throw Error('disk'); calls.push(['diagnostics', value]); f.state.diagnostics = { config: value }; f.emit(); };
    const diagnostics = control('Collect local diagnostics (off by default)'); diagnostics.checked = true; await diagnostics.onchange();
    const retry = f.find('button', 'Save diagnostics'); assert.equal(retry.hidden, false); assert.equal(diagnostics.checked, true);
    fail = false; await retry.click(); assert.equal(retry.hidden, true); assert.equal(f.state.diagnostics.config.enabled, true);
    f.controller.savePromptCaptureConfig = async value => { calls.push(['capture', value]); f.state.promptCapture = { config: value }; f.emit(); };
    const capture = control('Capture prompt text (off by default)'); capture.checked = true; await capture.onchange();
    assert.equal(f.state.promptCapture.config.enabled, true); assert.equal(f.sent.length, 0);
    f.root.__gdMuyuDispose();
});

for (const lang of ['zh', 'en']) test('Builtin Skill labels localize in picker, catalog, search and readonly editor without changing identity / ' + lang, () => {
    const doc = { createElement: tag => new Element(tag, doc) }, settings = doc.createElement('section'), parent = doc.createElement('div');
    const calls = [], controller = { loadSkills() {}, selectSkill: (...args) => calls.push(args) };
    const draft = { id: 'builtin:memory-maintenance', revision: '2:0', name: 'memory-maintenance', displayName: '记忆配置与维护', description: '原始中文用途', body: '原始中文正文', contentVersion: '1.1', modelInvocable: true, userInvocable: true, resourcesJson: '[]', enabled: true, source: 'builtin' };
    const state = { mode: 'assistant', skills: { available: true, loaded: true, enabled: true, busy: false, dirty: false, draft, rows: [{ ...draft }] }, selectedSkill: { id: draft.id, revision: draft.revision, displayName: draft.displayName } };
    const original = JSON.stringify(state);
    const view = createSkillView({ doc, settings, controller, act: fn => fn(), lang }); view.render(state);
    const picker = createSkillPicker({ doc, parent, controller, act: fn => fn(), lang }); picker.render(state);
    const all = root => { const nodes = []; const walk = el => { nodes.push(el); el.children.forEach(walk); }; walk(root); return nodes; };
    const title = lang === 'en' ? 'Character memory maintenance' : draft.displayName;
    assert.ok(all(settings).some(el => el.tag === 'strong' && el.textContent === title));
    assert.ok(all(settings).some(el => el.tag === 'pre' && el.textContent === draft.body));
    const search = all(settings).find(el => el.type === 'search'); search.value = lang === 'en' ? 'character memory' : '记忆'; search.oninput();
    assert.ok(all(settings).some(el => el.className === 'gd-muyu-skill-select'));
    const select = all(parent).find(el => el.tag === 'select');
    assert.ok(select.options.some(el => el.textContent === title + (lang === 'en' ? ' · Builtin' : ' · 内置')));
    select.value = draft.id; select.onchange();
    assert.deepEqual(calls, [[draft.id, draft.revision]]);
    assert.equal(JSON.stringify(state), original);
});

for (const lang of ['zh', 'en']) test('Permission GUI title follows language while source identity and user purpose stay unchanged / ' + lang, () => {
    const doc = { createElement: tag => new Element(tag, doc) }, parent = doc.createElement('div'), settings = doc.createElement('div'), answers = [];
    const view = createPermissionView({ doc, parent, settings, lang, act: fn => fn(), controller: { answerPermission: (...args) => answers.push(args) } });
    const request = { id: 'read', kind: 'permission', source: 'memoryConfig', status: 'pending', reason: '用户原话不翻译' };
    view.render({ interaction: request, sourceGrants: ['source:memoryConfig'] });
    const all = root => { const nodes = []; const walk = el => { nodes.push(el); el.children.forEach(walk); }; walk(root); return nodes; };
    assert.ok(all(parent).some(el => el.textContent === (lang === 'en' ? 'Muyu requests access to: Raw memory settings' : '暮羽希望读取：记忆配置原始值')));
    assert.ok(all(parent).some(el => el.textContent?.includes(request.reason)));
    all(parent).find(el => el.tag === 'button' && el.textContent === (lang === 'en' ? 'Allow this task' : '允许本任务')).onclick();
    assert.deepEqual(answers, [['read', 'task']]);
    assert.equal(request.source, 'memoryConfig');
});
for(const operation of ['copy','save_current','update','select'])for(const lang of ['zh','en'])test('ST preset review '+operation+' / '+lang+' folds full diff and requires exact approval',async()=>{
    const f=fixture(lang,true,{initialMode:'assistant'});let prepared=0,approved=0;
    f.state.artifacts=[{id:'draft',kind:'st-preset-draft',revision:1,sourceRunId:'r',content:{module:'st-preset-editor',operation,name:'<script>Preset</script>',before:{temperature:1},after:{temperature:1.5},warnings:['Saved resource and live settings are distinct']}}];
    f.state.canApplyStPreset=true;f.state.stPresetActions=[];
    f.controller.prepareStPresetApply=(id,revision)=>{assert.equal(id,'draft');assert.equal(revision,1);prepared++;};
    f.controller.approveStPresetApply=id=>{assert.equal(id,'op');approved++;};
    f.emit();assert.equal(f.find('script'),undefined);const summary=f.find('summary',lang==='en'?'Review complete approved changes':'查看完整批准差异');assert.ok(summary);assert.ok(!summary.parent.open);
    await f.find('button',lang==='en'?'Review preset operation':'查看并执行预设操作').click();assert.equal(prepared,1);assert.equal(approved,0);
    f.state.stPresetActions=[{id:'op',artifactId:'draft',revision:1,status:'pending'}];f.emit();
    const labels={copy:['复制保存预设（不激活）','Copy saved preset (do not activate)'],save_current:['另存当前运行配置（不激活）','Save live settings as new preset (do not activate)'],update:['修改保存预设（不激活）','Edit saved preset (do not activate)'],select:['激活预设并替换当前参数与提示词','Activate preset, replacing live parameters and Prompts']};
    await f.find('button',labels[operation][lang==='en'?1:0]).click();assert.equal(approved,1);assert.equal(f.sent.length,0);f.root.__gdMuyuDispose();
});
for(const operation of ['update','copy','create','rename','delete'])for(const lang of ['zh','en'])test('ST character-card review keeps full diff collapsed and requires one exact approval / '+operation+' / '+lang,async()=>{
    const f=fixture(lang,true,{initialMode:'assistant'});let approved=0,prepared=0;
    f.state.artifacts=[{id:'draft',kind:'character-card-draft',revision:1,sourceRunId:'r',content:{module:'character-card',operation,name:'<script>Card</script>',selector:'card:0',before:{description:'old'},after:{description:'new'},warnings:['Shared card affects all chats']}}];
    f.state.canApplyCharacterCard=true;f.state.characterCardActions=[];
    f.controller.prepareCharacterCardApply=(id,revision)=>{assert.equal(id,'draft');assert.equal(revision,1);prepared++;};
    f.controller.approveCharacterCardApply=id=>{assert.equal(id,'op');approved++;};
    f.emit();assert.equal(f.find('script'),undefined);const summary=f.find('summary',lang==='en'?'Complete approved changes':'完整批准差异');assert.ok(!summary.parent.open);
    await f.find('button',lang==='en'?'Review character-card operation':'查看并执行角色卡操作').click();assert.equal(prepared,1);assert.equal(approved,0);
    f.state.characterCardActions=[{id:'op',artifactId:'draft',revision:1,status:'pending'}];f.emit();
    const labels={copy:['复制这张角色卡','Copy this character card'],create:['创建这张角色卡','Create this character card'],rename:['应用显示名修改','Apply display name change'],delete:['永久删除这张角色卡','Permanently delete this character card'],update:['应用这份文本修改','Apply these text changes']};
    await f.find('button',labels[operation][lang==='en'?1:0]).click();assert.equal(approved,1);assert.equal(f.sent.length,0);f.root.__gdMuyuDispose();
});
for(const operation of ['update','create_entry','delete_entry','create_book','copy_book','set_global_binding','set_chat_binding','delete_book'])for(const lang of ['zh','en'])test('World-book entry card keeps diff collapsed and requires exact approval / '+operation+' / '+lang,async()=>{
 const f=fixture(lang,true,{initialMode:'assistant'});let prepared=0,approved=0;
 const bookOperation=['create_book','copy_book','delete_book'].includes(operation),binding=['set_global_binding','set_chat_binding'].includes(operation),deleting=operation==='delete_book';
 f.state.artifacts=[{id:'draft',kind:'worldbook-edit-draft',revision:1,sourceRunId:'r',content:{module:'worldbook-editor',operation,name:'<script>Book</script>',selector:'entry:0:0',before:{content:'old'},after:operation==='delete_entry'?null:{content:'new'},warnings:['Shared resource: all chats']}}];
 f.state.canApplyWorldBookEdit=true;f.state.worldBookEditActions=[];
 f.controller.prepareWorldBookEditApply=(id,revision)=>{assert.equal(id,'draft');assert.equal(revision,1);prepared++;};
 f.controller.approveWorldBookEditApply=id=>{assert.equal(id,'op');approved++;};
 f.emit();assert.equal(f.find('script'),undefined);
 const summary=f.find('summary',binding?(lang==='en'?'Complete binding changes':'完整绑定差异'):bookOperation?(lang==='en'?'Complete world-book contents':'完整世界书内容'):(lang==='en'?'Complete entry changes':'完整条目差异'));assert.ok(summary);assert.ok(!summary.parent.open);
 await f.find('button',deleting?(lang==='en'?'Review and delete world book':'查看并删除整本世界书'):binding?(lang==='en'?'Review and change world-book binding':'查看并修改世界书绑定'):bookOperation?(lang==='en'?'Review and create world book':'查看并创建世界书'):(lang==='en'?'Review and apply world-book entry':'查看并应用世界书条目')).click();assert.equal(prepared,1);assert.equal(approved,0);
 f.state.worldBookEditActions=[{id:'op',artifactId:'draft',revision:1,status:'pending'}];f.emit();
 const label=deleting?(lang==='en'?'Permanently delete this world book':'永久删除这本世界书'):binding?(lang==='en'?'Apply this binding change':'应用这份绑定修改'):bookOperation?(lang==='en'?'Create this world book':'创建这份世界书'):operation==='delete_entry'?(lang==='en'?'Delete this complete entry':'删除这份完整条目'):(lang==='en'?'Apply these entry changes':'应用这份条目修改');
 await f.find('button',label).click();assert.equal(approved,1);assert.equal(f.sent.length,0);f.root.__gdMuyuDispose();
});
for(const lang of ['zh','en'])for(const operation of ['create','delete','move'])test('Blueprint structure card '+operation+' / '+lang+' shows progress and exact approval',async()=>{
 const f=fixture(lang,true,{initialMode:'assistant'});let approved=0;
 const content={module:'blueprint-node-editor',operation,name:'Tree',selector:'blueprint-tree',affected:['a'],before:{progressTracks:{leaf:{doneSignals:[{nodeId:'a'}]}}},after:{progressTracks:{leaf:{doneSignals:[]}}},completion:{before:{exists:true,value:true},after:{exists:true,value:false}},warnings:['Full diff required']};
 f.state.artifacts=[{id:'draft',kind:'blueprint-node-edit-draft',revision:1,sourceRunId:'r',content}];f.state.canApplyBlueprintNodeEdit=true;
 f.state.blueprintNodeEditActions=[{id:'op',artifactId:'draft',revision:1,status:'pending'}];
 f.controller.approveBlueprintNodeEditApply=id=>{assert.equal(id,'op');approved++;};
 f.emit();const progress=f.all().find(e=>e.tag==='p'&&e.textContent?.includes(lang==='en'?'Stored completion signals':'存储的完成标记'));assert.match(progress.textContent,/1 → 0/);
 const warning=f.all().find(e=>e.tag==='small'&&e.textContent?.includes(lang==='en'?'Structure changes':'结构调整'));assert.ok(warning);
 await f.find('button',lang==='en'?'Apply this blueprint node change':'应用这份蓝图节点修改').click();assert.equal(approved,1);assert.equal(f.sent.length,0);f.root.__gdMuyuDispose();
});
for(const lang of ['zh','en'])for(const kind of ['selection-draft','ledger-edit-draft'])test('Dedicated selection / ledger cards render exact approval with live panel state '+kind+' / '+lang,async()=>{
 const f=fixture(lang,true,{initialMode:'assistant'}),selection=kind==='selection-draft';let prepared=0,approved=0;
 const content=selection?{module:'selection-editor',kind:'worldbooks',name:'World books',before:{sourceMode:'st',selection:{}},after:{sourceMode:'manual',selection:{'<script>book</script>':true}},warnings:['Save only']}:{module:'ledger-editor',name:'Ledger',operation:'update',selector:'ledger:0',before:{reason:'old'},after:{reason:'new'},warnings:['Chat only']};
 f.state.artifacts=[{id:'draft',kind,revision:1,sourceRunId:'r',content}];
 f.state[selection?'canApplySelection':'canApplyLedgerEdit']=true;
 const key=selection?'selectionActions':'ledgerEditActions';
 f.state[key]=[];
 f.controller[selection?'prepareSelectionApply':'prepareLedgerEditApply']=(id,revision)=>{assert.equal(id,'draft');assert.equal(revision,1);prepared++;};
 f.controller[selection?'approveSelectionApply':'approveLedgerEditApply']=id=>{assert.equal(id,'op');approved++;};
 f.emit();assert.equal(f.find('script'),undefined);
 const label=selection?(lang==='en'?'Review and save selection policy':'查看并保存选择策略'):(lang==='en'?'Review and apply ledger entry':'查看并应用账本');
 assert.ok(f.find('button',label));await f.find('button',label).click();assert.equal(prepared,1);assert.equal(approved,0);
 f.state[key]=[{id:'op',artifactId:'draft',revision:1,status:'pending'}];f.emit();
 const confirm=selection?(lang==='en'?'Save this change':'保存这份修改'):(lang==='en'?'Apply this ledger entry change':'应用这份账本修改');
 await f.find('button',confirm).click();assert.equal(approved,1);assert.equal(f.sent.length,0);f.root.__gdMuyuDispose();
});
import assert from 'node:assert/strict';
import { mountMuyuPanel } from '../../muyu/ui/panel.js';
import { createPermissionView } from '../../muyu/ui/permission-view.js';
import { createSkillView } from '../../muyu/ui/skill-view.js';
import { createSkillPicker } from '../../muyu/ui/skill-picker.js';
import { createReceiptView } from '../../muyu/ui/receipt-view.js';
import { actionReceipt } from '../../muyu/actions/receipts.js';
import { createSkillPort } from '../../muyu/host/skills.js';
import { createHostBridge } from '../../muyu/host/bridge.js';
import { createMuyuController } from '../../muyu/application/controller.js';
import { scriptedModel, text, done, flush } from './helpers/muyu-subject.mjs';
import { EventEmitter } from 'node:events';
for (const lang of ['zh', 'en']) test('Skill composer picker uses exact GUI identity, hides disabled entries and preserves selection / ' + lang, async () => {
    const doc = { createElement: tag => new Element(tag, doc) }, parent = doc.createElement('div'), selected = [];
    const picker = createSkillPicker({ doc, parent, lang, act: fn => fn(), controller: { selectSkill: (...args) => selected.push(args), loadSkills() {} } });
    const state = { mode: 'assistant', skills: { available: true, rows: [{ id: 'user:manual', revision: 2, displayName: '<script>Manual</script>', userInvocable: true, source: 'user' }, { id: 'user:disabled', revision: 3, displayName: 'Disabled', userInvocable: false }] }, selectedSkill: null };
    picker.render(state); const select = parent.children[0].children[1].children[0];
    assert.equal(select.options.length, 2); assert.equal(select.options[1].value, 'user:manual');
    select.value = 'user:manual'; select.onchange(); assert.deepEqual(selected, [['user:manual', 2]]);
    state.selectedSkill = { id: 'user:manual', revision: '2', displayName: '<script>Manual</script>' }; picker.render(state); assert.equal(select.value, 'user:manual');
    state.busy = true; picker.render(state); assert.equal(select.disabled, true); assert.equal(parent.children[0].tag, 'details');
});
for (const lang of ['zh', 'en']) test('Skill GUI lives in floating settings, retains form content and protects builtin editors / ' + lang, async () => {
    const doc = { createElement: tag => new Element(tag, doc) }, settings = doc.createElement('section');
    const calls = [], controller = { loadSkills() {}, setSkillDraft: value => calls.push(value), editSkill: (id, revision) => calls.push([id, revision]) };
    const view = createSkillView({ doc, settings, controller, act: fn => fn(), lang });
    const all = () => { const values = []; const visit = e => { values.push(e); e.children.forEach(visit); }; visit(settings); return values; };
    const draft = { id: 'builtin:example', revision: '1:0', name: 'example', displayName: '<script>Title</script>', description: 'Read-only', body: '<script>Body</script>', contentVersion: '', modelInvocable: true, userInvocable: true, resourcesJson: '[]', enabled: true, source: 'builtin' };
    const state = { skills: { available: true, loaded: true, enabled: true, busy: false, error: null, result: null, draft, rows: [{ ...draft }] } };
    view.render(state);
    const body = all().find(el => el.tag === 'textarea' && el.value === draft.body);
    assert.ok(body.disabled); assert.equal(all().some(el => el.tag === 'script'), false);
    assert.equal(all().find(el => el.tag === 'button' && el.textContent === (lang === 'en' ? 'Save Skill' : '保存当前技能')).disabled, true);
    assert.equal(all().some(el => el.tag === 'button' && el.textContent === (lang === 'en' ? 'Delete' : '删除')), false);
    const edit = all().find(el => el.className === 'gd-muyu-skill-select');
    await edit.click(); assert.equal(calls.length, 0);
    await all().find(el => el.tag === 'button' && el.textContent === (lang === 'en' ? 'Confirm' : '确认')).click();
    assert.deepEqual(calls, [['builtin:example', '1:0']]);
    state.skills.draft = { ...draft, id: '', source: 'user', body: 'Unsaved draft' }; view.render(state);
    assert.equal(body.disabled, false); assert.equal(body.value, 'Unsaved draft');
    view.render(state); assert.equal(body.value, 'Unsaved draft');
});
for (const lang of ['zh', 'en']) test('Generation batch card shows the exact ordered modes and one nonpersistent approval / ' + lang, async () => {
    const doc = { createElement: tag => new Element(tag, doc) }, parent = doc.createElement('div'), settings = doc.createElement('div');
    const decisions = [], controller = { generationBatchExecutionDetails: () => ({ maximumModelCalls: 3, steps: [
        { kind: 'memory', name: '<script>Alice</script>', mode: 'save' }, { kind: 'profile', name: 'Bob', mode: 'trial' }, { kind: 'npc', requested: 5, effectiveCount: 2, mode: 'save' },
    ] }), answerPermission: (id, decision) => decisions.push([id, decision]) };
    const view = createPermissionView({ doc, parent, settings, controller, act: fn => fn(), lang });
    view.render({ interaction: { id: 'request', kind: 'permission', source: 'generationBatchExecution', executionId: 'ticket', status: 'pending', reason: 'Generate list' } });
    const card = parent.children[0], actions = card.children.find(row => row.className === 'gd-muyu-actions').children;
    assert.equal(actions[1].hidden, true); const summary = card.children.find(row => row.className === 'gd-muyu-generation-summary');
    assert.match(summary.textContent, /1\. .*Alice[\s\S]*2\. .*Bob[\s\S]*3\. .*5\/2/);
    assert.match(summary.textContent, /Trial, no save|试跑，不保存/); assert.match(summary.textContent, /may be pruned|可能裁剪/);
    assert.match(summary.textContent, /Non-atomic|不是原子事务/); assert.match(summary.textContent, /No character-card import|no character-card import|不导入角色卡/);
    assert.equal(card.children.some(row => row.tag === 'script'), false);
    await actions[0].click(); assert.deepEqual(decisions, [['request', 'task']]); view.dispose();
});
for (const lang of ['zh', 'en']) test('Expired batch definition is explicit without displaying old step data / ' + lang, () => {
    const doc = { createElement: tag => new Element(tag, doc) }, parent = doc.createElement('div'), settings = doc.createElement('div');
    const view = createPermissionView({ doc, parent, settings, controller: { generationBatchExecutionDetails: () => null }, act: fn => fn(), lang });
    view.render({ interaction: { id: 'request', kind: 'permission', source: 'generationBatchExecution', executionId: 'ticket', status: 'pending', reason: 'Generate' } });
    assert.match(parent.children[0].children.find(row => row.className === 'gd-muyu-generation-summary').textContent, /expired|失效/); view.dispose();
});
for (const lang of ['zh', 'en']) for (const mode of ['trial', 'save']) test(`NPC generation consent ${mode} / ${lang} displays count, capacity and card-import boundary`, async () => {
    const doc = { createElement: tag => new Element(tag, doc) }, parent = doc.createElement('div'), settings = doc.createElement('div');
    const decisions = [], controller = { npcExecutionDetails: () => ({ mode, requested: 5, effectiveCount: 2, existingCount: 8, limit: 10 }),
        answerPermission: (id, decision) => decisions.push([id, decision]) };
    const view = createPermissionView({ doc, parent, settings, controller, act: fn => fn(), lang });
    view.render({ interaction: { id: 'request', kind: 'permission', source: 'npcExecution', executionId: 'ticket', status: 'pending', reason: '<script>Generate</script>' } });
    const card = parent.children[0], actions = card.children.find(row => row.className === 'gd-muyu-actions').children;
    assert.equal(actions[1].hidden, true);
    const content = card.children.filter(row => row.tag === 'p').map(row => row.textContent).join('\n');
    assert.match(content, /5\/2/); assert.match(content, /8\/10/); assert.match(content, /No character-card import|不导入角色卡/);
    assert.match(content, lang === 'en' ? /extra costs/ : /额外产生费用/);
    assert.match(content, mode === 'trial' ? /Trial, no save|试生成，不保存/ : /Generate and save|生成并保存/);
    assert.equal(card.children.some(row => row.tag === 'script'), false); assert.equal(decisions.length, 0);
    await actions[0].click(); assert.deepEqual(decisions, [['request', 'task']]);
    view.render({ interaction: null }); assert.equal(card.hidden, true); view.dispose();
});
for (const lang of ['zh', 'en']) for (const mode of ['trial', 'save']) test(`Profile generation consent ${mode} / ${lang} exposes target and risk without persistent approval`, async () => {
    const doc = { createElement: tag => new Element(tag, doc) }, parent = doc.createElement('div'), settings = doc.createElement('div');
    const decisions = [], controller = { profileExecutionDetails: () => ({ name: '<script>Alice</script>', mode, existing: false }),
        answerPermission: (id, decision) => decisions.push([id, decision]) };
    const view = createPermissionView({ doc, parent, settings, controller, act: fn => fn(), lang });
    view.render({ interaction: { id: 'request', kind: 'permission', source: 'profileExecution', executionId: 'ticket', status: 'pending', reason: 'Generate profile' } });
    const card = parent.children[0], actions = card.children.find(row => row.className === 'gd-muyu-actions').children;
    assert.equal(actions[1].hidden, true);
    const content = card.children.filter(row => row.tag === 'p').map(row => row.textContent).join('\n');
    assert.match(content, /<script>Alice<\/script>/); assert.match(content, /No existing profile|尚无档案/);
    assert.match(content, lang === 'en' ? /extra costs/ : /额外产生费用/);
    assert.match(content, mode === 'trial' ? /Trial, no save|试生成，不保存/ : /Generate and save|生成并保存/);
    assert.equal(card.children.some(row => row.tag === 'script'), false); assert.equal(decisions.length, 0);
    await actions[0].click(); assert.deepEqual(decisions, [['request', 'task']]);
    view.render({ interaction: null }); assert.equal(card.hidden, true); view.dispose();
});
for (const lang of ['zh', 'en']) for (const mode of ['trial', 'save']) test(`Memory extraction consent ${mode} / ${lang} exposes target and risk without persistent approval`, async () => {
    const doc = { createElement: tag => new Element(tag, doc) }, parent = doc.createElement('div'), settings = doc.createElement('div');
    const decisions = [], controller = { memoryExecutionDetails: () => ({ name: '<script>Alice</script>', mode, existingCount: 2, limit: 3 }),
        answerPermission: (id, decision) => decisions.push([id, decision]) };
    const view = createPermissionView({ doc, parent, settings, controller, act: fn => fn(), lang });
    view.render({ interaction: { id: 'request', kind: 'permission', source: 'memoryExecution', executionId: 'ticket', status: 'pending', reason: 'Extract memories' } });
    const card = parent.children[0], actions = card.children.find(row => row.className === 'gd-muyu-actions').children;
    assert.equal(actions[1].hidden, true);
    const content = card.children.filter(row => row.tag === 'p').map(row => row.textContent).join('\n');
    assert.match(content, /<script>Alice<\/script>/); assert.match(content, /2\/3/);
    assert.match(content, lang === 'en' ? /extra costs/ : /额外产生费用/);
    assert.match(content, mode === 'trial' ? /Trial, no save|试跑，不保存/ : /Generate and save|生成并保存/);
    assert.equal(card.children.some(row => row.tag === 'script'), false); assert.equal(decisions.length, 0);
    await actions[0].click(); assert.deepEqual(decisions, [['request', 'task']]);
    view.render({ interaction: null }); assert.equal(card.hidden, true); view.dispose();
});
import { importPreview } from '../../muyu/sessions/exchange.js';
import { createHistoryView } from '../../muyu/ui/history-view.js';

// Minimal native DOM contract; does not assert CSS geometry or browser layout.
class Element {
    constructor(tag, doc) { this.tag = tag; this.ownerDocument = doc; this.children = []; this.attrs = {}; this.events = {}; this.style = {}; this.value = ''; this.checked = false; this.classList = { add() {} }; }
    append(el) { if (el.parent) el.remove(); this.children.push(el); el.parent = this; }
    replaceChildren() { this.children = []; }
    setAttribute(k, v) { this.attrs[k] = v; }
    getAttribute(k) { return this.attrs[k]; }
    focus() { this.ownerDocument.activeElement = this; }
    addEventListener(k, fn) { const previous = this.events[k]; this.events[k] = event => { previous?.(event); fn(event); }; }
    remove() { this.parent.children = this.parent.children.filter(e => e !== this); }
    get options() { return this.children.filter(e => e.tag === 'option'); }
    click() { if (!this.disabled) return this.onclick?.(); }
    toggle(open) { this.open = open; this.events.toggle?.(); }
}

for (const lang of ['zh', 'en']) for (const operation of ['create', 'update', 'delete', 'enable', 'copy', 'feature']) test(`Skill ${operation} receipt renders across idle/busy/read-only without configuration actions / ${lang}`, () => {
    const doc = { createElement: tag => new Element(tag, doc) }, parent = doc.createElement('section');
    const view = createReceiptView({ doc, parent, controller: {}, act: fn => fn(), lang });
    const receipt = actionReceipt({ id: 'skill-op', artifactId: 'skill-draft', revision: 1, status: 'saved_unconfirmed', content: { module: 'skill', operation }, result: { persistence: 'unconfirmed' } });
    const nodes = () => { const result = []; const visit = el => { result.push(el); el.children.forEach(visit); }; visit(parent); return result; };
    for (const [busy, readOnly] of [[false, false], [true, false], [false, false], [false, true]]) {
        assert.doesNotThrow(() => view.render({ receipts: [receipt], busy, readOnly, enabled: true, canReadConfig: true, canCheckReceipts: { 'skill-op': true } }));
        assert.ok(nodes().some(el => el.tag === 'p' && el.textContent?.includes(lang === 'en' ? 'Skill management:' : '技能管理：')));
        assert.equal(nodes().filter(el => el.tag === 'button').length, 0);
        assert.equal(nodes().filter(el => el.tag === 'pre').length, 0);
    }
});

for (const lang of ['zh', 'en']) test('Legacy and v2 configuration receipts keep exact diffs and guarded actions / ' + lang, async () => {
    for (const version of [undefined, 2]) {
        const doc = { createElement: tag => new Element(tag, doc) }, parent = doc.createElement('section'), calls = [];
        const view = createReceiptView({ doc, parent, lang, act: fn => fn(), controller: { explainReceipt: id => calls.push(['explain', id]), checkReceipt: id => calls.push(['check', id]) } });
        const receipt = { ...(version ? { version } : {}), operationId: 'config-op', artifactId: 'a', revision: 1, at: 1, status: 'applied_unconfirmed', diff: [{ field: 'autoMemoryInterval', before: '10', after: '15' }], saveError: false, changed: false };
        const nodes = () => { const result = []; const visit = el => { result.push(el); el.children.forEach(visit); }; visit(parent); return result; };
        const state = { receipts: [receipt], enabled: true, canReadConfig: true, canCheckReceipts: { 'config-op': true } };
        view.render(state);
        assert.ok(nodes().some(el => el.tag === 'pre' && el.textContent.includes('autoMemoryInterval')));
        const actions = nodes().filter(el => el.tag === 'button'); assert.equal(actions.length, 2);
        await actions[0].click(); await actions[1].click(); assert.deepEqual(calls, [['explain', 'config-op'], ['check', 'config-op']]);
        view.render({ ...state, busy: true }); assert.ok(nodes().filter(el => el.tag === 'button').every(el => el.disabled));
        view.render({ ...state, readOnly: true }); assert.equal(nodes().filter(el => el.tag === 'button').length, 0);
    }
});

for (const lang of ['zh', 'en']) test('Real Skill save updates mounted panel and survives remount without resaving / ' + lang, async () => {
    const settings = {}, events = new EventEmitter(), ctx = { groupId: 'g', chatId: 'A', groups: [{ id: 'g', members: [] }], chat: [], chatMetadata: {}, eventSource: events, eventTypes: { CHAT_CHANGED: 'chat' } };
    let writes = 0;
    const skills = createSkillPort({ getSettings: () => settings, saveSettings: async () => { writes++; }, loadBuiltins: async () => [] });
    const host = createHostBridge({ getContext: () => ctx, getSettings: () => settings, skills, extensionKey: 'gd', pageId: 'skill-panel-regression' });
    const requestJson = JSON.stringify({ operation: 'create', expectedRevision: 0, fields: { name: 'my-skill', description: 'Example procedure', body: 'Read documentation.' } });
    const model = scriptedModel([[{ type: 'tool_call_complete', call: { toolId: 'muyu.skills.preview', callId: 'skill', version: 1, args: { requestJson, apply: true } } }, done], [text('Prepared'), done]]);
    const controller = createMuyuController({ host, createModel: () => model });
    const doc = { createElement: tag => new Element(tag, doc) }, root = doc.createElement('main');
    const nodes = () => { const result = []; const visit = el => { result.push(el); el.children.forEach(visit); }; visit(root); return result; };
    try {
        await controller.configure({ endpoint: 'https://example.invalid/chat/completions', apiKey: 'SYNTHETIC', model: 'fake', thinking: false });
        controller.setMode('assistant'); controller.setFullAccess(true);
        mountMuyuPanel(root, controller, { lang, standalone: true });
        controller.setInput('Create a reusable skill'); controller.send();
        for (let i = 0; i < 20; i++) await flush();
        assert.equal(writes, 1); assert.equal(controller.snapshot().receipts.at(-1).version, 31);
        assert.ok(nodes().some(el => el.tag === 'p' && el.textContent?.includes(lang === 'en' ? 'Skill management:' : '技能管理：')));
        controller.setInput('Next unsent question');
        controller.setFullAccess(false); // Trigger a normal post-save panel update.
        assert.ok(nodes().some(el => el.tag === 'textarea' && el.value === 'Next unsent question'));
        assert.equal(nodes().some(el => el.tag === 'button' && el.textContent === (lang === 'en' ? 'Check current settings' : '核对当前配置')), false);
        assert.equal(typeof root.__gdMuyuDispose, 'function'); root.__gdMuyuDispose();
        assert.doesNotThrow(() => mountMuyuPanel(root, controller, { lang, standalone: true }));
        assert.equal(typeof root.__gdMuyuDispose, 'function'); assert.equal(writes, 1);
        assert.ok(nodes().some(el => el.tag === 'textarea' && el.value === 'Next unsent question'));
        assert.ok(nodes().some(el => el.tag === 'p' && el.textContent?.includes(lang === 'en' ? 'Skill management:' : '技能管理：')));
    } finally { root.__gdMuyuDispose?.(); await controller.dispose(); }
});

function compactSkillsFixture(lang = 'en') {
    const doc = { createElement: tag => new Element(tag, doc) }, settings = doc.createElement('section');
    const draft = { id: 'user:example', revision: 1, name: 'example', displayName: 'Example', description: 'A procedure', body: 'Long instructions', contentVersion: '1', modelInvocable: true, userInvocable: true, resourcesJson: '[]', enabled: true, source: 'user' };
    const state = { skills: { available: true, loaded: true, enabled: true, busy: false, dirty: false, draft, rows: [{ ...draft }, { ...draft, id: 'builtin:other', name: 'other', displayName: 'Other', source: 'builtin', enabled: false }] } };
    const calls = [];
    const controller = { setSkillDraft(fields) { Object.assign(state.skills.draft, fields); state.skills.dirty = true; view.render(state); }, editSkill(id, revision) { calls.push([id, revision]); }, exportSkill: async () => '{"format":"muyu-skill-package"}' };
    const view = createSkillView({ doc, settings, controller, act: fn => fn(), lang }); view.render(state);
    const all = () => { const result = []; const visit = el => { result.push(el); el.children.forEach(visit); }; visit(settings); return result; };
    const find = (tag, text) => all().find(el => el.tag === tag && el.textContent === text);
    return { doc, view, state, calls, controller, all, find };
}

for (const lang of ['zh', 'en']) {
    test('Skill detail navigation preserves drafts, tabs and library filters / ' + lang, async () => {
        const f = compactSkillsFixture(lang);
        const catalog = f.all().find(el => el.className === 'gd-muyu-skill-catalog');
        const editor = f.all().find(el => el.className === 'gd-muyu-skill-editor');
        const search = f.all().find(el => el.type === 'search');
        search.value = 'example'; search.oninput();
        await f.all().find(el => el.className === 'gd-muyu-skill-select').click();
        assert.equal(catalog.hidden, true); assert.equal(editor.hidden, false);
        const body = f.all().find(el => el.tag === 'textarea' && el.value === 'Long instructions');
        body.value = 'Retained draft'; body.oninput();
        const tabs = f.all().filter(el => el.getAttribute('role') === 'tab');
        await tabs[1].click(); assert.equal(tabs[1].getAttribute('aria-selected'), 'true');
        assert.equal(tabs[0].tabIndex, -1); assert.equal(tabs[1].tabIndex, 0);
        let prevented = false;
        tabs[1].onkeydown({ key: 'ArrowLeft', preventDefault() { prevented = true; } });
        assert.equal(prevented, true); assert.equal(f.doc.activeElement, tabs[0]);
        assert.equal(body.value, 'Retained draft');
        await f.find('button', lang === 'en' ? '← Back to Skills' : '← 返回技能列表').click();
        assert.equal(catalog.hidden, false); assert.equal(editor.hidden, true); assert.equal(search.value, 'example');
        const calls = f.calls.length;
        await f.find('button', lang === 'en' ? 'Resume unsaved draft' : '继续未保存编辑').click();
        assert.equal(editor.hidden, false); assert.equal(body.value, 'Retained draft'); assert.equal(f.calls.length, calls);
        assert.ok(f.all().includes(body));
    });
    test('Builtin Skill details use safe read-only text and import is a separate page / ' + lang, async () => {
        const f = compactSkillsFixture(lang);
        f.state.skills.draft = { ...f.state.skills.draft, source: 'builtin', body: '<script>text only</script>' }; f.view.render(f.state);
        const readonly = f.all().find(el => el.className === 'gd-muyu-skill-readonly');
        assert.equal(readonly.hidden, false); assert.equal(readonly.textContent, '<script>text only</script>');
        assert.ok(!f.all().some(el => el.tag === 'script'));
        const save = f.find('button', lang === 'en' ? 'Save Skill' : '保存当前技能');
        assert.equal(save.parent.hidden, true); assert.equal(save.disabled, true);
        assert.equal(f.find('button', lang === 'en' ? 'Delete current Skill' : '删除当前技能').hidden, true);
        await f.find('button', lang === 'en' ? 'Import Skill' : '导入技能').click();
        assert.equal(f.all().find(el => el.className === 'gd-muyu-skill-catalog').hidden, true);
        assert.equal(f.all().find(el => el.className === 'gd-muyu-skill-editor').hidden, true);
        assert.equal(f.doc.activeElement.tag, 'textarea');
    });
    test('Compact Skill library folds long content and filters without replacing draft / ' + lang, () => {
        const f = compactSkillsFixture(lang);
        assert.equal(f.all().find(el => el.getAttribute('data-source') === 'builtin').open, false);
        assert.equal(f.all().find(el => el.getAttribute('data-source') === 'user').open, true);
        const row = f.all().find(el => el.getAttribute('data-skill-id') === 'user:example'); row.open = true;
        const body = f.all().find(el => el.tag === 'textarea' && el.value === 'Long instructions');
        body.value = 'Unsaved body'; body.oninput();
        assert.equal(f.all().find(el => el.getAttribute('data-skill-id') === 'user:example'), row);
        assert.equal(row.open, true); assert.equal(body.value, 'Unsaved body');
        const source = f.all().find(el => el.tag === 'select' && el.parent.textContent === (lang === 'en' ? 'Source' : '来源'));
        source.value = 'builtin'; source.onchange();
        assert.equal(f.all().filter(el => el.className === 'gd-muyu-skill-row').length, 1);
        assert.equal(body.value, 'Unsaved body');
        const search = f.all().find(el => el.type === 'search'); search.value = 'missing'; search.oninput();
        assert.ok(f.find('p', lang === 'en' ? 'No Skills match these filters.' : '没有符合筛选条件的技能。'));
        assert.equal(f.state.skills.draft.body, 'Unsaved body');
        source.value = ''; search.value = 'e'; search.oninput();
        assert.equal(f.all().find(el => el.getAttribute('data-source') === 'builtin').open, true);
        search.value = ''; search.oninput();
        assert.equal(f.all().find(el => el.getAttribute('data-source') === 'builtin').open, false);
    });
    test('Skill reference forms retain focus and reject malformed raw JSON without discarding it / ' + lang, async () => {
        const f = compactSkillsFixture(lang);
        await f.find('button', lang === 'en' ? 'Add reference file' : '添加参考文件').click();
        const input = f.all().find(el => el.tag === 'textarea' && el.parent.textContent === (lang === 'en' ? 'Reference text' : '参考正文'));
        input.focus(); input.value = '<script>Not executed</script>'; input.oninput();
        assert.equal(f.doc.activeElement, input); assert.ok(f.all().includes(input));
        assert.equal(JSON.parse(f.state.skills.draft.resourcesJson)[0].text, input.value);
        const raw = f.all().find(el => el.tag === 'textarea' && el.parent.textContent.includes('[{path,text}]'));
        raw.value = '{broken'; raw.oninput();
        assert.equal(raw.value, '{broken'); assert.equal(f.state.skills.draft.resourcesJson, '{broken');
        assert.equal(f.find('button', lang === 'en' ? 'Save Skill' : '保存当前技能').disabled, true);
        assert.equal(f.find('button', lang === 'en' ? 'Add reference file' : '添加参考文件').disabled, true);
        assert.ok(!f.all().some(el => el.tag === 'script'));
        raw.value = '[]'; raw.oninput(); assert.equal(f.find('button', lang === 'en' ? 'Save Skill' : '保存当前技能').disabled, false);
    });
    test('Skill clean selection is direct; unsaved selection and reload require confirmation / ' + lang, async () => {
        const f = compactSkillsFixture(lang), edit = f.all().find(el => el.className === 'gd-muyu-skill-select');
        await edit.click(); assert.deepEqual(f.calls, [['user:example', 1]]);
        f.state.skills.dirty = true; f.view.render(f.state);
        await f.find('button', lang === 'en' ? 'Reload saved version' : '重载已保存版本').click();
        assert.equal(f.calls.length, 1);
        await f.find('button', lang === 'en' ? 'Confirm' : '确认').click(); assert.equal(f.calls.length, 2);
    });
}

test('Skill export ignores late responses after selection changes and downloads a complete JSON package', async () => {
    const f = compactSkillsFixture(); let resolve;
    f.controller.exportSkill = () => new Promise(r => { resolve = r; });
    const pending = f.find('button', 'Export saved version').click();
    f.state.skills.draft = { ...f.state.skills.draft, id: 'user:other', name: 'other' }; f.view.render(f.state);
    resolve('OLD PACKAGE'); await pending;
    assert.ok(!f.all().some(el => el.value === 'OLD PACKAGE'));
    let created = 0, revoked = 0;
    f.doc.defaultView = { Blob, URL: { createObjectURL(blob) { assert.equal(blob.type, 'application/json;charset=utf-8'); created++; return 'blob:test'; }, revokeObjectURL(url) { assert.equal(url, 'blob:test'); revoked++; } } };
    f.controller.exportSkill = async () => '{"files":[{"path":"SKILL.md","text":"full"}]}';
    await f.find('button', 'Download complete package').click();
    await new Promise(r => setTimeout(r, 10));
    assert.equal(created, 1); assert.equal(revoked, 1); assert.ok(!f.all().some(el => el.tag === 'a'));
});

test('Skill file read cannot overwrite newer pasted import text', async () => {
    const f = compactSkillsFixture(); let resolve;
    const file = f.all().find(el => el.type === 'file'), text = f.all().find(el => el.tag === 'textarea' && el.parent.textContent === 'Paste SKILL.md or complete package JSON');
    file.files = [{ size: 10, text: () => new Promise(r => { resolve = r; }) }];
    const pending = file.onchange(); text.value = 'New pasted text'; text.oninput(); resolve('Old file'); await pending;
    assert.equal(text.value, 'New pasted text');
});

test('Conversation dropdown dismisses outside/Escape and removes document listeners on disposal', () => {
    const listeners = new Map();
    const doc = { createElement: tag => new Element(tag, doc), addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: (type, fn) => { if (listeners.get(type) === fn) listeners.delete(type); } };
    const settings = doc.createElement('section'), chat = doc.createElement('section');
    const view = createHistoryView({ doc, settings, chat, controller: {}, act: fn => fn(), lang: 'en' });
    const menu = chat.children[0].children.find(e => e.className === 'gd-muyu-session-menu');
    const trigger = menu.children[0], list = menu.children[1];
    menu.contains = target => { for (let el = target; el; el = el.parent) if (el === menu) return true; return false; };
    menu.open = true; listeners.get('pointerdown')({ target: list }); assert.equal(menu.open, true);
    listeners.get('pointerdown')({ target: chat }); assert.equal(menu.open, false);
    menu.open = true; let prevented = false;
    listeners.get('keydown')({ key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() {} });
    assert.equal(menu.open, false); assert.equal(prevented, true); assert.equal(doc.activeElement, trigger);
    menu.open = true; view.setVisible(false); assert.equal(menu.open, false);
    menu.open = true; list.events.click({ target: { disabled: false, closest: () => ({}) } }); assert.equal(menu.open, false);
    view.dispose(); assert.equal(listeners.size, 0);
});

test('Permission request stays inside the transcript and disposes its card', () => {
    const doc = { createElement: tag => new Element(tag, doc) };
    doc.body = doc.createElement('body');
    const parent = doc.createElement('div'), settings = doc.createElement('div');
    const view = createPermissionView({ doc, parent, settings, controller: {}, act: fn => fn(), lang: 'en' });
    const card = parent.children[0];
    assert.equal(card.className, 'gd-muyu-interaction gd-muyu-permission');
    assert.equal(card.getAttribute('role'), 'group');
    assert.equal(doc.body.children.length, 0);
    view.render({ interaction: { id: 'read-1', kind: 'permission', source: 'chatHistory', reason: 'Inspect chat', status: 'pending' }, connection: { model: 'test', endpoint: 'https://example.test' } });
    assert.equal(card.hidden, false);
    view.render({ interaction: null });
    assert.equal(card.hidden, true);
    view.dispose();
    assert.equal(parent.children.includes(card), false);
});

test('Real script consent shows host-bound source as text and offers no persistent grant', () => {
    const doc = { createElement: tag => new Element(tag, doc) }, parent = doc.createElement('div'), settings = doc.createElement('div');
    const controller = { scriptExecutionDetails: () => ({ name: 'user script', stage: 'message', messageIndex: 2, definition: { code: '<script>not HTML</script>' } }) };
    const view = createPermissionView({ doc, parent, settings, controller, act: fn => fn(), lang: 'en' });
    view.render({ interaction: { id: 'r', kind: 'permission', source: 'scriptExecution', executionId: 'ticket', status: 'pending', reason: 'run' } });
    const card = parent.children[0], details = card.children.find(row => row.tag === 'details'), buttons = card.children.find(row => row.className === 'gd-muyu-actions').children;
    assert.equal(details.hidden, false); assert.match(details.children.find(row => row.tag === 'pre').textContent, /<script>not HTML<\/script>/);
    assert.match(details.children.find(row => row.tag === 'pre').textContent, /messageIndex/); assert.equal(buttons[1].hidden, true);
    view.render({ interaction: null }); assert.equal(details.hidden, true);
});

for (const lang of ['zh', 'en']) test(`Long-term memory editor survives view rebuilds and deletes only after explicit confirmation (${lang})`, async () => {
    const f = fixture(lang, true, { initialMode: 'assistant' });
    const state = f.state.agentMemory = { available: true, enabled: false, loaded: true, busy: false, error: null, stale: false,
        rows: [{ id: 'note', revision: 1, title: '<script>unsafe</script>', content: 'text', scope: 'chat' }],
        draft: { id: null, revision: null, title: '', content: '', scope: 'chat' } };
    let saved = 0, deleted = 0;
    f.controller.setAgentMemoryDraft = fields => { Object.assign(state.draft, fields); f.emit(); };
    f.controller.saveAgentMemory = () => { saved++; };
    f.controller.removeAgentMemory = (id, revision) => { assert.equal(id, 'note'); assert.equal(revision, 1); deleted++; state.rows = []; f.emit(); };
    f.controller.setAgentMemoryEnabled = value => { state.enabled = value; f.emit(); };
    f.controller.newAgentMemory = () => { state.draft = { id: null, revision: null, title: '', content: '', scope: 'chat' }; state.stale = false; f.emit(); };
    f.emit();
    const title = f.all().find(e => e.tag === 'input' && e.parent.textContent === (lang === 'en' ? 'Title' : '标题'));
    const content = f.all().find(e => e.tag === 'textarea' && e.parent.textContent === (lang === 'en' ? 'Content' : '记忆正文'));
    title.value = 'preference'; title.oninput(); content.value = 'my draft'; content.oninput();
    f.mount();
    assert.equal(f.all().find(e => e.tag === 'textarea' && e.parent.textContent === (lang === 'en' ? 'Content' : '记忆正文')).value, 'my draft');
    assert.ok(f.all().some(e => e.tag === 'span' && e.textContent.includes('<script>unsafe</script>')));
    await f.find('button', lang === 'en' ? 'Save this note' : '保存这条记忆').click(); assert.equal(saved, 1);
    state.stale = true; f.emit(); assert.equal(f.find('button', lang === 'en' ? 'Save this note' : '保存这条记忆').disabled, true);
    await f.find('button', lang === 'en' ? 'Delete' : '删除').click(); assert.equal(deleted, 0);
    await f.find('button', lang === 'en' ? 'Confirm delete' : '确认删除').click(); assert.equal(deleted, 1);
    assert.equal(f.sent.length, 0); f.root.__gdMuyuDispose();
});

test('Switched chat disables compaction and explains how to resume; migration/recovery notices stay actionable', async () => {
    const f = fixture('en', true, { initialMode: 'assistant' }); f.state.enabled = true;
    f.state.history = { available: true, enabled: true, loading: false, pending: 0, error: null, sessionId: 'old', sessions: [], missingPermissions: [], migration: { pending: 1, reason: 'HISTORY_CAPACITY' } };
    f.state.switchedChat = true; f.emit();
    let calls = 0; f.controller.compactHistory = () => { calls++; };
    const compact = f.find('button', 'Summarize history now'); assert.equal(compact.disabled, true);
    await compact.click(); assert.equal(calls, 0);
    assert.ok(f.all().some(e => !e.hidden && /original chat to summarize/.test(e.textContent)));
    const status = f.all().find(e => e.tag === 'small' && e.attrs.role === 'status');
    assert.match(status.textContent, /await migration/); assert.match(status.textContent, /refresh history to retry/);
    f.state.switchedChat = false; f.state.history.recovery = true; f.state.history.error = 'HISTORY_CAPACITY'; f.emit();
    assert.equal(compact.disabled, false); assert.match(status.textContent, /unsaved/); assert.match(status.textContent, /not an importable session/);
    f.root.__gdMuyuDispose();
});

for (const lang of ['zh', 'en']) test(`Coverage UI distinguishes a blocked plan from the previous task and preserves input (${lang})`, () => {
    const f = fixture(lang, true, { initialMode: 'assistant' });
    f.state.input = 'unsent draft';
    f.state.context = { coverage: { state: 'blocked', total: 12, summarized: 4, raw: 0, omitted: 8, excluded: 0 }, turns: 0, omitted: 8, summary: 'reference' };
    f.state.runs = [{ process: { coverage: { status: 'blocked' }, summaryPhase: 'summary_failed', summaryError: 'MODEL_OUTPUT_TRUNCATED', summaryUsage: { calls: 2, reports: 1, inputTokens: 20, outputTokens: 10 } } }];
    f.emit();
    const content = () => f.all().map(e => e.textContent || '').join('\n');
    assert.match(content(), /4\/0\/8\/0/); assert.match(content(), lang === 'en' ? /full unsummarized tail cannot fit/ : /未摘要原文无法完整携带/);
    assert.match(content(), /MODEL_OUTPUT_TRUNCATED/); assert.match(content(), /1\/2/);
    assert.equal(f.state.input, 'unsent draft');
    f.state.context.coverage = { state: 'complete', total: 12, summarized: 4, raw: 8, omitted: 0, excluded: 0 }; f.emit();
    assert.match(content(), lang === 'en' ? /carried contiguously/ : /原文连续携带/);
    assert.ok(f.all().some(e => e.getAttribute('aria-live') === 'polite'));
    f.root.__gdMuyuDispose();
});
for (const lang of ['zh', 'en']) test(`Account history storage option explains limits and defers backend switching (${lang})`, () => {
    const f = fixture(lang, true, { initialMode: 'assistant' });
    f.state.history = { available: true, enabled: true, canChooseStorage: true, accountStorage: false, backend: 'browser', sessions: [] };
    f.emit();
    const option = f.all().find(e => e.type === 'checkbox' && /账户设置|account settings/.test(e.parent.textContent || ''));
    assert.ok(option); assert.equal(option.checked, false); assert.equal(!!option.disabled, false);
    const content = () => f.all().map(e => e.textContent || '').join('\n');
    assert.match(content(), /settings.json/); assert.match(content(), /32 MiB/);
    assert.match(content(), lang === 'en' ? /another tab.*overwrite/ : /其他标签页.*覆盖/);
    option.checked = true; option.onchange();
    assert.equal(f.state.history.accountStorage, true); assert.equal(f.state.history.backend, 'browser');
    assert.match(content(), lang === 'en' ? /reload to switch/ : /刷新后生效/);
    f.state.busy = true; f.emit(); assert.equal(option.disabled, true);
    f.root.__gdMuyuDispose();
});

function fixture(lang = 'zh', standalone = false, options = {}) {
    const doc = { createElement: tag => new Element(tag, doc) }, root = doc.createElement('div');
    const state = { viewToken: 1, enabled: false, mode: options.initialMode || 'memory', input: '', hasChat: true, messages: [], runs: [], artifacts: [] };
    const listeners = new Set(), sent = [], configs = []; let stops = 0;
    const emit = () => { for (const fn of listeners) fn(); };
    const controller = {
        snapshot: () => structuredClone(state), subscribe(fn) { listeners.add(fn); return { unsubscribe: () => listeners.delete(fn) }; },
        setMode(mode) { state.mode = mode; state.viewToken++; emit(); }, setInput(input) { state.input = input; },
        send(options = {}) { if (!options.consent && !state.permissions?.diagnostics && !state.permissions?.chat && !state.permissions?.chatDecided) throw new Error('CONSENT_REQUIRED'); sent.push(options); state.input = ''; state.busy = true; emit(); },
        grantPermission(kind) { state.permissions ||= {}; state.permissions[kind] = true; emit(); },
        revokePermission(kind) { state.permissions[kind] = false; state.messages = []; emit(); },
        forgetCredential() { state.savedConnection = null; emit(); },
        saveRunConfig(value) { state.runConfig = structuredClone(value); emit(); },
        newSession() { state.history.sessionId = 'new'; state.history.sessions.push({ id: 'new', title: '' }); state.messages = []; state.input = ''; state.viewToken++; emit(); },
        selectSession(id) { state.history.sessionId = id; state.viewToken++; emit(); },
        openSession(id) { state.history.sessionId = id; state.viewToken++; emit(); },
        setHistoryFilters(value) { state.history.filters = { range: 'current', archive: 'active', task: '', query: '', ...state.history.filters, ...value }; emit(); },
        renameSession(id, title) { state.history.selected.title = title; state.history.sessions.find(s => s.id === id).title = title; emit(); },
        archiveSession(id, value) { state.history.selected.archived = value; state.readOnly = value; emit(); },
        deleteSession(id) { state.history.sessions = state.history.sessions.filter(s => s.id !== id); state.history.sessionId = ''; emit(); },
        setHistoryEnabled(value) { state.history.enabled = value; emit(); }, retryHistory() { state.history.error = null; emit(); },
        setHistoryAccountStorage(value) { state.history.accountStorage = value; emit(); },
        configure(config) { configs.push(config); state.enabled = true; emit(); }, disable() { state.enabled = false; emit(); }, stop() { stops++; state.busy = false; emit(); },
        setFullAccess(enabled) { state.fullAccess = enabled; emit(); },
    };
    const all = (el = root) => [el, ...el.children.flatMap(e => all(e))];
    // A settings editor now also uses textarea; existing interaction cases target the composer.
    const find = (tag, label) => all().find(e => e.tag === tag && (label === undefined || e.textContent === label) && (tag !== 'textarea' || label !== undefined || ['给暮羽的消息', 'Message to Muyu'].includes(e.parent?.textContent)));
    const mount = () => mountMuyuPanel(root, controller, { lang, standalone, ...options });
    mount(); return { root, state, controller, listeners, sent, configs, emit, find, all, mount, stops: () => stops };
}

for (const failed of [false, true]) test('ST probe cancelled by connection save unlocks after success or failure / ' + failed, async () => {
    const f = fixture('en', true, { initialMode: 'assistant' });
    const source = f.all().find(e => e.tag === 'select' && e.parent.textContent === 'Connection source');
    source.value = 'st'; source.events.change?.();
    f.controller.probeConnection = (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }));
    let finish;
    f.controller.configure = () => new Promise((resolve, reject) => {
        f.state.resetting = true; f.emit();
        finish = () => { f.state.resetting = false; f.state.enabled = !failed; f.emit(); if (failed) reject(Error('save failed')); else resolve(); };
    });
    const button = f.find('button', 'Test ST connection');
    const testing = button.click(); assert.equal(button.disabled, true);
    const enabling = f.find('button', 'Enable connection').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(button.disabled, true, 'saving still locks probing');
    finish(); await enabling; await testing; f.emit();
    assert.equal(button.disabled, false, 'transient probe lock must not survive saving');
    let probes = 0; f.controller.probeConnection = async () => { probes++; };
    await button.click(); assert.equal(probes, 1); assert.equal(button.disabled, false);
    assert.equal(f.sent.length, 0); f.root.__gdMuyuDispose();
});

for (const lang of ['zh', 'en']) test('ST source hides independent setup and activates without copying a key / ' + lang, async () => {
    const f = fixture(lang, true, { initialMode: 'assistant' });
    f.state.hostConnection = { available: true, provider: 'custom', model: 'ST model', endpoint: 'https://host.test/v1' }; f.emit();
    const source = f.all().find(e => e.tag === 'select' && e.parent.textContent === (lang === 'en' ? 'Connection source' : '连接来源'));
    const key = f.all().find(e => e.type === 'password'); key.value = 'UNSENT_PRIVATE_KEY';
    source.value = 'st'; source.events.change?.();
    const profile = f.all().find(e => e.tag === 'select' && e.parent.textContent === (lang === 'en' ? 'API protocol' : '接口协议'));
    assert.equal(profile.parent.parent.hidden, true);
    assert.ok(f.all().some(e => /ST model/.test(e.textContent)));
    await f.find('button', lang === 'en' ? 'Enable connection' : '启用此连接').click();
    assert.deepEqual(f.configs, [{ source: 'st' }]); assert.equal(key.value, ''); assert.equal(f.sent.length, 0);
    let probes = 0; f.controller.probeConnection = async config => { assert.deepEqual(config, { source: 'st' }); probes++; };
    await f.find('button', lang === 'en' ? 'Test ST connection' : '测试酒馆连接').click();
    assert.equal(probes, 1); assert.equal(f.configs.length, 1);
    assert.ok(f.all().some(e => /工具调用兼容性尚未验证|tool-call compatibility is not yet verified/.test(e.textContent)));
    f.root.__gdMuyuDispose();
});

test('Full-access switch confirms once and keeps a warning visible outside settings', async () => {
    const f = fixture('en', true, { initialMode: 'assistant' });
    f.state.enabled = true; f.emit();
    const toggle = f.all().find(e => e.tag === 'input' && e.parent?.textContent?.includes('Full-access mode'));
    assert.ok(toggle); assert.equal(toggle.checked, false);
    toggle.checked = true; toggle.onchange(); assert.equal(f.state.fullAccess, undefined); assert.equal(toggle.checked, false);
    assert.equal(f.all().find(e => e.className === 'gd-muyu-danger-confirm').hidden, false);
    await f.find('button', 'Keep disabled').click(); assert.equal(f.state.fullAccess, undefined);
    toggle.checked = true; toggle.onchange(); await f.find('button', 'I understand the risk, enable').click(); assert.equal(f.state.fullAccess, true);
    const warning = f.all().find(e => e.className === 'gd-muyu-full-access-warning');
    assert.equal(warning.hidden, false); assert.equal(warning.parent.className, 'gd-muyu-chat');
    toggle.checked = false; toggle.onchange(); assert.equal(f.state.fullAccess, false); assert.equal(warning.hidden, true);
    f.root.__gdMuyuDispose();
});

test('Expired history authorization is visible beside the composer and preserves drafts without auto-sending', async () => {
    const f = fixture('en', true, { initialMode: 'assistant' });
    f.state.enabled = true; f.state.input = 'keep this draft';
    f.state.history = { loading: false, missingPermissions: ['source:variables'], sessions: [] };
    let approvals = 0;
    f.controller.allowHistory = () => { approvals++; f.state.history.missingPermissions = []; f.emit(); };
    f.emit();
    const approve = f.find('button', 'Allow existing history');
    assert.equal(approve.parent.parent.hidden, false);
    assert.equal(approve.parent.parent.parent.className, 'gd-muyu-composer');
    await approve.click();
    assert.equal(approvals, 1); assert.equal(f.sent.length, 0);
    assert.equal(f.state.input, 'keep this draft'); assert.equal(approve.parent.parent.hidden, true);
    f.root.__gdMuyuDispose();
});

test('Context failure process displays its safe code and distinguishes input from output tokens', () => {
    const f = fixture('en', true, { initialMode: 'assistant' });
    f.state.messages = [{ role: 'user', runId: 'r', content: 'inspect' }];
    f.state.runs = [{ id: 'r', process: { phase: 'failed', terminal: 'failed', cleaned: true, error: 'CONTEXT_LIMIT', rows: [{ type: 'model.failed', attemptId: 2, durationMs: 17, error: 'CONTEXT_LIMIT' }] } }];
    f.emit();
    const content = f.all().map(e => e.textContent).join('\n');
    assert.match(content, /CONTEXT_LIMIT/); assert.match(content, /input context budget, not output tokens/);
    f.root.__gdMuyuDispose();
});

for (const lang of ['zh', 'en']) test(`Connection card separates basic and advanced options without connecting (${lang})`, async () => {
    const f = fixture(lang, true, { initialMode: 'assistant' }), calls = [];
    const protocol = f.all().find(e => e.tag === 'select' && e.parent.textContent === (lang === 'en' ? 'API protocol' : '接口协议'));
    const advanced = f.all().find(e => e.className === 'gd-muyu-connection-advanced');
    const thinking = f.all().find(e => e.type === 'checkbox' && /DeepSeek/.test(e.parent.textContent));
    const effort = f.all().find(e => e.tag === 'select' && /reasoning effort|思考强度/.test(e.parent.textContent));
    const endpoint = f.all().find(e => e.type === 'url'), key = f.all().find(e => e.type === 'password');
    assert.equal(!!advanced.open, false); assert.equal(key.autocomplete, 'off');
    endpoint.value = 'https://example.test/v1/chat/completions'; key.value = 'PRIVATE_TEST_KEY';
    protocol.value = 'chat-completions'; protocol.events.change();
    assert.equal(thinking.disabled, true); assert.equal(effort.disabled, true);
    assert.equal(endpoint.value, 'https://example.test/v1/chat/completions'); assert.equal(key.value, 'PRIVATE_TEST_KEY');
    assert.equal(f.configs.length, 0); assert.equal(f.sent.length, 0);
    f.controller.probeConnection = async config => { calls.push(config); return { ok: true }; };
    await f.find('button', lang === 'en' ? 'Test connection' : '测试连接').click();
    assert.equal(calls[0].profile, 'chat-completions'); assert.equal(calls[0].thinking, false);
    await f.find('button', lang === 'en' ? 'Enable connection' : '启用此连接').click();
    assert.equal(f.configs[0].profile, 'chat-completions'); assert.equal(f.configs[0].thinking, false); assert.equal(key.value, '');
    protocol.value = 'deepseek'; protocol.events.change(); effort.value = 'max';
    key.value = 'PRIVATE_TEST_KEY';
    assert.equal(thinking.disabled, false); assert.equal(effort.disabled, false);
    await f.find('button', lang === 'en' ? 'Test connection' : '测试连接').click();
    assert.equal(calls[1].thinking, true); assert.equal(calls[1].reasoningEffort, 'max');
    f.root.__gdMuyuDispose();
});

test('Changing protocol aborts model discovery and ignores its late reply', async () => {
    const f = fixture('en', true, { initialMode: 'assistant' }); let resolve, signal;
    f.all().find(e => e.type === 'password').value = 'PRIVATE_TEST_KEY';
    f.controller.probeConnection = (_config, options) => { signal = options.signal; return new Promise(r => { resolve = r; }); };
    const pending = f.find('button', 'Fetch models').click();
    const protocol = f.all().find(e => e.tag === 'select' && e.parent.textContent === 'API protocol');
    protocol.value = 'chat-completions'; protocol.events.change(); assert.equal(signal.aborted, true);
    resolve(['obsolete-model']); await pending;
    const menu = f.all().find(e => e.tag === 'select' && /Model menu/.test(e.parent.textContent));
    assert.deepEqual(menu.options.map(o => o.value), ['']); assert.equal(f.find('button', 'Fetch models').disabled, false);
    f.root.__gdMuyuDispose();
});

for (const lang of ['zh', 'en']) test(`Budget failure preserves input, prevents duplicate saves and allows retry (${lang})`, async () => {
    const f = fixture(lang, true, { initialMode: 'assistant' });
    const field = f.all().find(e => e.type === 'number' && e.parent.textContent === (lang === 'en' ? 'Model calls' : '模型调用次数'));
    const save = f.find('button', lang === 'en' ? 'Save execution budgets' : '保存运行预算');
    const status = f.all().find(e => e.className === 'gd-muyu-form-status' && e.parent === save.parent);
    let calls = 0, reject;
    f.controller.saveRunConfig = () => { calls++; return new Promise((_resolve, fail) => { reject = fail; }); };
    field.value = '7'; field.events.input(); assert.match(status.textContent, /未保存|Unsaved/);
    const pending = save.click(); await save.click(); assert.equal(calls, 1); assert.equal(field.disabled, true);
    f.emit(); assert.equal(field.value, '7'); assert.equal(field.disabled, true);
    reject(Error('RUN_CONFIG_SAVE_FAILED')); await pending;
    assert.equal(field.value, '7'); assert.equal(field.disabled, false); assert.match(status.textContent, /保留|retained/);
    f.controller.saveRunConfig = value => { calls++; f.state.runConfig = value; f.emit(); };
    await save.click(); assert.equal(calls, 2); assert.match(status.textContent, /下次任务|next task/);
    field.value = '0'; field.events.input(); await save.click(); assert.equal(calls, 2);
    assert.equal(field.getAttribute('aria-invalid'), 'true'); assert.equal(field.ownerDocument.activeElement, field);
    f.root.__gdMuyuDispose();
});

test('Context errors expand the summary section; failed defaults preserve unsaved fields', async () => {
    const f = fixture('en', true, { initialMode: 'assistant' });
    const summary = f.all().find(e => e.type === 'number' && e.parent.textContent === 'Summary output budget (tokens)');
    const advanced = f.find('summary', 'History summarization and budget').parent;
    const auto = f.all().find(e => e.type === 'checkbox' && e.parent.textContent.startsWith('Auto-summarize on send'));
    assert.notEqual(auto.parent.parent, advanced); assert.equal(!!advanced.open, false);
    let calls = 0; f.controller.saveContextConfig = () => { calls++; throw Error('CONTEXT_CONFIG_SAVE_FAILED'); };
    summary.value = ''; summary.events.input(); await f.find('button', 'Save context settings').click();
    assert.equal(calls, 0); assert.equal(advanced.open, true); assert.equal(summary.ownerDocument.activeElement, summary);
    summary.value = '12000'; summary.events.input();
    await f.find('button', 'Restore and save default context budget').click();
    assert.equal(calls, 1); assert.equal(summary.value, '12000'); f.emit(); assert.equal(summary.value, '12000');
    f.root.__gdMuyuDispose();
});

test('Connection validation is local and test results do not replace the active connection', async () => {
    const f = fixture('en', true, { initialMode: 'assistant' }); let probes = 0;
    f.state.enabled = true; f.state.connection = { endpoint: 'https://old.test/chat/completions', model: 'active-model', profile: 'deepseek', thinking: true }; f.emit();
    f.controller.probeConnection = async () => { probes++; return { ok: true }; };
    const endpoint = f.all().find(e => e.type === 'url'), key = f.all().find(e => e.type === 'password');
    const status = f.all().find(e => e.className === 'gd-muyu-active-connection');
    endpoint.value = 'not a URL'; endpoint.events.input();
    await f.find('button', 'Enable connection').click(); assert.equal(f.configs.length, 0); assert.equal(endpoint.getAttribute('aria-invalid'), 'true');
    endpoint.value = 'https://new.test/chat/completions'; endpoint.events.input();
    await f.find('button', 'Test connection').click(); assert.equal(probes, 0); assert.equal(key.getAttribute('aria-invalid'), 'true');
    key.value = 'PRIVATE_TEST_KEY'; key.events.input(); await f.find('button', 'Test connection').click();
    assert.equal(probes, 1); assert.match(status.textContent, /old.test/); assert.equal(f.configs.length, 0);
    assert.ok(f.all().some(e => e.className === 'gd-muyu-form-status' && /not active/.test(e.textContent)));
    assert.ok(!f.all().some(e => /PRIVATE_TEST_KEY/.test(e.textContent || '')));
    f.root.__gdMuyuDispose();
});

test('Search locking uses the latest state after completion, failure, cancellation and saving', async () => {
    const f = fixture('en', true, { initialMode: 'assistant' });
    const save = f.find('button', 'Update search key'), forget = f.find('button', 'Forget search key');
    const key = f.all().find(e => e.type === 'password' && e.parent.textContent === 'Brave Search API key');
    f.state.webSearch = { maxSearches: 3, maxResults: 5, resultBytes: 12000, hasKey: false };
    for (const terminal of ['succeeded', 'failed', 'cancelled']) {
        f.state.busy = true; f.emit(); assert.equal(save.disabled, true); assert.equal(key.disabled, true);
        f.state.busy = false; f.state.runs = [{ status: terminal }]; f.emit();
        assert.equal(save.disabled, false); assert.equal(key.disabled, false); assert.equal(forget.disabled, true);
    }
    let finish, calls = 0;
    f.controller.saveWebSearchConfig = () => { calls++; return new Promise(resolve => { finish = () => { f.state.webSearch.hasKey = true; f.emit(); resolve(); }; }); };
    key.value = 'SYNTHETIC'; key.events.input();
    const pending = save.click(); assert.equal(save.disabled, true); await save.click(); assert.equal(calls, 1);
    f.emit(); assert.equal(save.disabled, true);
    finish(); await pending;
    assert.equal(save.disabled, false); assert.equal(forget.disabled, false);
    f.state.webSearch.saving = true; f.emit(); assert.equal(save.disabled, true);
    f.state.webSearch.saving = false; f.state.webSearch.hasKey = false; f.emit();
    assert.equal(save.disabled, false); assert.equal(forget.disabled, true);
    f.root.__gdMuyuDispose();
});

test('Search field validation expands limits and failed saving retains the key and numeric draft', async () => {
    const f = fixture('en', true, { initialMode: 'assistant' }); let calls = 0;
    const attempts = f.all().find(e => e.type === 'number' && e.parent.textContent === 'Search attempts per task');
    const key = f.all().find(e => e.type === 'password' && e.parent.textContent === 'Brave Search API key');
    const save = f.find('button', 'Update search key');
    f.controller.saveWebSearchConfig = async () => { calls++; throw Error('WEB_CONFIG_SAVE_FAILED'); };
    attempts.value = '0'; attempts.events.input(); await save.click(); assert.equal(calls, 0);
    assert.equal(f.find('summary', 'Search limits and data budget').parent.open, true);
    attempts.value = '2'; attempts.events.input(); key.value = 'PRIVATE_SEARCH_KEY'; key.events.input();
    await save.click(); assert.equal(calls, 1); assert.equal(key.value, 'PRIVATE_SEARCH_KEY'); assert.equal(attempts.value, '2');
    f.emit(); assert.equal(attempts.value, '2'); f.root.__gdMuyuDispose();
});

test('AI connection controls explicitly test, list and select models without changing the connection', async () => {
    const f = fixture('en', true, { initialMode: 'assistant' }), calls = [];
    f.controller.probeConnection = async (config, options) => { calls.push({ config, kind: options.kind }); return options.kind === 'models' ? ['flash', 'pro'] : { ok: true }; };
    const key = f.all().find(e => e.tag === 'input' && e.type === 'password');
    key.value = 'PRIVATE_TEST_KEY';
    assert.equal(calls.length, 0);
    await f.find('button', 'Fetch models').click();
    assert.equal(calls.length, 1); assert.equal(calls[0].kind, 'models');
    const select = f.all().find(e => e.tag === 'select' && e.parent?.textContent?.includes('Model menu'));
    assert.ok(select); assert.deepEqual(select.options.map(option => option.value), ['', 'flash', 'pro']);
    select.value = 'pro'; select.onchange();
    const model = f.all().find(e => e.tag === 'input' && e.parent?.textContent === 'Model');
    assert.equal(model.value, 'pro');
    await f.find('button', 'Test connection').click();
    assert.equal(calls[1].kind, 'test'); assert.equal(calls[1].config.model, 'pro');
    assert.equal(f.configs.length, 0); assert.equal(f.state.enabled, false);
    f.root.__gdMuyuDispose();
});

for (const lang of ['zh', 'en']) test(`Globe setup preserves the composer; toggle survives remount and turns off during a task (${lang})`, async () => {
    const f = fixture(lang, true, { initialMode: 'assistant' }); let toggles = 0;
    f.state.enabled = true; f.state.webSearch = { enabled: false, hasKey: false, maxSearches: 3, maxResults: 5, resultBytes: 12000, backend: 'unknown' };
    f.controller.setWebSearchEnabled = enabled => { toggles++; f.state.webSearch.enabled = enabled; f.emit(); };
    f.find('textarea').value = 'unsent draft'; f.find('textarea').oninput(); f.emit();
    let globe = f.all().find(e => e.className?.includes('gd-muyu-web-toggle'));
    await globe.click(); assert.equal(f.sent.length, 0); assert.equal(toggles, 0); assert.equal(f.state.input, 'unsent draft');
    assert.equal(f.all().find(e => e.className === 'gd-muyu-settings').hidden, false);
    f.state.webSearch.hasKey = true; f.emit(); await globe.click();
    assert.equal(toggles, 1); assert.equal(globe.getAttribute('aria-pressed'), 'true');
    f.root.__gdMuyuDispose(); f.mount(); globe = f.all().find(e => e.className?.includes('gd-muyu-web-toggle'));
    assert.equal(globe.getAttribute('aria-pressed'), 'true'); assert.equal(toggles, 1);
    f.state.busy = true; f.emit(); assert.equal(globe.disabled, false); await globe.click();
    assert.equal(f.state.webSearch.enabled, false); assert.equal(toggles, 2); assert.equal(globe.disabled, true);
    assert.equal(f.state.input, 'unsent draft'); f.root.__gdMuyuDispose();
});

function managedHistory() {
    return { available: true, enabled: true, loading: false, pending: 0, error: null, dirty: false, sessionId: 'old', persisted: true,
        selected: { id: 'old', title: 'Title', archived: false }, sessions: [{ id: 'old', title: 'Title' }], missingPermissions: [], omitted: 0 };
}

test('Task plan card distinguishes unavailable writes and offers one explicit read decision', async () => {
    const f = fixture('en', true, { initialMode: 'assistant' });
    let approvals = 0, declines = 0;
    f.state.artifacts = [{ id: 'plan-1', revision: 1, kind: 'task-plan', content: { plan: {
        goal: 'Create a coin system', sources: ['configSettings', 'variables'], unknowns: ['Existing balance?'],
        steps: [{ kind: 'read', title: 'Inspect', detail: 'Read settings', availability: 'read-only' },
            { kind: 'variables', title: 'Create balance', detail: 'Needs a write port', availability: 'not-available' }],
    } } }];
    f.controller.approveTaskPlanReads = () => { approvals++; f.state.approvedPlans = ['plan-1']; f.emit(); };
    f.controller.declineTaskPlanReads = () => { declines++; f.state.declinedPlans = ['plan-1']; f.emit(); };
    f.emit();
    assert.ok(f.all().some(e => e.textContent?.includes('Create balance · Not available yet')));
    assert.ok(f.all().some(e => e.textContent?.includes('not any write')));
    await f.find('button', 'Decline reads').click();
    assert.equal(declines, 1); assert.equal(approvals, 0);
    assert.equal(f.find('button', 'Approve plan and start reading'), undefined);
    f.state.declinedPlans = []; f.emit();
    await f.find('button', 'Approve plan and start reading').click();
    assert.equal(approvals, 1); assert.equal(f.find('button', 'Decline reads'), undefined);
    f.root.__gdMuyuDispose();
});

for (const lang of ['zh', 'en']) test(`Diagnostic reports stay beside the original reply and preserve explicit expansion (${lang})`, () => {
    const f = fixture(lang, true, { initialMode: 'assistant' });
    f.state.messages = [{ role: 'assistant', content: 'Diagnosis complete', runId: 'diagnosis' }, { role: 'user', content: 'Next question', runId: 'later' }];
    f.state.artifacts = [{ id: 'report:1', kind: 'report', revision: 1, sourceRunId: 'diagnosis', content: { module: 'director', findings: [{ kind: 'fact', code: 'CURRENT_MODE', text: 'llm' }] } }];
    f.emit(); const report = () => f.all().find(e => e.className === 'gd-muyu-card gd-muyu-report');
    const history = f.all().find(e => e.className === 'gd-muyu-history');
    assert.equal(report().tag, 'details'); assert.equal(report().open, false);
    const body = report().children.find(e => e.tag === 'div');
    const finding = body.children.find(e => e.tag === 'p');
    assert.match(finding.textContent, lang === 'en' ? /Confirmed/ : /已确认/);
    assert.doesNotMatch(finding.textContent, /CURRENT_MODE|fact/);
    const technical = body.children.find(e => e.tag === 'details');
    assert.ok(!technical.open);
    assert.match(technical.children.find(e => e.tag === 'pre').textContent, /CURRENT_MODE/);
    assert.equal(report().parent.parent, history);
    const anchor = report().parent; const later = history.children.find(e => e.className === 'gd-muyu-message gd-muyu-user');
    assert.ok(history.children.indexOf(anchor) < history.children.indexOf(later));
    report().toggle(true); const old = report(); f.emit(); assert.equal(report().open, true);
    old.toggle(false); f.emit(); assert.equal(report().open, true); // detached toggle cannot change the new card
    f.state.messages.push({ role: 'assistant', content: 'Later response', runId: 'later' }); f.emit();
    assert.equal(report().open, true); assert.equal(report().parent.parent, history);
    f.state.artifacts[0].revision = 2; f.emit(); assert.equal(report().open, false);
    f.state.artifacts[0].sourceRunId = 'missing'; f.emit();
    assert.equal(report().parent, history.children[0]); assert.equal(report().open, false);
    assert.equal(f.sent.length, 0); f.root.__gdMuyuDispose();
});

test('Task plans stay with their originating reply, collapse after review and retain manual expansion', () => {
    const f = fixture('en', true, { initialMode: 'assistant' });
    f.state.messages = [{ role: 'user', content: 'Inspect settings', runId: 'r-plan' },
        { role: 'assistant', content: 'Plan ready', runId: 'r-plan' },
        { role: 'user', content: 'Continue', runId: 'r-next' },
        { role: 'assistant', content: 'Analysis finished', runId: 'r-next' }];
    f.state.artifacts = [{ id: 'plan-position', sourceRunId: 'r-plan', revision: 1, kind: 'task-plan', content: { plan: {
        goal: 'Inspect global settings', sources: ['configSettings'], unknowns: [], steps: [],
    } } }];
    const plan = () => f.all().find(e => e.className === 'gd-muyu-card gd-muyu-plan');
    f.emit();
    const first = plan(); assert.equal(first.tag, 'details'); assert.equal(first.open, true);
    const order = f.all();
    assert.ok(order.indexOf(first) > order.findIndex(e => e.textContent === 'Plan ready'));
    assert.ok(order.indexOf(first) < order.findIndex(e => e.textContent === 'Analysis finished'));
    first.toggle(false); f.emit(); assert.equal(plan().open, false);
    f.state.approvedPlans = ['plan-position']; f.emit(); assert.equal(plan().open, false);
    plan().toggle(true); f.emit(); assert.equal(plan().open, true);
    // A removed card can receive a queued native toggle; it cannot change the new card.
    first.toggle(false); f.emit(); assert.equal(plan().open, true);
    assert.equal(f.all().filter(e => e.className === 'gd-muyu-card gd-muyu-plan').length, 1);
    assert.ok(f.all().some(e => e.textContent?.includes('proposal at planning time')));
    f.root.__gdMuyuDispose();
});

test('Generated profile card is save-only and needs a separate confirmation', async () => {
    const f = fixture('en', true, { initialMode: 'assistant' }); let writes = 0;
    f.state.canSaveProfile = true;
    f.state.artifacts = [{ id: 'profile-1', revision: 1, kind: 'profile-draft', content: {
        name: 'Two speakers', description: 'Group pacing', settings: { mode: 'formula', topN: 2 }, warnings: [],
    } }];
    f.controller.prepareProfileSave = () => { f.state.profileActions = [{ id: 'save-1', artifactId: 'profile-1', revision: 1, status: 'pending' }]; f.emit(); };
    f.controller.approveProfileSave = () => { writes++; f.state.profileActions[0].status = 'saved_confirmed'; f.emit(); };
    f.emit();
    assert.ok(f.all().some(e => e.textContent?.includes('Saving does not change active settings')));
    await f.find('button', 'Review and save to My Profiles').click(); assert.equal(writes, 0);
    f.root.__gdMuyuDispose(); f.mount(); assert.equal(writes, 0);
    await f.find('button', 'Save this profile').click(); assert.equal(writes, 1);
    assert.equal(f.find('button', 'Save this profile'), undefined);
    f.root.__gdMuyuDispose();
});

test('Variable draft card shows exact preview with revalidation but no apply action', async () => {
    const f = fixture('en', true, { initialMode: 'assistant' }); let checks = 0;
    f.state.artifacts = [{ id: 'variable-1', revision: 1, kind: 'variable-draft', content: { preview: {
        id: 'party_gold', diff: [{ field: 'autoUpdate', before: false, after: true }],
    } } }];
    f.controller.revalidate = () => { checks++; };
    f.emit();
    assert.ok(f.all().some(e => e.textContent?.includes('Current-chat variable: party_gold')));
    assert.ok(f.all().some(e => e.textContent?.includes('changed or saved nothing')));
    assert.equal(f.find('button', 'Review and apply'), undefined);
    await f.find('button', 'Revalidate').click(); assert.equal(checks, 1);
    f.root.__gdMuyuDispose();
});

test('Variable application requires a second explicit click and never executes on remount', async () => {
    const f = fixture('en', true, { initialMode: 'assistant' }); let writes = 0;
    f.state.canApplyVariable = true;
    f.state.artifacts = [{ id: 'variable-1', revision: 1, kind: 'variable-draft', content: { preview: {
        id: 'party_gold', diff: [{ field: 'autoUpdate', before: false, after: true }],
    } } }];
    f.controller.prepareVariableApply = () => { f.state.variableActions = [{ id: 'op', artifactId: 'variable-1', revision: 1, status: 'pending' }]; f.emit(); };
    f.controller.approveVariableApply = () => { writes++; f.state.variableActions[0].status = 'applied_confirmed'; f.emit(); };
    f.emit(); await f.find('button', 'Review and apply variable').click(); assert.equal(writes, 0);
    f.root.__gdMuyuDispose(); f.mount(); assert.equal(writes, 0);
    await f.find('button', 'Apply this variable change').click(); assert.equal(writes, 1);
    assert.equal(f.find('button', 'Apply this variable change'), undefined);
    f.root.__gdMuyuDispose();
});

test('Operation bundle shows ordered scopes and requires one exact approval after review', async () => {
    const f = fixture('en', true, { initialMode: 'assistant' }); let writes = 0;
    f.state.canApplyBundle = true;
    f.state.artifacts = [{ id: 'bundle-1', revision: 1, kind: 'task-bundle', content: {
        variables: [{ preview: { id: 'party_gold', diff: [{ field: 'defaultValue', before: null, after: 0 }] } }],
        settings: { preview: { diff: [{ field: 'memoryEnabled', before: 'true', after: 'false' }], warnings: [] } },
    } }];
    f.controller.prepareBundleApply = () => { f.state.bundleActions = [{ id: 'bundle-op', artifactId: 'bundle-1', revision: 1, status: 'pending' }]; f.emit(); };
    f.controller.approveBundleApply = () => { writes++; f.state.bundleActions[0].status = 'applied_confirmed'; f.emit(); };
    f.emit();
    assert.ok(f.all().some(e => e.textContent?.includes('Current-chat variable: party_gold')));
    assert.ok(f.all().some(e => e.textContent?.includes('Global settings: affects all chats')));
    await f.find('button', 'Review and apply bundle').click(); assert.equal(writes, 0);
    f.root.__gdMuyuDispose(); f.mount(); assert.equal(writes, 0);
    await f.find('button', 'Approve and run bundle').click(); assert.equal(writes, 1);
    assert.equal(f.find('button', 'Approve and run bundle'), undefined);
    f.root.__gdMuyuDispose();
});

for (const lang of ['zh', 'en']) test(`Unified composer has no task picker, field checklist or broad permission toggles (${lang})`, async () => {
    const f = fixture(lang, true, { initialMode: 'assistant' });
    f.state.enabled = true; f.state.hasChat = false; f.state.targetKind = 'global'; f.state.input = 'hello';
    f.controller.send = value => { f.sent.push(value); }; f.emit();
    assert.equal(f.all().some(e => e.className === 'gd-muyu-mode'), false);
    assert.equal(f.all().some(e => e.className === 'gd-muyu-authorization'), false);
    assert.equal(f.find('fieldset'), undefined);
    assert.equal(f.all().some(e => e.textContent?.includes(lang === 'en' ? 'Plugin diagnostics (whitelist' : '插件诊断信息（白名单')), false);
    await f.find('button', lang === 'en' ? 'Send' : '发送').click(); assert.deepEqual(f.sent, [undefined]);
    f.state.interaction = { id: 'g', kind: 'permission', source: 'memoryConfig', reason: 'inspect', status: 'pending' };
    f.state.connection = { endpoint: 'https://example.test', model: 'fake' }; f.emit();
    assert.ok(f.find('button', lang === 'en' ? 'Allow this connection' : '允许本连接'));
    assert.ok(f.all().some(e => e.textContent?.includes(lang === 'en' ? 'global whitelist' : '全局白名单')));
    f.state.interaction = { id: 'code', kind: 'permission', source: 'providerExecution', providerId: 'myNotes', providerRevision: 'v1', reason: 'test', status: 'pending' };
    f.emit();
    assert.equal(f.find('button', lang === 'en' ? 'Allow this chat' : '允许此聊天').hidden, true);
    assert.ok(f.all().some(e => e.textContent?.includes(lang === 'en' ? 'Muyu requests code execution' : '暮羽请求执行代码')));
    assert.ok(f.all().some(e => e.textContent?.includes(lang === 'en' ? 'may change data' : '可能修改数据')));
    f.root.__gdMuyuDispose();
});

for (const lang of ['zh', 'en']) test(`Receipts remain distinct, inert on remount and gated before explanation (${lang})`, async () => {
    const f = fixture(lang, true); let explained = 0;
    f.state.enabled = true; f.state.permissions = { diagnostics: true };
    f.state.receipts = [{ operationId: 'op', artifactId: 'a', revision: 1, at: 1, status: 'outcome_unknown', diff: [], saveError: false, changed: false }];
    f.state.mode = 'draft'; f.state.canApplyConfig = true;
    f.state.configActions = [{ id: 'op', artifactId: 'a', revision: 1, status: 'outcome_unknown' }];
    f.state.artifacts = [{ id: 'a', revision: 1, kind: 'config-draft', content: { preview: { diff: [], warnings: [], notice: 'Draft' } } }];
    f.state.receiptExplanations = { op: 'succeeded' };
    f.controller.explainReceipt = id => { assert.equal(id, 'op'); explained++; };
    let checks = 0;
    f.controller.checkReceipt = id => { assert.equal(id, 'op'); checks++; f.state.configChecks = { op: { state: 'different', fields: [{ field: 'autoMemoryInterval', actual: '25', expected: '15' }], readAt: '2026-09-24T00:00:00Z' } }; f.emit(); };
    f.emit(); f.root.__gdMuyuDispose(); f.mount(); assert.equal(explained, 0);
    assert.equal(f.all().filter(e => e.textContent?.includes('1970-01-01T00:00:00.001Z')).length, 1, 'receipt body appears once');
    const status = f.all().find(e => e.textContent?.startsWith(lang === 'en' ? 'Explanation complete' : '解释完成'));
    assert.ok(status); assert.equal(status.parent.className, 'gd-muyu-receipt-actions');
    assert.equal(f.all().some(e => e.textContent?.includes('succeeded')), false);
    const label = lang === 'en' ? 'Ask Muyu to explain' : '让暮羽解释结果';
    await f.find('button', label).click(); assert.equal(explained, 1);
    await f.find('button', lang === 'en' ? 'Check current settings' : '核对当前配置').click(); assert.equal(checks, 1);
    assert.ok(f.all().some(e => e.textContent?.includes(lang === 'en' ? 'Different from proposed' : '读取时与提议值不一致')));
    f.state.permissions.diagnostics = false; f.emit(); assert.equal(f.find('button', label).disabled, true);
    f.state.readOnly = true; f.emit(); assert.equal(f.find('button', label), undefined);
    assert.equal(f.sent.length, 0); f.root.__gdMuyuDispose();
});

for (const lang of ['zh', 'en']) test(`Blueprint side-effect preview renders without a memory-pruning table (${lang})`, () => {
    const f = fixture(lang, true);
    f.state.canApplyConfig = true; f.state.mode = 'draft';
    f.state.configActions = [{ id: 'op', artifactId: 'a', revision: 1, status: 'pending' }];
    f.state.artifacts = [{ id: 'a', revision: 1, kind: 'config-draft', content: {
        blueprintTogglePlan: { variableId: 'done', operation: 'reset', before: { stored: true, value: true }, enableAutoUpdate: true, useManualInjection: true },
        preview: { diff: [{ field: 'storyBlueprintEnabled', before: 'false', after: 'true' }], manifest: { settings: { storyBlueprintEnabled: true } },
            warnings: [], notice: 'Preview only', impact: { scope: 'current-chat', variableId: 'done', operation: 'reset' } } } }];
    f.emit();
    assert.ok(f.all().some(e => e.textContent?.includes('done') && e.textContent.includes('true → false')));
    assert.ok(f.find('button', lang === 'en' ? 'Apply these changes' : '应用这份修改'));
    assert.ok(!f.all().some(e => e.textContent?.includes(lang === 'en' ? 'Character slots' : '角色序号')));
    f.root.__gdMuyuDispose();
});

for (const lang of ['zh', 'en']) test(`Config application requires a separate confirmation and keeps pending state on remount (${lang})`, async () => {
    const f = fixture(lang, true); let writes = 0;
    f.state.canApplyConfig = true; f.state.mode = 'draft';
    f.state.artifacts = [{ id: 'a', revision: 1, kind: 'config-draft', content: { preview: { diff: [{ field: 'autoMemoryInterval', before: '10', after: '15' }], notice: 'Draft only', warnings: [] } } }];
    f.controller.prepareConfigApply = () => { f.state.configActions = [{ id: 'op', artifactId: 'a', revision: 1, status: 'pending' }]; f.emit(); };
    f.controller.approveConfigApply = () => { writes++; f.state.configActions[0].status = 'applied_unconfirmed'; f.emit(); };
    f.emit(); await f.find('button', lang === 'en' ? 'Review and apply' : '查看并应用').click(); assert.equal(writes, 0);
    assert.ok(f.all().some(e => e.tag === 'p' && e.textContent?.includes(lang === 'en' ? 'Auto-extraction interval' : '自动提取间隔') && e.textContent.includes('10') && e.textContent.includes('15')));
    assert.equal(f.all().some(e => e.tag === 'p' && e.textContent?.includes('autoMemoryInterval')), false);
    assert.ok(f.all().some(e => e.tag === 'pre' && e.textContent?.includes('autoMemoryInterval')));
    f.root.__gdMuyuDispose(); f.mount(); assert.equal(writes, 0);
    await f.find('button', lang === 'en' ? 'Apply these changes' : '应用这份修改').click(); assert.equal(writes, 1);
    assert.equal(f.find('button', lang === 'en' ? 'Apply these changes' : '应用这份修改'), undefined);
    assert.ok(f.all().some(e => e.textContent?.includes(lang === 'en' ? 'persistence unconfirmed' : '持久化保存未确认')));
    f.root.__gdMuyuDispose();
});

for (const lang of ['zh', 'en']) test(`Permission card has explicit decisions, survives remount and closes after one response (${lang})`, async () => {
    const f = fixture(lang, true); let answers = 0;
    f.state.interaction = { id: 'p1', kind: 'permission', source: 'chatHistory', reason: '<img> story', status: 'pending' };
    f.state.connection = { model: 'test', endpoint: 'https://example.test' };
    f.controller.answerPermission = (id, decision) => { assert.equal(id, 'p1'); assert.equal(decision, 'task'); answers++; f.state.interaction.status = 'granted'; f.emit(); };
    f.emit(); assert.equal(f.find('img'), undefined);
    assert.equal(f.find('button', lang === 'en' ? 'Send' : '发送').disabled, true);
    f.root.__gdMuyuDispose(); f.mount();
    const allow = f.find('button', lang === 'en' ? 'Allow this task' : '允许本任务');
    assert.equal(allow.parent.parent.hidden, false);
    await allow.click(); await allow.click(); assert.equal(answers, 1);
    assert.equal(allow.parent.parent.hidden, true); assert.equal(f.sent.length, 0);
    f.root.__gdMuyuDispose();
});

test('Chat send no longer requires a blanket authorization screen', async () => {
    const f = fixture('en', true); let calls = 0;
    f.state.enabled = true; f.state.mode = 'chat'; f.state.permissions = { chat: false };
    f.controller.send = () => { calls++; }; f.emit();
    f.find('textarea').value = 'hello'; await f.find('button', 'Send').click(); assert.equal(calls, 1);
    f.root.__gdMuyuDispose();
});

test('Clarification choices only edit a draft; explicit answer submits once and survives view remount', async () => {
    const f = fixture('en', true); let answered = 0;
    f.state.interaction = { id: 'q1', status: 'pending', question: '<img>Which part?', options: ['Frequency', 'Content'], draft: '' };
    f.controller.setInteractionDraft = (id, draft) => { assert.equal(id, 'q1'); f.state.interaction.draft = draft; f.emit(); };
    f.controller.answerInteraction = () => { answered++; f.state.interaction.status = 'answered'; f.state.interaction.draft = ''; f.emit(); };
    f.emit(); assert.equal(f.find('button', 'Send').disabled, true); assert.equal(f.find('button', 'Answer and continue').disabled, true);
    await f.find('button', 'Frequency').click(); assert.equal(answered, 0); assert.equal(f.state.interaction.draft, 'Frequency');
    f.root.__gdMuyuDispose(); f.mount();
    const editor = f.all().find(e => e.tag === 'textarea' && e.parent.textContent === 'Your answer');
    assert.equal(editor.value, 'Frequency'); assert.equal(f.find('img'), undefined);
    await f.find('button', 'Answer and continue').click(); await f.find('button', 'Answer and continue').click();
    assert.equal(answered, 1); assert.equal(f.sent.length, 0);
    assert.equal(f.all().find(e => e.className === 'gd-muyu-interaction').hidden, true);
    f.root.__gdMuyuDispose(); f.mount();
    assert.equal(f.all().find(e => e.className === 'gd-muyu-interaction').hidden, true);
    f.root.__gdMuyuDispose();
});

test('Closed clarification cards show only status; cumulative usage belongs to conversation tools', () => {
    const f = fixture('en', true);
    f.state.taskUsage = { segments: 2, modelCalls: 2, toolCalls: 1 };
    for (const status of ['cancelled', 'expired']) {
        f.state.interaction = { id: 'q1', status, question: 'Which part?', options: [], draft: '' }; f.emit();
        const card = f.all().find(e => e.className === 'gd-muyu-interaction');
        assert.equal(card.hidden, false);
        assert.ok(card.children.filter(e => e.getAttribute('role') !== 'status').every(e => e.hidden));
        assert.match(card.children.find(e => e.getAttribute('role') === 'status').textContent, /Cancelled|Expired/);
        assert.ok(f.all().some(e => e.textContent?.includes('Task total model/tool calls: 2/1')));
    }
    f.root.__gdMuyuDispose();
});

test('Floating rail releases space in settings, restores it on return and cleans up without business calls', async () => {
    const changes = [], f = fixture('en', true, { setSidebarOpen: value => changes.push(value) });
    f.state.history = managedHistory(); f.emit();
    assert.equal(changes.at(-1), false);
    await f.find('button', 'History').click(); assert.equal(changes.at(-1), true);
    const box = f.all().find(e => e.className === 'gd-muyu-input-box');
    assert.ok(f.all(box).includes(f.find('textarea')));
    assert.ok(f.all(box).includes(f.find('button', 'Send')));
    f.find('textarea').value = 'keep my draft'; f.find('textarea').oninput();
    await f.find('button', '⚙').click(); assert.equal(changes.at(-1), false);
    await f.find('button', 'Back to chat').click(); assert.equal(changes.at(-1), true);
    assert.equal(f.find('textarea').value, 'keep my draft');
    const sidebar = f.find('aside');
    await f.all(sidebar).find(e => e.textContent === 'Back to chat').click();
    assert.equal(changes.at(-1), false); assert.equal(sidebar.hidden, true);
    f.root.__gdMuyuDispose(); assert.equal(changes.at(-1), false); assert.equal(f.sent.length, 0);
});

for (const lang of ['zh', 'en']) test(`Settings scroll positions survive switching and shortcuts override restoration (${lang})`, async () => {
    const f = fixture(lang, true, { initialMode: 'assistant' }), en = lang === 'en';
    const pages = f.all().filter(e => e.className === 'gd-muyu-settings-page');
    await f.find('button', '⚙').click(); pages[0].scrollTop = 120;
    await f.find('button', en ? 'Context & budgets' : '上下文与预算').click(); assert.equal(pages[3].scrollTop, 0);
    pages[3].scrollTop = 330;
    await f.find('button', en ? 'Connection' : '模型连接').click(); assert.equal(pages[0].scrollTop, 120);
    await f.find('button', en ? 'Context & budgets' : '上下文与预算').click(); assert.equal(pages[3].scrollTop, 330);
    f.emit(); assert.equal(pages[3].scrollTop, 330);
    await f.find('button', en ? 'Back to chat' : '返回聊天').click();
    pages[3].scrollTop = 0; // Simulate a hidden layout dropping its native scroll offset.
    await f.find('button', '⚙').click(); assert.equal(pages[3].scrollTop, 330);
    const endpoint = f.all(pages[0]).find(e => e.type === 'url');
    endpoint.scrollIntoView = () => { pages[0].scrollTop = 20; };
    await f.find('button', en ? 'Back to chat' : '返回聊天').click();
    await f.find('button', en ? 'Configure connection' : '配置连接').click();
    assert.equal(pages[0].scrollTop, 20); assert.equal(endpoint.ownerDocument.activeElement, endpoint);
    f.emit(); assert.equal(pages[0].scrollTop, 20);
    await f.all().find(e => e.className?.includes('gd-muyu-permission-summary')).click();
    assert.equal(pages[1].hidden, false); assert.match(endpoint.ownerDocument.activeElement.className, /gd-muyu-grants/);
    assert.equal(f.sent.length, 0); assert.equal(f.configs.length, 0); f.root.__gdMuyuDispose();
});

for (const lang of ['zh', 'en']) test(`History settings report actual storage, failures and pending changes (${lang})`, () => {
    const f = fixture(lang, true, { initialMode: 'assistant' }), en = lang === 'en';
    f.state.history = { available: true, enabled: true, backend: 'browser', canChooseStorage: true, accountStorage: false, sessions: [], persisted: true };
    f.emit();
    const location = f.all().find(e => e.className === 'gd-muyu-storage-location');
    const status = f.all().find(e => e.className === 'gd-muyu-storage-status');
    assert.match(location.textContent, /IndexedDB/); assert.match(status.textContent, en ? /Saved locally/ : /已保存在本地/);
    f.state.history.accountStorage = true; f.emit(); assert.match(location.textContent, /IndexedDB/); assert.match(status.textContent, en ? /reload to switch/ : /刷新后生效/);
    f.state.history.backend = 'account-settings'; f.emit(); assert.match(location.textContent, en ? /account settings/ : /账户设置/); assert.doesNotMatch(status.textContent, /reload to switch|刷新后生效/);
    f.state.history.backend = 'private-files'; f.emit(); assert.match(location.textContent, en ? /ST server/ : /服务端/);
    f.state.history.error = 'HISTORY_CONFLICT'; f.emit(); assert.match(status.textContent, en ? /Another tab/ : /另一标签页/);
    f.state.history.recovery = true; f.emit(); assert.match(status.textContent, en ? /recovery backup/ : /恢复备份/);
    f.state.history = { ...f.state.history, backend: 'memory', recovery: false, error: null, persisted: true }; f.emit();
    assert.match(location.textContent, en ? /page only/ : /临时保留/); assert.match(status.textContent, en ? /may be lost/ : /可能丢失/); assert.doesNotMatch(status.textContent, /Saved locally|已保存在本地/);
    f.root.__gdMuyuDispose();
});

for (const lang of ['zh', 'en']) test(`Settings categories preserve editors and route shortcuts without execution (${lang})`, async () => {
    const f = fixture(lang, true), en = lang === 'en';
    const pages = f.all().filter(e => e.className === 'gd-muyu-settings-page');
    const [connection, data, behavior, limits, storage, skills] = pages;
    assert.equal(pages.length, 6); assert.equal(connection.hidden, false); assert.equal(skills.hidden, true);
    assert.ok(pages.slice(1).every(e => e.hidden));
    const endpoint = f.all(connection).find(e => e.type === 'url');
    const budget = f.all(limits).find(e => e.type === 'number');
    assert.ok(endpoint); assert.ok(budget);
    assert.ok(f.all(storage).some(e => e.textContent === (en ? 'Conversation history' : '对话历史')));
    assert.ok(!f.all(data).some(e => e.textContent === (en ? 'Conversation history' : '对话历史')));
    assert.ok(f.all(data).some(e => e.textContent === (en ? 'Context and permissions' : '上下文与权限')));
    assert.ok(f.all(behavior).some(e => e.tag === 'textarea'));
    endpoint.value = 'https://draft.invalid'; budget.value = '7';
    const composer = f.all().find(e => e.className === 'gd-muyu-composer');
    const tools = f.all().find(e => e.className === 'gd-muyu-conversation-tools');
    assert.ok(!tools.open);
    assert.ok(!f.all(composer).some(e => e.className === 'gd-muyu-context'));
    assert.ok(f.all(tools).some(e => e.className === 'gd-muyu-context'));
    await f.all().find(e => e.className?.includes('gd-muyu-permission-summary')).click();
    assert.equal(data.hidden, false); assert.equal(connection.hidden, true);
    await f.find('button', en ? 'Context & budgets' : '上下文与预算').click();
    assert.equal(limits.hidden, false); assert.equal(data.hidden, true);
    assert.equal(f.find('button', en ? 'Context & budgets' : '上下文与预算').getAttribute('aria-current'), 'page');
    await f.find('button', en ? 'Back to chat' : '返回聊天').click();
    await f.find('button', '⚙').click();
    assert.equal(limits.hidden, false); // Keep the last settings category.
    f.emit(); assert.equal(endpoint.value, 'https://draft.invalid'); assert.equal(budget.value, '7');
    await f.find('button', en ? 'Back to chat' : '返回聊天').click();
    await f.find('button', en ? 'Configure connection' : '配置连接').click();
    assert.equal(connection.hidden, false); assert.equal(limits.hidden, true);
    const setup = f.find('button', en ? 'Configure connection' : '配置连接');
    assert.equal(setup.parent.className, 'gd-muyu-connection-entry');
    assert.equal(setup.parent.parent.className, 'gd-muyu-chat');
    assert.equal(setup.parent.hidden, false);
    f.state.enabled = true; f.emit(); assert.equal(setup.parent.hidden, true);
    f.state.enabled = false; f.emit(); assert.equal(setup.parent.hidden, false);
    assert.equal(f.sent.length, 0); assert.equal(f.configs.length, 0);
    f.root.__gdMuyuDispose(); assert.equal(f.listeners.size, 0);
});
for (const lang of ['zh', 'en']) test('Display settings retain failed drafts and take effect only after saving / ' + lang, async () => {
    const f = fixture(lang, true), en = lang === 'en';
    f.state.displayConfig = { processDetail: 'compact' };
    let fail = true, calls = 0;
    f.controller.saveDisplayConfig = async value => { calls++; if (fail) throw Error('DISPLAY_CONFIG_SAVE_FAILED'); f.state.displayConfig = value; f.emit(); };
    f.emit();
    const select = f.all().find(el => el.tag === 'select' && el.parent.textContent === (en ? 'Execution detail' : '执行过程显示'));
    select.value = 'verbose'; select.events.change(); f.emit(); assert.equal(select.value, 'verbose');
    await f.find('button', en ? 'Save display settings' : '保存显示设置').click();
    assert.equal(f.state.displayConfig.processDetail, 'compact'); assert.equal(select.value, 'verbose');
    assert.ok(f.all().some(el => el.getAttribute('data-state') === 'error'));
    fail = false; await f.find('button', en ? 'Save display settings' : '保存显示设置').click();
    assert.equal(f.state.displayConfig.processDetail, 'verbose'); assert.equal(calls, 2); assert.equal(f.sent.length, 0);
    select.value = 'standard'; select.events.change(); await f.find('button', en ? 'Discard display changes' : '放弃显示修改').click();
    assert.equal(select.value, 'verbose'); f.root.__gdMuyuDispose();
});
test('Behavior editor keeps drafts through remount, rejects over-limit saves and saves restored defaults', async () => {
    const f = fixture('en', true); const defaults = { enabled: false, text: '' };
    f.state.instructionSettings = { saved: { ...defaults }, draft: { ...defaults }, dirty: false, saving: false };
    f.controller.setInstructionDraft = value => { f.state.instructionSettings.draft = value; f.state.instructionSettings.dirty = true; f.emit(); };
    f.controller.saveInstructions = () => { const s = f.state.instructionSettings; s.saved = { ...s.draft }; s.dirty = false; f.emit(); };
    f.controller.resetInstructionDraft = () => f.controller.setInstructionDraft({ ...defaults });
    const editor = () => f.all().find(e => e.tag === 'textarea' && e.parent.textContent === 'Additional instructions');
    f.emit(); editor().value = '<img>literal preference</img>'; await editor().oninput();
    const toggle = f.all().find(e => e.type === 'checkbox' && e.parent.textContent === 'Enable additional instructions (off by default)'); toggle.checked = true; await toggle.onchange();
    f.state.viewToken++; f.emit(); f.root.__gdMuyuDispose(); f.mount(); assert.equal(editor().value, '<img>literal preference</img>'); assert.equal(f.find('img'), undefined);
    await f.find('button', 'Save behavior preferences').click(); assert.equal(f.state.instructionSettings.saved.enabled, true);
    editor().value = 'a'.repeat(4001); await editor().oninput(); assert.equal(f.find('button', 'Save behavior preferences').disabled, true); assert.equal(editor().value.length, 4001);
    await f.find('button', 'Restore and save defaults').click(); assert.equal(editor().value, ''); assert.equal(f.state.instructionSettings.saved.enabled, false);
    await f.find('button', 'Save behavior preferences').click(); assert.equal(f.state.instructionSettings.saved.enabled, false); assert.equal(f.sent.length, 0); f.root.__gdMuyuDispose();
});
test('Reply language editor is independent, bilingual, customisable and survives remount', async () => {
    for (const lang of ['en', 'zh']) {
        const f = fixture(lang, true), t = (zh, en) => lang === 'en' ? en : zh;
        f.state.instructionSettings = { saved: { enabled: false, text: '' }, draft: { enabled: false, text: '' }, dirty: false, saving: false };
        f.controller.setInstructionDraft = value => { f.state.instructionSettings.draft = structuredClone(value); f.state.instructionSettings.dirty = true; f.emit(); };
        f.controller.saveInstructions = () => { const s = f.state.instructionSettings; s.saved = structuredClone(s.draft); s.dirty = false; f.emit(); };
        const control = label => f.all().find(e => e.parent?.textContent === label && ['input', 'select'].includes(e.tag));
        const toggleLabel = t('固定回复语言（默认关闭）', 'Use a fixed reply language (off by default)');
        const languageLabel = t('语种', 'Language'), customLabel = t('自定义语种名称', 'Custom language name');
        const saveLabel = t('保存行为偏好', 'Save behavior preferences');
        f.emit(); assert.equal(control(toggleLabel).checked, false); assert.equal(control(languageLabel).disabled, true);
        control(toggleLabel).checked = true; await control(toggleLabel).onchange();
        control(languageLabel).value = 'French'; await control(languageLabel).onchange();
        assert.equal(f.state.instructionSettings.draft.enabled, false);
        await f.find('button', saveLabel).click(); assert.equal(f.state.instructionSettings.saved.replyLanguage.language, 'French');
        control(languageLabel).value = '__custom__'; await control(languageLabel).onchange();
        control(customLabel).value = ''; await control(customLabel).oninput();
        assert.equal(f.find('button', saveLabel).disabled, true);
        control(customLabel).value = 'Brazilian Portuguese'; await control(customLabel).oninput();
        f.root.__gdMuyuDispose(); f.mount();
        assert.equal(control(customLabel).value, 'Brazilian Portuguese'); assert.equal(control(customLabel).parent.hidden, false);
        await f.find('button', saveLabel).click();
        assert.equal(f.state.instructionSettings.saved.replyLanguage.language, 'Brazilian Portuguese');
        control(toggleLabel).checked = false; await control(toggleLabel).onchange(); await f.find('button', saveLabel).click();
        assert.equal(f.state.instructionSettings.saved.replyLanguage.enabled, false);
        assert.equal(f.state.instructionSettings.saved.replyLanguage.language, 'Brazilian Portuguese');
        assert.equal(f.sent.length, 0); f.root.__gdMuyuDispose();
    }
});

test('Custom reply language mode survives preset prefixes while typing and explicit selection resets it', async () => {
    for (const lang of ['en', 'zh']) for (const name of ['English (US)', 'French Canadian']) {
        const f = fixture(lang, true), t = (zh, en) => lang === 'en' ? en : zh;
        const defaults = { enabled: false, text: '', replyLanguage: { enabled: true, language: 'English' } };
        f.state.instructionSettings = { saved: structuredClone(defaults), draft: structuredClone(defaults), dirty: false, saving: false };
        f.controller.setInstructionDraft = value => { f.state.instructionSettings.draft = structuredClone(value); f.state.instructionSettings.dirty = true; f.emit(); };
        f.controller.saveInstructions = () => { const s = f.state.instructionSettings; s.saved = structuredClone(s.draft); s.dirty = false; f.emit(); };
        f.controller.discardInstructionDraft = () => { const s = f.state.instructionSettings; s.draft = structuredClone(s.saved); s.dirty = false; f.emit(); };
        f.controller.resetInstructionDraft = () => f.controller.setInstructionDraft({ enabled: false, text: '' });
        const select = () => f.all().find(e => e.tag === 'select' && e.parent.textContent === t('语种', 'Language'));
        const custom = () => f.all().find(e => e.tag === 'input' && e.parent.textContent === t('自定义语种名称', 'Custom language name'));
        f.emit(); select().value = '__custom__'; await select().onchange();
        assert.equal(select().value, '__custom__'); assert.equal(custom().parent.hidden, false);
        custom().value = ''; await custom().oninput();
        for (const ch of name) {
            custom().value += ch; await custom().oninput();
            assert.equal(select().value, '__custom__', `Keep custom mode while typing ${custom().value}`);
            assert.equal(custom().parent.hidden, false);
            f.emit(); assert.equal(custom().parent.hidden, false);
            if (['English', 'French'].includes(custom().value)) {
                select().value = custom().value; await select().onchange();
                assert.equal(custom().parent.hidden, true);
                select().value = '__custom__'; await select().onchange();
                assert.equal(select().value, '__custom__'); assert.equal(custom().parent.hidden, false);
            }
        }
        await f.find('button', t('保存行为偏好', 'Save behavior preferences')).click();
        assert.equal(f.state.instructionSettings.saved.replyLanguage.language, name);
        select().value = 'French'; await select().onchange(); assert.equal(custom().parent.hidden, true);
        select().value = '__custom__'; await select().onchange(); assert.equal(custom().parent.hidden, false);
        await f.find('button', t('放弃修改', 'Discard changes')).click();
        assert.equal(custom().value, name); assert.equal(custom().parent.hidden, false);
        await f.find('button', t('恢复默认并保存', 'Restore and save defaults')).click();
        assert.notEqual(select().value, '__custom__'); assert.equal(custom().parent.hidden, true);
        assert.equal(f.sent.length, 0); f.root.__gdMuyuDispose();
    }
});

test('Context UI preserves settings drafts, requires summary confirmation and resets it on view change', async () => {
    const f = fixture('en', true); f.state.enabled = true; f.state.history = managedHistory();
    f.state.context = { turns: 2, omitted: 4, summary: '<img>literal</img>', summaryUsed: true };
    f.state.runs = [{ process: { context: { estimatedTokens: 900, inputTokenLimit: 4096, requestBytes: 1800, historicalMessages: 0, trimmedHistoricalMessages: 2, messageBytes: 400, toolDefinitionBytes: 300, toolResultBytes: 0, reasoningBytes: 0 } } }]; f.emit();
    assert.ok(f.all().some(e => e.tag === 'p' && e.textContent.includes('Some original history is not planned')));
    assert.ok(f.all().some(e => e.tag === 'p' && e.textContent.includes('Additional historical messages removed before sending')));
    const automatic = f.all().find(e => e.type === 'checkbox' && e.parent.textContent.includes('Request-size protection only'));
    const input = f.all().find(e => e.type === 'number' && e.parent.textContent === 'Manual input budget (estimated tokens)');
    assert.equal(automatic.checked, false); assert.equal(input.disabled, false);
    automatic.checked = false; automatic.onchange(); assert.equal(input.disabled, false);
    input.value = '64000'; f.emit(); assert.equal(input.value, '64000');
    let savedContext; f.controller.saveContextConfig = value => { savedContext = value; };
    await f.find('button', 'Save context settings').click(); assert.equal(savedContext.inputTokens, 64000);
    const summaryBudget = f.all().find(e => e.type === 'number' && e.parent.textContent === 'Summary output budget (tokens)');
    assert.equal(summaryBudget.value, '16384'); summaryBudget.value = '32768'; f.emit();
    await f.find('button', 'Save context settings').click(); assert.equal(savedContext.summaryTokens, 32768);
    const summaryTime = f.all().find(e => e.type === 'number' && e.parent.textContent === 'Summarization timeout (seconds)');
    assert.equal(summaryTime.value, '300'); assert.equal(summaryTime.min, 10); assert.equal(summaryTime.max, 1800);
    summaryTime.value = '600'; f.emit(); assert.equal(summaryTime.value, '600');
    await f.find('button', 'Save context settings').click(); assert.equal(savedContext.summaryTimeMs, 600000);
    const historyPolicy = f.all().find(e => e.tag === 'select' && e.parent.textContent === 'Sending existing conversation history');
    assert.equal(historyPolicy.value, 'auto'); historyPolicy.value = 'ask'; f.emit(); assert.equal(historyPolicy.value, 'ask');
    await f.find('button', 'Save context settings').click(); assert.equal(savedContext.historyAuthorization, 'ask');
    f.state.contextConfig = { ...savedContext }; f.emit();
    await f.find('button', 'Restore and save default context budget').click(); assert.equal(savedContext.historyAuthorization, 'ask');
    automatic.checked = true; automatic.onchange(); await f.find('button', 'Save context settings').click(); assert.equal(savedContext.inputTokens, null);
    let calls = 0, omitted = false; f.controller.compactHistory = () => { calls++; }; f.controller.setOmitHistory = value => { omitted = value; };
    let resetCalls = 0; f.controller.resetAutoCompaction = () => { resetCalls++; };
    f.state.autoCompaction = { failures: 3, blocked: true }; f.emit();
    const retryAuto = f.find('button', 'Resume automatic summarization'); assert.equal(retryAuto.hidden, false);
    await retryAuto.click(); assert.equal(resetCalls, 1);
    f.state.busy = true; f.emit(); assert.equal(retryAuto.disabled, true);
    f.state.busy = false; f.state.autoCompaction = { failures: 0, blocked: false }; f.emit(); assert.equal(retryAuto.hidden, true);
    await f.find('button', 'Summarize history now').click(); assert.equal(calls, 0);
    f.state.viewToken++; f.emit(); assert.equal(f.find('button', 'Confirm model summarization').hidden, true);
    await f.find('button', 'Summarize history now').click(); await f.find('button', 'Confirm model summarization').click(); assert.equal(calls, 1);
    const omit = f.all().find(e => e.type === 'checkbox' && e.parent.textContent === 'Omit history this send (does not revoke tool access)'); omit.checked = true; await omit.onchange(); assert.equal(omitted, true);
    assert.equal(f.find('img'), undefined); f.state.readOnly = true; f.emit(); assert.equal(f.find('button', 'Summarize history now').disabled, true);
    f.root.__gdMuyuDispose();
});
test('History navigation owns creation/import; narrow selection and creation close the sidebar', async () => {
    const f = fixture('en', true); f.state.history = managedHistory(); f.emit();
    const sidebar = f.find('aside'), settings = f.all().find(e => e.className === 'gd-muyu-settings');
    assert.equal(f.find('button', 'New conversation').parent, sidebar);
    assert.ok(f.all(sidebar).some(e => e.type === 'file'));
    assert.ok(!f.all(settings).some(e => e.type === 'file' || e.textContent === 'Export current conversation JSON'));
    const filters = f.all().find(e => e.className === 'gd-muyu-history-filters');
    assert.ok(!filters.open); assert.equal(f.all(filters).filter(e => e.tag === 'select').length, 3);
    await f.find('button', 'History').click(); assert.equal(sidebar.hidden, false);
    await f.find('button', 'Title').click(); assert.equal(sidebar.hidden, true);
    await f.find('button', 'History').click(); await f.find('button', 'New conversation').click();
    assert.equal(sidebar.hidden, true); assert.equal(f.state.history.sessionId, 'new');
    assert.equal(f.sent.length, 0); f.root.__gdMuyuDispose();
});

test('Row export targets its own conversation and ignores selection changes during an awaited open', async () => {
    const f = fixture('en', true); f.state.history = managedHistory(); f.emit(); const exports = [];
    f.controller.exportHistory = format => { exports.push([f.state.history.sessionId, format]); return '{}'; };
    f.state.history.sessionId = 'another';
    await f.find('button', 'Export JSON').click(); assert.deepEqual(exports, [['old', 'json']]);
    f.controller.openSession = async () => { f.state.history.sessionId = 'another'; };
    await f.find('button', 'Export Markdown').click(); assert.equal(exports.length, 1);
    assert.equal(f.sent.length, 0); f.root.__gdMuyuDispose();
});

test('Sidebar responds to container width, preserves manual choice and traps only visible controls', t => {
    const previous = globalThis.ResizeObserver; let resize, disconnected = 0;
    globalThis.ResizeObserver = class { constructor(callback) { resize = callback; } observe() {} disconnect() { disconnected++; } };
    t.after(() => { if (previous) globalThis.ResizeObserver = previous; else delete globalThis.ResizeObserver; });
    const f = fixture('en', true); f.state.history = managedHistory(); f.emit();
    const sidebar = f.all().find(e => e.tag === 'aside'), toggle = f.find('button', 'History');
    resize([{ contentRect: { width: 800 } }]); assert.equal(sidebar.hidden, false);
    f.find('button', 'Close history').click(); resize([{ contentRect: { width: 900 } }]); assert.equal(sidebar.hidden, true);
    toggle.click(); resize([{ contentRect: { width: 400 } }]); assert.equal(sidebar.hidden, false);
    const first = f.all(sidebar).find(e => e.tag === 'button' && e.textContent === 'Back to chat'), last = f.find('button', 'Title'), hidden = f.find('button', 'Delete');
    hidden.getClientRects = () => []; sidebar.querySelectorAll = () => [first, last, hidden];
    let prevented = 0; sidebar.onkeydown({ key: 'Tab', target: last, shiftKey: false, preventDefault() { prevented++; } });
    assert.equal(first.ownerDocument.activeElement, first); assert.equal(prevented, 1);
    sidebar.onkeydown({ key: 'Escape', stopPropagation() {}, preventDefault() {} }); assert.equal(sidebar.hidden, true); assert.equal(toggle.attrs['aria-expanded'], 'false');
    f.root.__gdMuyuDispose(); assert.equal(disconnected, 1); assert.equal(f.sent.length, 0);
});
test('Sidebar filters are explicit and metadata/delete actions require confirmation', async () => {
    const f = fixture('zh', true); f.state.history = managedHistory(); f.emit();
    const search = f.all().find(e => e.type === 'search' && e.parent.textContent === '搜索标题'); search.value = 'title'; await search.oninput(); assert.equal(f.state.history.filters.query, 'title');
    await f.find('button', '重命名').click(); assert.equal(f.state.history.selected.title, 'Title');
    const title = f.all().find(e => e.tag === 'input' && e.parent.textContent === '对话标题'); title.value = 'New title';
    await f.find('button', '确认').click(); assert.equal(f.state.history.selected.title, 'New title');
    await f.find('button', '删除').click(); assert.equal(f.state.history.sessionId, 'old');
    const warning = f.all().find(e => e.tag === 'p' && e.textContent?.includes('已保存的这条记录'));
    assert.ok(warning); await f.find('button', '取消').click(); assert.equal(f.state.history.sessionId, 'old');
    await f.find('button', '删除').click(); await f.find('button', '确认').click(); assert.equal(f.state.history.sessionId, ''); assert.equal(f.sent.length, 0);
    f.root.__gdMuyuDispose();
});

test('Read-only historical view disables sending and cannot stop another live task', () => {
    const f = fixture('en', true); f.state.history = managedHistory(); f.state.readOnly = true; f.state.enabled = true; f.state.busy = true; f.emit();
    assert.equal(f.find('textarea').disabled, true); assert.equal(f.find('button', 'Send').disabled, true);
    assert.equal(f.find('button', 'Stop').disabled, true); assert.equal(f.find('button', 'Stop').hidden, true);
    assert.equal(f.sent.length, 0); f.root.__gdMuyuDispose();
});

test('Choosing an import file only previews it; explicit confirmation imports once', async () => {
    const f = fixture('zh', true); f.state.history = managedHistory(); f.emit(); let imports = 0;
    f.controller.previewHistoryImport = importPreview; f.controller.importHistory = async () => { imports++; };
    const file = f.all().find(e => e.type === 'file'), text = JSON.stringify({ version: 1, id: crypto.randomUUID(), revision: 0, scope: JSON.stringify(['chat', 'chat', 'A']), title: '<script>literal</script>', createdAt: 1, updatedAt: 1, messages: [], required: [], status: 'idle' });
    file.files = [{ size: text.length, text: async () => text }];
    Object.defineProperty(file, 'value', { configurable: true, get: () => '', set() { file.files = []; } });
    await file.onchange(); assert.equal(imports, 0); assert.equal(f.find('button', '确认导入只读备份').disabled, false);
    assert.equal(f.find('script'), undefined); await f.find('button', '确认导入只读备份').click(); await f.find('button', '确认导入只读备份').click();
    assert.equal(imports, 1); assert.equal(f.sent.length, 0); f.root.__gdMuyuDispose();
});

test('View switches restore scroll position and unrelated renders do not force scrolling', () => {
    const f = fixture('en', true), saved = [];
    f.controller.setScrollPosition = (key, top) => saved.push([key, top]); f.state.viewKey = 'A'; f.state.scrollTop = 40; f.emit();
    const transcript = f.all().find(e => e.className === 'gd-muyu-transcript'); transcript.scrollHeight = 500; transcript.clientHeight = 100; transcript.scrollTop = 350;
    f.state.viewKey = 'B'; f.state.viewToken++; f.state.scrollTop = 25; f.emit(); assert.equal(transcript.scrollTop, 25); assert.deepEqual(saved.at(-1), ['A', 350]);
    transcript.scrollTop = 350; f.emit(); assert.equal(transcript.scrollTop, 350); f.root.__gdMuyuDispose();
});

test('Settings, tools and permissions temporarily expand the workbench without losing the composer', async () => {
    const sizes = [], f = fixture('en', true, { initialMode: 'assistant', setViewExpanded: value => sizes.push(value) });
    f.state.enabled = true; f.state.input = 'Unsent draft'; f.emit();
    assert.equal(sizes.at(-1), false);
    await f.find('button', '⚙').click(); assert.equal(sizes.at(-1), true);
    await f.find('button', 'Back to chat').click(); assert.equal(sizes.at(-1), false);
    const tools = f.all().find(e => e.className === 'gd-muyu-conversation-tools');
    await f.all().find(e => e.className?.includes('gd-muyu-mobile-tools')).click();
    assert.equal(tools.open, true); assert.equal(sizes.at(-1), true);
    await f.all().find(e => e.className?.includes('gd-muyu-mobile-tools')).click();
    assert.equal(sizes.at(-1), false);
    f.state.interaction = { id: 'read-1', kind: 'permission', source: 'chatHistory', reason: 'Inspect chat', status: 'pending' };
    f.emit(); assert.equal(sizes.at(-1), true);
    f.state.interaction.status = 'granted'; f.emit(); assert.equal(sizes.at(-1), false);
    assert.equal(f.find('textarea').value, 'Unsent draft'); assert.equal(f.sent.length, 0);
    f.root.__gdMuyuDispose();
});

test('Floating history entry and session management remain reachable outside the hidden session bar', async () => {
    const launcher = new Element('div', {}), f = fixture('en', true, { actionsRoot: launcher });
    f.state.history = { available: true, enabled: true, sessionId: 'old', sessions: [{ id: 'old', title: 'My session' }], selected: { title: 'My session' } };
    f.emit();
    const toggle = launcher.children.find(e => e.getAttribute('aria-label') === 'Conversation history');
    assert.ok(toggle); assert.equal(toggle.hidden, false);
    await toggle.click();
    const sidebar = f.all().find(e => e.className === 'gd-muyu-history-sidebar');
    assert.equal(sidebar.hidden, false);
    const menu = f.all().find(e => e.className === 'gd-muyu-session-menu');
    assert.equal(menu.parent.parent, sidebar);
    assert.ok(f.all(sidebar).some(e => e.textContent === 'Current conversation: My session'));
    await f.find('button', 'Rename').click();
    const renameInput = f.all(sidebar).find(e => e.tag === 'input' && e.value === 'My session');
    assert.ok(renameInput, 'management editor must not remain in the hidden session bar');
    f.root.__gdMuyuDispose(); assert.ok(!launcher.children.includes(toggle));
});

test('A new permission request scrolls to its inline card only once', () => {
    const f = fixture('en', true), transcript = f.all().find(e => e.className === 'gd-muyu-transcript');
    transcript.scrollHeight = 500; transcript.clientHeight = 100; transcript.scrollTop = 50;
    f.state.interaction = { id: 'read-1', kind: 'permission', source: 'chatHistory', reason: 'Inspect chat', status: 'pending' };
    f.emit(); assert.equal(transcript.scrollTop, 500);
    transcript.scrollTop = 80; f.emit(); assert.equal(transcript.scrollTop, 80, 'ordinary progress render preserves manual scroll');
    f.state.interaction.status = 'granted'; f.emit();
    f.state.interaction = { id: 'read-2', kind: 'permission', source: 'chatHistory', reason: 'Read again', status: 'pending' };
    f.emit(); assert.equal(transcript.scrollTop, 500);
    f.root.__gdMuyuDispose();
});

test('Session chooser creates/switches explicitly and local saving can be toggled without model calls', async () => {
    const f = fixture('zh', true);
    f.state.history = { available: true, enabled: false, loading: false, pending: 0, error: null, dirty: false, sessionId: '', sessions: [{ id: 'old', title: '<img onerror=alert(1)>' }], missingPermissions: [], omitted: 0 };
    f.emit(); assert.equal(f.sent.length, 0);
    const open = f.find('button', '<img onerror=alert(1)>');
    assert.equal(open.textContent, '<img onerror=alert(1)>'); assert.equal(f.find('img'), undefined);
    await open.click(); assert.equal(f.state.history.sessionId, 'old');
    await f.find('button', '新对话').click(); assert.equal(f.state.history.sessionId, 'new');
    const save = f.all().find(e => e.type === 'checkbox' && e.parent.textContent === '自动保存暮羽对话（默认开启）');
    assert.equal(save.checked, false); save.checked = true; await save.onchange(); assert.equal(f.state.history.enabled, true);
    assert.equal(f.sent.length, 0); f.root.__gdMuyuDispose();
});

test('History status distinguishes loading, conflicts, permission gates and interrupted tasks', () => {
    const f = fixture('en', true); f.state.enabled = true;
    f.state.history = { available: true, enabled: true, loading: true, pending: 0, error: null, sessionId: 'old', sessions: [], missingPermissions: [], omitted: 0 }; f.emit();
    assert.equal(f.find('button', 'Send').disabled, true);
    f.state.history.loading = false; f.state.history.error = 'HISTORY_CONFLICT'; f.state.history.restoredStatus = 'interrupted'; f.state.history.missingPermissions = ['chat']; f.emit();
    const status = f.all().find(e => e.tag === 'small' && e.attrs.role === 'status');
    assert.match(status.textContent, /Another tab/); assert.match(status.textContent, /interrupted/); assert.match(status.textContent, /Reauthorize/);
    assert.equal(f.sent.length, 0); f.root.__gdMuyuDispose();
});

test('Failed question recovery only restores the composer; saving status states what is durable', async () => {
    const f = fixture('en', true); f.state.enabled = true;
    f.state.history = { ...managedHistory(), enabled: false, dirty: true, persisted: false };
    f.state.recovery = { runId: 'failed-run', status: 'failed', possibleEffects: true };
    let restored = 0;
    f.controller.restoreFailedInput = id => { assert.equal(id, 'failed-run'); restored++; f.state.input = 'Original question'; f.emit(); };
    f.emit();
    const status = f.all().find(e => e.tag === 'small' && e.attrs.role === 'status');
    assert.match(status.textContent, /This page only; new content is unsaved/);
    const restore = f.find('button', 'Restore failed question to composer');
    assert.equal(restore.disabled, false);
    assert.ok(f.all().some(e => e.tag === 'small' && e.textContent.includes('no automatic retry')));
    await restore.click(); assert.equal(restored, 1); assert.equal(f.find('textarea').value, 'Original question'); assert.equal(restore.disabled, true);
    f.state.history = { ...f.state.history, enabled: true, dirty: false, persisted: true }; f.emit();
    assert.match(status.textContent, /Saved locally/);
    assert.equal(f.sent.length, 0); f.root.__gdMuyuDispose();
});

test('Classic view defaults closed; mount/close/rebuild never starts work or leaks subscriptions', () => {
    const f = fixture(); const shell = f.find('details');
    assert.equal(f.listeners.size, 0); assert.equal(f.find('button', '发送').disabled, false);
    shell.toggle(true); shell.toggle(true); assert.equal(f.listeners.size, 1);
    f.find('textarea').value = 'unsaved'; f.find('textarea').oninput();
    shell.toggle(false); assert.equal(f.listeners.size, 0);
    f.mount(); assert.equal(f.root.children.length, 1); assert.equal(f.find('textarea').value, 'unsaved');
    f.find('details').toggle(true); assert.equal(f.listeners.size, 1);
    f.root.__gdMuyuDispose(); shell.toggle(true); assert.equal(f.listeners.size, 0); assert.equal(f.sent.length, 0);
});

test('Panel clears key after configure; each click/keyboard send runs once and requires fresh consent', async () => {
    const f = fixture(); f.find('details').toggle(true);
    const key = f.all().find(e => e.type === 'password'); key.value = 'synthetic';
    await f.find('button', '启用此连接').click(); assert.equal(key.value, ''); assert.equal(f.configs[0].thinking, true);
    await f.find('button', '发送').click(); assert.equal(f.sent.length, 0);
    const consent = f.all().find(e => e.type === 'checkbox' && e.parent.className === 'gd-muyu-consent');
    consent.checked = true; f.find('textarea').value = 'question';
    f.find('textarea').onkeydown({ ctrlKey: true, key: 'Enter', preventDefault() {} });
    assert.equal(f.sent.length, 0);
    await f.find('button', '确认发送').click();
    assert.equal(f.sent.length, 1); assert.equal(consent.checked, false); assert.equal(f.find('button', '发送').disabled, true);
    await f.find('button', '停止').click(); assert.equal(f.stops(), 1);
    consent.checked = true; f.state.viewToken++; f.emit(); assert.equal(consent.checked, false);
    key.value = 'unsent'; f.find('details').toggle(false); assert.equal(key.value, '');
});

test('Model/user text is rendered as text; English labels and no apply control', () => {
    const f = fixture('en'); f.find('details').toggle(true);
    f.state.messages = [{ role: 'assistant', content: '<img src=x onerror=alert(1)>' }]; f.emit();
    assert.equal(f.find('span').textContent, '<img src=x onerror=alert(1)>');
    assert.equal(f.find('img'), undefined); assert.ok(f.find('button', 'Send'));
    assert.ok(f.all().every(e => e.innerHTML === undefined)); assert.equal(f.find('button', 'Apply'), undefined);
});

test('Standalone view subscribes immediately; reopening restores input but never retains authorization', () => {
    const f = fixture('zh', true); assert.equal(f.listeners.size, 1);
    f.find('textarea').value = 'draft across windows'; f.find('textarea').oninput();
    f.all().find(e => e.type === 'checkbox' && e.parent.className === 'gd-muyu-consent').checked = true;
    f.root.__gdMuyuDispose(); assert.equal(f.listeners.size, 0);
    f.mount(); assert.equal(f.listeners.size, 1); assert.equal(f.find('textarea').value, 'draft across windows');
    assert.equal(f.all().find(e => e.type === 'checkbox' && e.parent.className === 'gd-muyu-consent').checked, false);
    assert.equal(f.sent.length, 0); f.root.__gdMuyuDispose();
});

test('Settings are hidden initially; gear/back preserve draft input and clear unsent credentials', async () => {
    const f = fixture('zh', true), settings = f.all().find(e => e.className === 'gd-muyu-settings'), chat = f.all().find(e => e.className === 'gd-muyu-chat');
    assert.equal(settings.hidden, true);
    assert.equal(f.find('button', '配置连接').hidden, false);
    f.find('textarea').value = 'keep this draft'; f.find('textarea').oninput();
    await f.find('button', '配置连接').click(); assert.equal(settings.hidden, false); assert.equal(chat.hidden, true);
    const key = f.all().find(e => e.type === 'password'); key.value = 'unsent secret';
    await f.find('button', '返回聊天').click(); assert.equal(settings.hidden, true); assert.equal(key.value, '');
    assert.equal(f.find('textarea').value, 'keep this draft'); assert.equal(f.sent.length, 0);
    const gear = f.all().find(e => e.attrs['aria-label'] === '暮羽配置'); await gear.click(); assert.equal(settings.hidden, false);
    key.value = 'PRIVATE_TEST_KEY';
    await f.find('button', '启用此连接').click(); assert.equal(settings.hidden, true); assert.equal(chat.hidden, false);
    assert.equal(f.find('button', '配置连接').hidden, true); f.root.__gdMuyuDispose();
});

test('Send opens authorization without a model call; settings/target changes revoke confirmation', async () => {
    const f = fixture('zh', true); f.all().find(e => e.type === 'password').value = 'PRIVATE_TEST_KEY'; await f.find('button', '启用此连接').click();
    const auth = f.all().find(e => e.className === 'gd-muyu-authorization');
    const consent = f.all().find(e => e.type === 'checkbox' && e.parent.className === 'gd-muyu-consent');
    f.find('textarea').value = 'diagnose'; await f.find('button', '发送').click();
    assert.equal(auth.hidden, false); assert.equal(f.sent.length, 0);
    await f.find('button', '确认发送').click(); assert.equal(f.sent.length, 0);
    consent.checked = true; await f.find('button', '返回编辑').click(); assert.equal(auth.hidden, true); assert.equal(consent.checked, false);
    await f.find('button', '发送').click(); consent.checked = true;
    await f.all().find(e => e.attrs['aria-label'] === '暮羽配置').click(); assert.equal(auth.hidden, true); assert.equal(consent.checked, false);
    await f.find('button', '返回聊天').click(); await f.find('button', '发送').click(); consent.checked = true;
    f.state.viewToken++; f.emit(); assert.equal(auth.hidden, true); assert.equal(consent.checked, false); f.root.__gdMuyuDispose();
});

test('Task selector reveals field scope only for a draft request; messages have distinct bubble roles', async () => {
    const f = fixture('en', true); f.all().find(e => e.type === 'password').value = 'PRIVATE_TEST_KEY'; await f.find('button', 'Enable connection').click();
    const mode = f.all().find(e => e.tag === 'select' && e.parent.textContent === 'Task'); mode.value = 'draft'; await mode.onchange();
    assert.equal(f.find('fieldset').hidden, false);
    f.state.messages = [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }]; f.emit();
    assert.equal(f.all().filter(e => e.className === 'gd-muyu-message gd-muyu-user').length, 1);
    assert.equal(f.all().filter(e => e.className === 'gd-muyu-message gd-muyu-assistant').length, 1);
    mode.value = 'memory'; await mode.onchange(); assert.equal(f.find('fieldset').hidden, true); f.root.__gdMuyuDispose();
});

test('Process details stay collapsed by default and preserve expansion/scroll while progress updates', () => {
    const f = fixture('zh', true);
    const process = { phase: 'model.started', terminal: null, cleaned: false, rows: [], toolFailures: 0, dropped: 0, error: null };
    f.state.runs = [{ id: 'r1', process }]; f.state.messages = [{ role: 'user', runId: 'r1', content: 'test' }]; f.emit();
    const details = f.all().find(e => e.className === 'gd-muyu-process'); assert.ok(details); assert.ok(!details.open);
    details.open = true;
    const list = details.children.find(e => e.tag === 'ol'); list.scrollTop = 25;
    process.rows.push({ type: 'tool.started', attemptId: 1, tool: 'muyu.memory.inspect', durationMs: null, error: null });
    process.phase = 'tool.started'; f.emit();
    assert.equal(f.all().find(e => e.className === 'gd-muyu-process'), details); assert.equal(details.open, true); assert.equal(list.scrollTop, 25);
    assert.equal(list.children.at(-1).getAttribute('data-state'), 'running');
    process.terminal = 'cancelled'; process.phase = 'cancelled'; f.emit();
    assert.equal(list.children.at(-1).getAttribute('data-state'), 'neutral');
    assert.equal(details.open, true); assert.equal(list.scrollTop, 25);
    assert.match(details.children[0].textContent, /等待上游清理/);
    process.cleaned = true; f.emit(); assert.doesNotMatch(details.children[0].textContent, /等待上游清理/);
    f.state.viewToken++; f.state.runs = []; f.state.messages = []; f.emit(); assert.equal(f.all().find(e => e.className === 'gd-muyu-process'), undefined);
    f.root.__gdMuyuDispose();
});

test('Director selection changes permission wording and requires a current chat', async () => {
    const f = fixture('zh', true); f.all().find(e => e.type === 'password').value = 'PRIVATE_TEST_KEY'; await f.find('button', '启用此连接').click();
    const mode = f.all().find(e => e.tag === 'select' && e.parent.textContent === '任务');
    mode.value = 'director'; await mode.onchange();
    const label = f.all().find(e => e.className === 'gd-muyu-consent');
    assert.match(label.children.find(e => e.tag === 'span').textContent, /导演白名单/);
    assert.match(label.children.find(e => e.tag === 'span').textContent, /不含角色身份/);
    f.state.hasChat = false; f.emit(); assert.equal(f.find('button', '发送').disabled, true); f.root.__gdMuyuDispose();
});

test('Saved permission sends directly once, survives view remount and can be revoked from settings', async () => {
    const f = fixture('zh', true); f.state.enabled = true; f.state.permissions = { diagnostics: true, chat: false }; f.emit();
    f.find('textarea').value = 'no repeated checkbox'; await f.find('button', '发送').click();
    assert.equal(f.sent.length, 1); assert.equal(f.all().find(e => e.className === 'gd-muyu-authorization').hidden, true);
    f.state.busy = false; f.mount(); f.find('textarea').value = 'again'; await f.find('button', '发送').click(); assert.equal(f.sent.length, 2);
    const checkbox = f.all().find(e => e.type === 'checkbox' && e.parent.textContent?.startsWith('插件诊断信息'));
    checkbox.checked = false; await checkbox.onchange(); assert.equal(f.state.permissions.diagnostics, false);
});

test('Auto-enable defaults on, keeps credentials private, and can be switched off', async () => {
    const f = fixture('zh', true), remember = f.all().find(e => e.type === 'checkbox' && e.parent.textContent?.startsWith('记住 API'));
    const auto = f.all().find(e => e.type === 'checkbox' && e.parent.textContent?.startsWith('下次打开时自动'));
    assert.equal(remember.checked, true); assert.equal(auto.checked, true);
    f.all().find(e => e.type === 'password').value = 'SYNTHETIC'; await f.find('button', '启用此连接').click();
    assert.equal(f.configs[0].rememberKey, true); assert.equal(f.configs[0].autoConnect, true); assert.equal(f.all().find(e => e.type === 'password').value, '');
    f.state.savedConnection = { remembered: true, endpoint: 'https://saved.test/chat/completions', model: 'saved', thinking: true }; f.mount();
    assert.equal(f.all().find(e => e.type === 'password').value, ''); assert.equal(f.all().find(e => e.type === 'url').value, 'https://saved.test/chat/completions');
    assert.equal(f.all().find(e => e.type === 'checkbox' && e.parent.textContent?.startsWith('下次打开时自动')).checked, false);
    await f.find('button', '清除已保存密钥').click(); assert.equal(f.state.savedConnection, null);
});

test('Sending without a connection prompts for setup and keeps the unsent message', async () => {
    const f = fixture('zh', true, { initialMode: 'assistant' });
    const settings = f.all().find(e => e.className === 'gd-muyu-settings');
    const input = f.find('textarea'), send = f.find('button', '发送');
    assert.equal(send.disabled, false);
    const popup = [], previousToastr = globalThis.toastr;
    globalThis.toastr = { warning: value => popup.push(value) };
    try { input.value = '还没配置的提问'; await send.click(); }
    finally { globalThis.toastr = previousToastr; }
    assert.equal(settings.hidden, false); assert.match(f.all().find(e => e.attrs.role === 'alert').textContent, /消息已保留/);
    assert.equal(popup.length, 1);
    assert.equal(f.state.input, '还没配置的提问'); assert.equal(f.sent.length, 0);
    const key = f.all().find(e => e.type === 'password'); key.value = 'SYNTHETIC';
    f.controller.configure = () => { throw Error('CREDENTIAL_SAVE_FAILED'); };
    await f.find('button', '启用此连接').click(); assert.equal(key.value, 'SYNTHETIC'); assert.equal(input.value, '还没配置的提问');
    f.controller.configure = config => { f.configs.push(config); f.state.enabled = true; f.emit(); };
    await f.find('button', '启用此连接').click();
    assert.equal(settings.hidden, true); assert.equal(input.value, '还没配置的提问');
    f.root.__gdMuyuDispose();
});

test('Extended story context has its own opt-in control and scope summary', async () => {
    const f = fixture('zh', true); f.state.enabled = true; f.state.permissions = { chat: true, extended: false }; f.emit();
    const extended = f.all().find(e => e.type === 'checkbox' && e.parent.textContent?.startsWith('扩展剧情上下文'));
    assert.equal(extended.checked, false); extended.checked = true; await extended.onchange();
    assert.equal(f.state.permissions.extended, true); assert.match(f.all().find(e => e.className?.includes('gd-muyu-permission-summary')).textContent, /扩展剧情上下文/);
    f.state.hasChat = false; f.emit(); assert.equal(extended.disabled, true);
});

for (const lang of ['zh', 'en']) test('Unknown artifact cards stay inert and do not disrupt other cards / ' + lang, () => {
    const f = fixture(lang, true, { initialMode: 'assistant' });
    f.state.artifacts = [
        { id: 'unknown', kind: 'future-draft', revision: 1, content: {} },
        { id: 'report', kind: 'report', revision: 1, content: { findings: [{ kind: 'fact', text: 'Known evidence' }] } },
    ];
    assert.doesNotThrow(() => f.emit());
    const content = f.all().map(e => e.textContent).join('\n');
    assert.match(content, lang === 'en' ? /Unsupported artifact/ : /暂不支持的产物/);
    assert.match(content, /Known evidence/);
    assert.equal(f.find('button', lang === 'en' ? 'Revalidate' : '重新校验'), undefined);
    assert.equal(f.sent.length, 0); f.root.__gdMuyuDispose();
});
for (const lang of ['zh', 'en']) test('Unknown receipt version displays a safe notice without configuration shortcuts / ' + lang, () => {
    const f = fixture(lang, true, { initialMode: 'assistant' });
    f.state.receipts = [{ version: 999, operationId: 'unknown' }];
    assert.doesNotThrow(() => f.emit());
    assert.match(f.all().map(e => e.textContent).join('\n'), lang === 'en' ? /receipt version is not supported/ : /暂不支持显示此版本的回执/);
    assert.equal(f.find('button', lang === 'en' ? 'Ask Muyu to explain' : '让暮羽解释结果'), undefined);
    assert.equal(f.find('button', lang === 'en' ? 'Check current settings' : '核对当前配置'), undefined);
    assert.equal(f.sent.length, 0); f.root.__gdMuyuDispose();
});

test('Execution budget controls save units and preserve edits across progress renders', async () => {
    const f = fixture('zh', true);
    const modelCalls = f.all().find(e => e.type === 'number' && e.parent.textContent === '模型调用次数');
    const timeout = f.all().find(e => e.type === 'number' && e.parent.textContent === '单轮超时（秒）');
    assert.equal(modelCalls.value, '12'); assert.equal(timeout.value, '300'); assert.equal(timeout.max, 1800);
    modelCalls.value = '10'; timeout.value = '60'; f.emit(); assert.equal(modelCalls.value, '10');
    await f.find('button', '保存运行预算').click(); assert.equal(f.state.runConfig.modelCalls, 10); assert.equal(f.state.runConfig.timeMs, 60000);
    await f.find('button', '恢复默认预算并保存').click(); assert.equal(modelCalls.value, '12'); assert.equal(timeout.value, '300');
    modelCalls.value = '1.5'; await f.find('button', '保存运行预算').click(); assert.equal(f.state.runConfig.modelCalls, 12);
});
