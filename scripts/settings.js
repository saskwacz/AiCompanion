import { dbGet, dbPut } from './db.js';

export const PROVIDER_NAMES = ['gemini', 'mistral', 'groq', 'openrouter', 'openai', 'claude', 'ollama'];

/**
 * Global settings contain only:
 *  - API keys per provider (shared starting point for new chats)
 *  - Ollama base URL (default for new chats)
 *  - Default providers for chat / memory / summary / embed (new chats)
 *  - UI preferences (font size, debug)
 *
 * All per-chat model/parameter settings live in chat.config (see chats.js).
 */
const DEFAULTS = {
    apiKeys:        [],
    mistralApiKeys: [],
    groqApiKeys:        [],
    openrouterApiKeys:  [],
    openaiApiKeys:      [],
    claudeApiKeys:      [],
    ollamaBaseUrl:  'http://localhost:11434',
    defaultChatProvider:    'gemini',
    defaultMemoryProvider:  'gemini',
    defaultSummaryProvider: 'gemini',
    defaultEmbedProvider:   'gemini',
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

/**
 * Return a shuffled copy of Gemini API keys from a settings or chat-config object.
 */
export function getShuffledApiKeys(cfg) {
    const keys = ((cfg?.apiKeys) || []).filter(k => k.key).slice();
    for (let i = keys.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [keys[i], keys[j]] = [keys[j], keys[i]];
    }
    return keys;
}

/**
 * Return a shuffled copy of Mistral API keys from a settings or chat-config object.
 */
export function getShuffledMistralApiKeys(cfg) {
    const keys = ((cfg?.mistralApiKeys) || []).filter(k => k.key).slice();
    for (let i = keys.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [keys[i], keys[j]] = [keys[j], keys[i]];
    }
    return keys;
}

/**
 * Return a shuffled copy of OpenAI API keys from a settings or chat-config object.
 */
export function getShuffledOpenaiApiKeys(cfg) {
    const keys = ((cfg?.openaiApiKeys) || []).filter(k => k.key).slice();
    for (let i = keys.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [keys[i], keys[j]] = [keys[j], keys[i]];
    }
    return keys;
}

/**
 * Return a shuffled copy of Claude API keys from a settings or chat-config object.
 */
export function getShuffledClaudeApiKeys(cfg) {
    const keys = ((cfg?.claudeApiKeys) || []).filter(k => k.key).slice();
    for (let i = keys.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [keys[i], keys[j]] = [keys[j], keys[i]];
    }
    return keys;
}

/**
 * Return a shuffled copy of OpenRouter API keys from a settings or chat-config object.
 */
export function getShuffledOpenRouterApiKeys(cfg) {
    const keys = ((cfg?.openrouterApiKeys) || []).filter(k => k.key).slice();
    for (let i = keys.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [keys[i], keys[j]] = [keys[j], keys[i]];
    }
    return keys;
}

/**
 * Return a shuffled copy of Groq API keys from a settings or chat-config object.
 */
export function getShuffledGroqApiKeys(cfg) {
    const keys = ((cfg?.groqApiKeys) || []).filter(k => k.key).slice();
    for (let i = keys.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [keys[i], keys[j]] = [keys[j], keys[i]];
    }
    return keys;
}
