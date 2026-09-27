/** Stable settings pages: navigation never remounts editors or starts work. */
export function createSettingsLayout({ doc, root, lang }) {
    const en = lang === 'en';
    const nav = doc.createElement('nav'); nav.className = 'gd-muyu-settings-nav';
    nav.setAttribute('aria-label', en ? 'Settings categories' : '配置分类'); root.append(nav);
    const content = doc.createElement('div'); content.className = 'gd-muyu-settings-content'; root.append(content);
    const pages = {}, buttons = {};
    for (const [id, zh, english, description] of [
        ['connection', '模型连接', 'Connection', en ? 'Choose the service used for your requests.' : '配置暮羽使用的模型服务。'],
        ['data', '资料与历史', 'Data & history', en ? 'Control shared data and local conversation storage.' : '管理可读取资料，以及本地对话保存。'],
        ['behavior', '行为偏好', 'Behavior', en ? 'Customize response style, without changing permissions.' : '定制回答方式，不改变工具权限。'],
        ['limits', '运行预算', 'Budgets', en ? 'Manage input context and per-run limits.' : '管理输入上下文和每轮执行上限。'],
    ]) {
        const button = doc.createElement('button'); button.type = 'button'; button.className = 'menu_button'; button.textContent = en ? english : zh;
        nav.append(button); buttons[id] = button;
        const page = doc.createElement('section'); page.className = 'gd-muyu-settings-page'; page.setAttribute('aria-label', button.textContent);
        const hint = doc.createElement('p'); hint.className = 'gd-muyu-settings-hint'; hint.textContent = description; page.append(hint);
        content.append(page); pages[id] = page; button.onclick = () => select(id);
    }
    function select(id) {
        if (!pages[id]) return;
        for (const key of Object.keys(pages)) {
            pages[key].hidden = key !== id;
            buttons[key].setAttribute('aria-current', key === id ? 'page' : 'false');
        }
    }
    select('connection');
    return { pages, select };
}
