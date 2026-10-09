import { createServiceDiagnosticsView } from './service-diagnostics-view.js';
/** Local status only; deliberately not an Agent tool or permission grant. */
export function createServiceStatusView({ doc, parent, controller, lang }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const node = (tag, text) => { const el = doc.createElement(tag); el.textContent = text; parent.append(el); return el; };
    const output = node('p', t('尚未检查服务版本与能力。', 'Service version and capabilities not checked.')); output.setAttribute('role', 'status');
    const actions = node('div', ''); actions.className = 'gd-muyu-actions';
    const check = doc.createElement('button'); check.textContent = t('检查服务能力', 'Check service capabilities'); actions.append(check);
    const storage = doc.createElement('button'); storage.textContent = t('测试历史存储（写入临时文件）', 'Test history storage (writes a temporary file)'); actions.append(storage);
    for (const button of [check, storage]) { button.type = 'button'; button.className = 'menu_button'; }
    node('small', t('自检只在点击后写入、读取并清理独立临时文件，不修改对话。不验证磁盘剩余空间、搜索密钥或其他酒馆功能。', 'On click, the test writes, reads and removes an isolated temporary file; conversations are untouched. It does not verify free disk space, search keys or other ST features.'));
    const errors = {
        HISTORY_IDENTITY_UNAVAILABLE: t('未取得有效账户目录，请检查服务插件并重启酒馆。', 'No valid account directory. Check the service and restart ST.'),
        SERVICE_STORAGE_PERMISSION: t('没有存储写入权限，请检查服务器目录权限。', 'Storage access denied. Check server directory permissions.'),
        SERVICE_STORAGE_FULL: t('写入时磁盘空间不足。', 'Disk space was insufficient during the write.'),
        SERVICE_STORAGE_UNAVAILABLE: t('存储自检失败，请检查服务器存储。', 'Storage test failed. Check server storage.'),
        SERVICE_INCOMPATIBLE: t('检测协议不兼容，请更新服务并重启酒馆。', 'Incompatible check protocol. Update the service and restart ST.'),
        SERVICE_CHECK_BUSY: t('本账户已有自检正在运行，请稍后重试。', 'A storage check is already running for this account. Try again later.'),
    };
    let busy = false, disposed = false, state = null;
    const diagnosticsView = createServiceDiagnosticsView({ doc, parent, controller, lang });
    function render() {
        const s = controller.snapshot();
        check.disabled = busy || !!s.busy || !!s.resetting;
        storage.disabled = check.disabled || state?.status !== 'available' || !state.capabilities.storageCheck;
        diagnosticsView.render(state?.status === 'available' && state.capabilities.diagnostics === true, check.disabled);
    }
    async function run(action) {
        if (disposed || busy || controller.snapshot().busy || controller.snapshot().resetting) return;
        busy = true; render(); output.textContent = t('正在检查…', 'Checking…');
        try { const text = await action(); if (!disposed) output.textContent = text; }
        catch (error) { if (!disposed) output.textContent = errors[error?.message] || t('服务检查暂不可用，请检查酒馆连接后重试。', 'Service check unavailable. Check the ST connection and retry.'); }
        finally { busy = false; if (!disposed) render(); }
    }
    check.onclick = () => run(async () => {
        state = null;
        const result = await controller.checkServices(); if (disposed) return ''; state = result;
        if (result.status !== 'available') return ({ legacy: t('旧版服务已加载；原有功能不变。更新并重启后可检查能力与存储。', 'Legacy service loaded; existing features are unchanged. Update and restart for capability/storage checks.'),
            missing: t('未发现服务：可能未安装、未启用或未重启。无需服务也可正常聊天与保存到浏览器／账户设置。', 'Service not found: missing, disabled or restart required. Chat and browser/account-settings storage remain usable.'),
            incompatible: errors.SERVICE_INCOMPATIBLE }[result.status] || errors.SERVICE_INCOMPATIBLE);
        const yes = t('支持', 'supported'), no = t('不支持', 'unsupported');
        return t('服务版本', 'Service version') + ': ' + result.serviceVersion + ' · ' +
            t('文件历史', 'File history') + ': ' + (result.capabilities.history ? yes : no) + ' · ' +
            t('搜索', 'Search') + ': ' + (result.capabilities.search ? yes : no) + '\n' +
            t('每命名空间容量：', 'Per-namespace limits: ') + result.limits.records + t('份对话', ' conversations') + ' / ' + (result.limits.totalBytes / 1048576) + ' MiB · ' +
            t('每份', 'Each') + ' ' + (result.limits.recordBytes / 1048576) + ' MiB / ' + result.limits.messages + t('条消息；存储写入尚未测试。', ' messages; storage writes not yet tested.');
    });
    storage.onclick = () => {
        if (storage.disabled || disposed) return;
        return run(async () => {
            const result = await controller.checkServiceStorage();
            if (result.status === 'ok') return t('自检通过：临时文件写入、读回与清理成功。不代表已有对话已保存或未来写入必然成功。', 'Test passed: temporary write, read-back and cleanup succeeded. This does not confirm existing conversations are saved or guarantee future writes.');
            return (errors[result.error] || errors.SERVICE_STORAGE_UNAVAILABLE) + ' · ' + t('失败阶段', 'Failed stage') + ': ' +
                ({ prepare: t('准备目录', 'prepare directory'), write: t('写入', 'write'), read: t('读回', 'read'), cleanup: t('清理', 'cleanup') }[result.stage] || t('未知', 'unknown')) +
                (result.cleanup === 'failed' ? t(' · 临时文件未清理成功，请检查服务端目录权限。', ' · Temporary cleanup failed; check server permissions.') : '');
        });
    };
    render(); return { render, dispose() { disposed = true; diagnosticsView.dispose(); } };
}
