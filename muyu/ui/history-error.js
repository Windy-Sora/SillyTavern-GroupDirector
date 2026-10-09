/** Closed messages only: never display server bodies or raw exception messages. */
export function historyErrorLabel(code, lang) {
    const labels = {
        HISTORY_UNAVAILABLE: ['对话存储暂不可用，请检查服务插件或浏览器存储权限，再重试保存；本页对话保留，刷新前请导出备份。', 'Conversation storage is unavailable. Check the service plugin or browser storage permissions, then retry saving. This page retains the conversation; export a backup before reloading.'],
        HISTORY_SETTINGS_FAILED: ['自动保存或存储选项未能确认保存，仍使用原设置；请检查酒馆连接后重新切换该选项。已有记录未删除。', 'The auto-save or storage preference was not confirmed saved; previous settings remain active. Check the ST connection and change the option again. Existing records were not deleted.'],
        HISTORY_IDENTITY_UNAVAILABLE: ['无法确认当前酒馆账户，未访问其他账户记录。请检查登录状态；刷新前导出本页对话。', 'The ST account could not be verified; no other account records were accessed. Check login status and export this conversation before reloading.'],
        HISTORY_SAVE_FAILED: ['对话保存失败，本页内容保留。请检查存储权限与空间后重试保存；刷新前导出备份。', 'Conversation save failed; this page retains the content. Check storage permissions and space, then retry saving. Export a backup before reloading.'],
        HISTORY_CONFLICT: ['记录已被另一标签页更新，未覆盖；请先导出本页内容，再刷新核对。', 'Another tab updated the record; it was not overwritten. Export this page before reloading to compare.'],
        HISTORY_DELETED: ['记录已被另一标签页删除，未重新创建；请先导出本页内容，再刷新核对。', 'Another tab deleted the record; it was not recreated. Export this page before reloading to compare.'],
        HISTORY_VERSION: ['存档版本暂不支持，未改写记录；请更新插件并先导出本页备份。', 'The archive version is unsupported; records were not rewritten. Update the plugin and export this page first.'],
        HISTORY_INVALID: ['存档格式校验未通过，未覆盖或清除记录；请保留原件并导出本页备份。', 'Archive validation failed; records were not overwritten or cleared. Keep the originals and export this page.'],
    };
    const text = Object.hasOwn(labels, code) ? labels[code] : null;
    return text ? `${text[lang === 'en' ? 1 : 0]} (${code})` : null;
}
