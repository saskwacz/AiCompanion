/**
 * gemini-models.js
 *
 * Source of truth for all Gemini model identifiers, UI catalogues,
 * and the default per-chat configuration when Gemini is chosen.
 */

// ─── Internal model name constants ─────────────────────────────────────────────
export const GEMINI_MODELS = {
    CHAT_PRIMARY:    'gemini-3.5-flash',
    CHAT_FALLBACK:   'gemini-3.1-flash-lite',
    MEMORY_PRIMARY:  'gemini-3-flash-preview',
    MEMORY_FALLBACK: 'gemini-3.1-flash-lite',
    SUMMARY:         'gemini-3.1-flash-lite',
    EMBEDDING:       'gemini-embedding-2',
};

// ─── UI catalogues ─────────────────────────────────────────────────────────────

export const GEMINI_CHAT_LIST = [
    { id: 'gemini-3.5-flash',           label: 'Gemini 3.5 Flash (domyślny)' },
    { id: 'gemini-3.1-flash-lite',      label: 'Gemini 3.1 Flash Lite' },
    { id: 'gemini-2.5-flash',           label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.0-flash',           label: 'Gemini 2.0 Flash' },
    { id: 'gemini-2.0-flash-lite',      label: 'Gemini 2.0 Flash Lite' },
    { id: 'gemini-1.5-pro',             label: 'Gemini 1.5 Pro' },
    { id: 'gemini-1.5-flash',           label: 'Gemini 1.5 Flash' },
];

export const GEMINI_MEMORY_LIST = [
    { id: 'gemini-3-flash-preview',     label: 'Gemini 3 Flash Preview (domyślny)' },
    { id: 'gemini-3.5-flash',           label: 'Gemini 3.5 Flash' },
    { id: 'gemini-3.1-flash-lite',      label: 'Gemini 3.1 Flash Lite' },
    { id: 'gemini-2.0-flash',           label: 'Gemini 2.0 Flash' },
    { id: 'gemini-1.5-flash',           label: 'Gemini 1.5 Flash' },
];

export const GEMINI_SUMMARY_LIST = [
    { id: 'gemini-3.1-flash-lite',      label: 'Gemini 3.1 Flash Lite (domyślny)' },
    { id: 'gemini-3-flash-preview',     label: 'Gemini 3 Flash Preview' },
    { id: 'gemini-3.5-flash',           label: 'Gemini 3.5 Flash' },
    { id: 'gemini-2.0-flash-lite',      label: 'Gemini 2.0 Flash Lite' },
    { id: 'gemini-1.5-flash',           label: 'Gemini 1.5 Flash' },
];

export const GEMINI_EMBED_LIST = [
    { id: 'gemini-embedding-2',         label: 'Gemini Embedding 2 (domyślny)' },
    { id: 'gemini-embedding-exp-03-07', label: 'Gemini Embedding Exp' },
    { id: 'text-embedding-004',         label: 'Text Embedding 004' },
];

// ─── Default per-chat config ────────────────────────────────────────────────────
/**
 * Each task carries: provider, temperature, maxTokens, geminiModel, ollamaModel.
 * Both provider-specific models are stored so switching providers never loses a selection.
 */
export const GEMINI_DEFAULTS = {
    chat: {
        provider:      'gemini',
        temperature:   0.7,
        maxTokens:     8192,
        contextTokens: 8000,
        geminiModel:   GEMINI_MODELS.CHAT_PRIMARY,
        ollamaModel:   'llama3.1:8b',
    },
    memory: {
        provider:    'gemini',
        temperature: 0.1,
        maxTokens:   8192,
        geminiModel: GEMINI_MODELS.MEMORY_PRIMARY,
        ollamaModel: 'qwen3:8b',
    },
    summary: {
        provider:    'gemini',
        temperature: 0.3,
        maxTokens:   8192,
        everyN:      10,
        geminiModel: GEMINI_MODELS.SUMMARY,
        ollamaModel: 'phi3:mini',
    },
    embed: {
        provider:    'gemini',
        geminiModel: GEMINI_MODELS.EMBEDDING,
        ollamaModel: 'jeffh/intfloat-multilingual-e5-small:q8_0',
    },
    apiKeys:       [],
    ollamaBaseUrl: 'http://localhost:11434',
    chatLang:      'pl',
};
