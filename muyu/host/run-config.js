import { RUN_DEFAULTS, validateRunConfig } from '../core/budget.js';
import { createBudgetConfigStore } from './budget-config.js';
export function createRunConfigStore({ getSettings, saveSettings }) {
    return createBudgetConfigStore({ getSettings, saveSettings, key: 'muyuRunConfig', versionKey: 'muyuRunBudgetVersion',
        defaults: RUN_DEFAULTS, validate: validateRunConfig, errorCode: 'RUN_CONFIG_SAVE_FAILED',
        legacy: value => value.modelCalls === 6 && value.toolCalls === 16 && value.timeMs === 120000 && value.maxTokens === 8192 && [24000, 1000000].includes(value.providerBytes) });
}
