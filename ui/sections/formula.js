function bindNum(sel, setter, min, def) {
    $(sel).on('input', function () {
        const raw = parseInt($(this).val(), 10);
        setter(isNaN(raw) ? def : Math.max(min, raw));
        saveSettings();
    });
}
function bindChk(sel, setter) {
    $(sel).on('input', function () { setter(!!$(this).prop('checked')); saveSettings(); });
}

let saveSettings;

export function initFormula(settings, $c, _save) {
    saveSettings = _save;

    $c('topn').val(settings.topN);
    $c('recent-count').val(settings.recentMessageCount);
    $c('consecutive-penalty').val(settings.consecutivePenalty);
    $c('trigger-enabled').prop('checked', settings.triggerEnabled);
    $c('trigger-score').val(settings.triggerScore);
    $c('initiative-enabled').prop('checked', settings.initiativeEnabled);
    $c('initiative-base').val(settings.initiativeBaseScore);
    $c('mention-weight').val(settings.scoreWeights.mention);
    $c('keyword-weight').val(settings.scoreWeights.keyword);
    $c('recency-weight').val(settings.scoreWeights.recency);
    $c('talkativeness-weight').val(settings.scoreWeights.talkativeness);

    bindNum('#gd-topn',               v => settings.topN = v, 1, 1);
    bindNum('#gd-recent-count',       v => settings.recentMessageCount = v, 1, 10);
    bindNum('#gd-consecutive-penalty', v => settings.consecutivePenalty = v, 0, 15);
    bindChk('#gd-trigger-enabled',    v => settings.triggerEnabled = v);
    bindNum('#gd-trigger-score',      v => settings.triggerScore = v, 0, 40);
    bindChk('#gd-initiative-enabled', v => settings.initiativeEnabled = v);
    bindNum('#gd-initiative-base',    v => settings.initiativeBaseScore = v, 0, 5);
    bindNum('#gd-mention-weight',     v => settings.scoreWeights.mention = v, 0, 30);
    bindNum('#gd-keyword-weight',     v => settings.scoreWeights.keyword = v, 0, 15);
    bindNum('#gd-recency-weight',     v => settings.scoreWeights.recency = v, 0, 20);
    bindNum('#gd-talkativeness-weight', v => settings.scoreWeights.talkativeness = v, 1, 10);
}