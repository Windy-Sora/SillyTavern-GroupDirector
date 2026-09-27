import { HISTORY_LIMITS } from '../sessions/contract.js';

/** Explicit inline confirmations; no business operation is inferred from model text. */
export function createHistoryActions({ doc, importRoot, exportRoot, parent, controller, act, t }) {
    const node = (tag, text, owner) => { const el = doc.createElement(tag); el.textContent = text; owner.append(el); return el; };
    const button = (label, owner) => { const el = node('button', label, owner); el.type = 'button'; el.className = 'menu_button'; return el; };
    const form = node('section', '', parent); form.className = 'gd-muyu-history-confirm'; form.hidden = true;
    const prompt = node('p', '', form), label = node('label', t('对话标题', 'Conversation title'), form), title = node('input', '', label);
    title.type = 'text'; title.className = 'text_pole'; title.maxLength = 100;
    const confirm = button(t('确认', 'Confirm'), form), cancel = button(t('取消', 'Cancel'), form);
    let command = null, pending = false, disposed = false, importText = null, fileEpoch = 0;
    const close = () => { command = null; form.hidden = true; if (!disposed) parent.querySelector?.('button')?.focus(); };
    form.onkeydown = event => { if (event.key === 'Escape' && !pending) { event.preventDefault(); event.stopPropagation(); close(); } };
    cancel.onclick = close;
    confirm.onclick = () => act(async () => {
        if (!command || pending) return;
        const selected = command; pending = true; confirm.disabled = cancel.disabled = true;
        try {
            if (selected.action === 'rename') await controller.renameSession(selected.id, title.value);
            else if (selected.action === 'remove') await controller.deleteSession(selected.id);
            else await controller.archiveSession(selected.id, selected.value);
            close();
        } finally { pending = false; confirm.disabled = cancel.disabled = false; }
    });
    function download(format) {
        const text = controller.exportHistory(format), url = URL.createObjectURL(new Blob([text], { type: format === 'markdown' ? 'text/markdown;charset=utf-8' : 'application/json' }));
        try { const a = doc.createElement('a'); a.href = url; a.download = format === 'markdown' ? 'muyu-conversation.md' : 'muyu-conversation.json'; a.click(); }
        finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
    }
    const exportJSON = button(t('导出当前对话 JSON', 'Export current conversation JSON'), exportRoot);
    const exportMD = button(t('导出当前对话 Markdown', 'Export current conversation Markdown'), exportRoot);
    exportJSON.onclick = () => act(() => download('json')); exportMD.onclick = () => act(() => download('markdown'));
    const importer = node('details', '', importRoot); node('summary', t('导入只读备份', 'Import read-only backup'), importer);
    node('p', t('最多 2 MiB 的单会话 JSON。保留原始归属说明，生成新记录；不会覆盖已有对话、恢复授权或调用模型。', 'One conversation JSON, up to 2 MiB. Preserves original scope as a new record; never overwrites, restores grants or calls a model.'), importer);
    const fileLabel = node('label', t('选择 JSON 文件', 'Choose JSON file'), importer), file = node('input', '', fileLabel); file.type = 'file'; file.accept = '.json,application/json';
    const preview = node('p', '', importer), accept = button(t('确认导入只读备份', 'Confirm read-only import'), importer), discard = button(t('取消导入', 'Cancel import'), importer);
    accept.disabled = true; const clearImport = () => { fileEpoch++; importText = null; preview.textContent = ''; file.value = ''; accept.disabled = true; };
    discard.onclick = clearImport;
    file.onchange = () => act(async () => {
        const selected = file.files?.[0]; clearImport(); const epoch = fileEpoch;
        if (!selected) return;
        if (selected.size > HISTORY_LIMITS.recordBytes) throw Error('HISTORY_CAPACITY');
        const text = await selected.text(); if (disposed || epoch !== fileEpoch) return;
        const info = controller.previewHistoryImport(text);
        preview.textContent = `${info.title || t('未命名', 'Untitled')} · ${info.messages} ${t('条消息', 'messages')} · ${info.bytes} bytes\n${t('原始范围：', 'Original scope: ')}${info.scope}`;
        importText = text; accept.disabled = false;
    });
    accept.onclick = () => act(async () => {
        if (importText === null || pending) return;
        pending = true; accept.disabled = true;
        try { await controller.importHistory(importText); clearImport(); }
        finally { pending = false; if (importText !== null) accept.disabled = false; }
    });
    return {
        export(format) { download(format); },
        show(action) {
            const s = controller.snapshot(), h = s.history; if (!h?.sessionId || s.resetting || pending) return;
            command = { id: h.sessionId, action, value: !h.selected?.archived }; form.hidden = false;
            label.hidden = action !== 'rename'; title.value = h.selected?.title || '';
            if (action === 'rename') prompt.textContent = t('修改当前对话标题（1–100 字符）', 'Rename this conversation (1–100 characters)');
            else {
                const stopping = s.busy && !s.occupiedElsewhere;
                prompt.textContent = (stopping ? t('先停止此会话任务并等待清理，然后', 'Stop this conversation and wait for cleanup, then ') : '') + (action === 'remove'
                    ? h.persisted ? t('删除本浏览器中已保存的这条记录及本页副本？无法撤销，建议先导出。不会删除酒馆聊天。', 'delete this saved browser record and its working copy? This cannot be undone; export first. ST chat is unaffected.') : t('删除这条临时记录？无法撤销，不影响酒馆聊天。', 'delete this temporary record? This cannot be undone; ST chat is unaffected.')
                    : command.value ? t('归档此对话？仍占存储容量，可恢复。', 'archive this conversation? Storage is retained; it can be restored.') : t('恢复此归档对话？导入备份仍为只读。', 'restore this archived conversation? Imported backups remain read-only.'));
            }
            (action === 'rename' ? title : confirm).focus?.();
        },
        render(s) {
            if (command && command.id !== s.history?.sessionId && !pending) close();
            confirm.disabled = cancel.disabled = pending || s.resetting;
            exportJSON.disabled = exportMD.disabled = !s.history?.sessionId;
            file.disabled = discard.disabled = s.resetting || pending;
            accept.disabled = importText === null || s.resetting || pending;
        },
        dispose() { disposed = true; clearImport(); close(); },
    };
}
