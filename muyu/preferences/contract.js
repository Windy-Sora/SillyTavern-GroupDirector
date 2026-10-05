/** Presentation preferences are never instructions, permissions or run budgets. */
export const DISPLAY_DEFAULTS = Object.freeze({ processDetail: 'compact' });
export const PROCESS_DETAILS = Object.freeze(['compact', 'standard', 'detailed', 'verbose']);
export function validateDisplayConfig(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => key !== 'processDetail') || !PROCESS_DETAILS.includes(value.processDetail)) throw Error('DISPLAY_CONFIG_INVALID');
    return { processDetail: value.processDetail };
}
