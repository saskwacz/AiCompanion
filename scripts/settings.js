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
