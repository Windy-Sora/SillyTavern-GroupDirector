export function createCritiqueRepository({ getChatMetadata, EXT_KEY, saveChatConditional }) {
    const revisions = new WeakMap();

    function getRevision(entry) {
        return entry && typeof entry === 'object' ? revisions.get(entry) || 0 : 0;
    }

    function bumpRevision(entry) {
        if (entry && typeof entry === 'object') revisions.set(entry, getRevision(entry) + 1);
    }

    function getCritiques(metadata = getChatMetadata()) {
        if (!metadata[EXT_KEY] || typeof metadata[EXT_KEY] !== 'object' || Array.isArray(metadata[EXT_KEY])) {
            metadata[EXT_KEY] = {};
        }
        if (!Array.isArray(metadata[EXT_KEY].critiques)) metadata[EXT_KEY].critiques = [];
        return metadata[EXT_KEY].critiques;
    }

    function getLatestActive(metadata = getChatMetadata()) {
        const critiques = getCritiques(metadata);
        for (let index = critiques.length - 1; index >= 0; index--) {
            if (critiques[index]?.active) return critiques[index];
        }
        return null;
    }

    async function add(entry, metadata = getChatMetadata()) {
        const critiques = getCritiques(metadata);
        const previousFlags = critiques.map(item => item?.active);
        for (const item of critiques) {
            if (item && typeof item === 'object') {
                if (item.active) bumpRevision(item);
                item.active = false;
            }
        }
        critiques.push(entry);
        try { await saveChatConditional(); }
        catch (error) {
            critiques.pop();
            critiques.forEach((item, index) => { if (item && typeof item === 'object') item.active = previousFlags[index]; });
            throw error;
        }
        return entry;
    }

    async function update(entry, updates) {
        const previous = {};
        for (const key of Object.keys(updates)) previous[key] = entry[key];
        bumpRevision(entry);
        Object.assign(entry, updates);
        try { await saveChatConditional(); }
        catch (error) { Object.assign(entry, previous); throw error; }
        return entry;
    }

    async function revert(metadata = getChatMetadata()) {
        const critiques = getCritiques(metadata);
        let foundIndex = -1;
        for (let index = critiques.length - 1; index >= 0; index--) {
            if (critiques[index]?.active) { foundIndex = index; break; }
        }
        if (foundIndex < 0) return false;
        const previousFlags = critiques.map(item => item?.active);
        const target = critiques[foundIndex];
        bumpRevision(target);
        target.active = false;
        if (Number.isInteger(target.basedOn) && target.basedOn >= 0 && target.basedOn < foundIndex && critiques[target.basedOn]) {
            bumpRevision(critiques[target.basedOn]);
            critiques[target.basedOn].active = true;
        }
        try { await saveChatConditional(); }
        catch (error) {
            critiques.forEach((item, index) => { if (item && typeof item === 'object') item.active = previousFlags[index]; });
            throw error;
        }
        return true;
    }

    async function reset(metadata = getChatMetadata()) {
        const critiques = getCritiques(metadata);
        const previousFlags = critiques.map(item => item?.active);
        for (const item of critiques) {
            if (item && typeof item === 'object') {
                if (item.active) bumpRevision(item);
                item.active = false;
            }
        }
        try { await saveChatConditional(); }
        catch (error) {
            critiques.forEach((item, index) => { if (item && typeof item === 'object') item.active = previousFlags[index]; });
            throw error;
        }
    }

    async function prune(chatLength, metadata = getChatMetadata()) {
        const critiques = getCritiques(metadata);
        const previousFlags = critiques.map(item => item?.active);
        let changed = false;
        for (let index = critiques.length - 1; index >= 0; index--) {
            const item = critiques[index];
            if (item?.active && Number(item.rangeEnd) > chatLength) {
                bumpRevision(item);
                item.active = false;
                changed = true;
                if (Number.isInteger(item.basedOn) && item.basedOn >= 0 && item.basedOn < index && critiques[item.basedOn]) {
                    bumpRevision(critiques[item.basedOn]);
                    critiques[item.basedOn].active = true;
                }
            }
        }
        if (!changed) return false;
        try { await saveChatConditional(); }
        catch (error) {
            critiques.forEach((item, index) => { if (item && typeof item === 'object') item.active = previousFlags[index]; });
            throw error;
        }
        return true;
    }

    return { getCritiques, getLatestActive, getRevision, add, update, revert, reset, prune };
}
