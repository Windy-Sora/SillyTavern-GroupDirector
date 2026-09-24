import { registerSection } from './registry.js';
import { createHostBridge } from '../../muyu/host/bridge.js';
import { createMuyuController } from '../../muyu/application/controller.js';
import { mountMuyuPanel } from '../../muyu/ui/panel.js';

// deps survives reloadSettingsUI; the section owns only the disposable view.
registerSection('muyu', ctx => {
    const root = document.getElementById('gd-muyu-root'); if (!root || !ctx.muyuOwner) return;
    const owner = ctx.muyuOwner;
    if (!owner.controller) {
        const host = createHostBridge({ getContext: ctx.getContext, getSettings: () => ctx.settings, extensionKey: ctx.EXT_KEY, getGuards: ctx.getMuyuGuards });
        owner.controller = createMuyuController({ host });
        window.addEventListener('pagehide', event => {
            if (!event.persisted) void owner.controller.dispose().catch(() => {});
        });
    }
    owner.refreshView = () => mountMuyuPanel(root, owner.controller, { lang: ctx.settings.lang, navigateMemory: () => {
        const control = document.getElementById('gd-memory-enabled'); if (!control) return;
        const content = control.closest('.inline-drawer')?.querySelector('.inline-drawer-content'); if (content) content.style.display = 'block';
        control.scrollIntoView({ block: 'center', behavior: 'smooth' }); control.focus();
    } });
    owner.refreshView();
});
