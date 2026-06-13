import { dbGet, dbPut } from './db.js';

const DEFAULTS = {
    temperature:   0.7,
    maxTokens:     8192,
    contextTokens: 2000,
    memoryTokens:  8192,
    summaryTokens: 8192,
    summaryEvery:  10,
    chatFontSize:  14,
    // Gemini keys
    apiKeys:       [],
    apiKeyIndex:   0,
    chatProvider:    'gemini',
    memoryProvider:  'gemini',
    summaryProvider: 'gemini',
    debugPrompts:  false,
};

export async function loadSettings() {
    const result = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) {
        const r = await dbGet('settings', key);
        if (r !== null) result[key] = r.value;
    }
    if (result.chatProvider === 'groq')    result.chatProvider    = 'gemini';
    if (result.memoryProvider === 'groq')  result.memoryProvider  = 'gemini';
    if (result.summaryProvider === 'groq') result.summaryProvider = 'gemini';
    return result;
}

export async function persistSettings(s) {
    for (const [key, value] of Object.entries(s)) {
        await dbPut('settings', { key, value });
    }
}

/**
 * Returns all API keys in random order as {label, key} objects.
 * Call sites should try each in sequence and fall back on error.
 */
export function getShuffledApiKeys(s) {
    const keys = (s.apiKeys || []).filter(k => k.key).slice();
    for (let i = keys.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [keys[i], keys[j]] = [keys[j], keys[i]];
    }
    return keys;
}

