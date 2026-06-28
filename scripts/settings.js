import { dbGet, dbPut } from './db.js';

export const PROVIDER_NAMES = ['mistral'];

const DEFAULTS = {
    mistralApiKeys: [],
    lastCharacterId: null,
    lastChatId:     null,
    chatFontSize:   14,
    debugPrompts:   false,
};

export async function loadSettings() {
    const result = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) {
        const r = await dbGet('settings', key);
        if (r !== null) result[key] = r.value;
    }
    return result;
}

export async function persistSettings(s) {
    for (const [key, value] of Object.entries(s)) {
        await dbPut('settings', { key, value });
    }
}

/** Return configured keys in stable order; per-request rotation is in mistral.js. */
export function getShuffledMistralApiKeys(cfg) {
    return ((cfg?.mistralApiKeys) || []).filter(k => k.key).slice();
}

/** Normalize key objects for export/import. */
export function normalizeMistralApiKeys(keys) {
    if (!Array.isArray(keys)) return [];
    return keys.map(k => {
        if (typeof k === 'string') {
            return { label: 'Imported', key: k.trim() };
        }
        return {
            label: String(k?.label || '').trim() || 'Key',
            key:   String(k?.key || '').trim(),
        };
    }).filter(k => k.key);
}

/** Merge incoming keys without duplicates (by key value). */
export function mergeMistralApiKeys(existing, incoming) {
    const out  = normalizeMistralApiKeys(existing);
    const seen = new Set(out.map(k => k.key));
    for (const k of normalizeMistralApiKeys(incoming)) {
        if (seen.has(k.key)) continue;
        out.push(k);
        seen.add(k.key);
    }
    return out;
}
