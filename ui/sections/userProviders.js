import { registerSection } from './registry.js';

registerSection('userProviders', function (ctx) {
    const { settings, toastr, userProviderLoader } = ctx;
    if (!userProviderLoader) return;
    const lang = settings.lang || 'zh';
    const L = (zh, en) => lang === 'zh' ? zh : en;

    const $list = $('#gd-user-provider-list');
    if (!$list.length) return;

    function renderList() {
        const providers = userProviderLoader.listProviders();
        if (!providers.length) {
            $list.html(`<small style="color:var(--grey70a);">${L('暂无导入的 Provider', 'No imported providers')}</small>`);
            return;
        }
        let html = '';
        providers.forEach(p => {
            const time = new Date(p.importedAt).toLocaleString();
            html += `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--SmartThemeBorderColor);">
                    <span><b>${esc(p.name)}</b> <span style="font-size:0.8em;color:var(--grey70a);">${time}</span></span>
                    <span class="menu_button menu_button_icon gd-user-provider-delete" data-name="${esc(p.name)}" style="font-size:0.75em;color:#ff5555;"><i class="fa-solid fa-trash"></i></span>
                </div>`;
        });
        $list.html(html);

        $list.find('.gd-user-provider-delete').on('click', async function () {
            const name = $(this).data('name');
            if (confirm(L(`删除 Provider "${name}"？重启后生效。`, `Delete provider "${name}"? Takes effect after reload.`))) {
                await userProviderLoader.deleteProvider(name);
                renderList();
                toastr.info(L(`已删除 "${name}"，重启后生效`, `Deleted "${name}", reload to apply`));
            }
        });
    }

    $('#gd-user-provider-import').on('click', () => {
        $('#gd-user-provider-file').trigger('click');
    });

    $('#gd-user-provider-file').on('change', async function () {
        const file = this.files?.[0];
        if (!file) return;
        const btn = $('#gd-user-provider-import');
        btn.prop('disabled', true);
        try {
            const result = await userProviderLoader.importProvider(file);
            if (result.ok) {
                toastr.success(L(`Provider "${result.name}" 已导入并注册`, `Provider "${result.name}" imported and active`));
                renderList();
            } else {
                toastr.error((L('导入失败', 'Import failed') + ': ') + (result.error || ''));
            }
        } catch (e) {
            toastr.error(L('导入出错: ' + e.message, 'Import error: ' + e.message));
        }
        btn.prop('disabled', false);
        $(this).val('');
    });

    function esc(s) {
        if (!s) return '';
        const div = document.createElement('div');
        div.textContent = String(s);
        return div.innerHTML;
    }

    renderList();
});
