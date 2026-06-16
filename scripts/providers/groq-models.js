/**
 * groq-models.js
 *
 * Source of truth for all Groq model identifiers, UI catalogues,
 * and the default per-chat configuration when Groq is chosen.
 *
 * Groq is a pure LLM inference provider — embeddings are NOT supported.
 * Use Gemini or Ollama for the embed task when Groq handles chat/memory/summary.
 */

// ─── Internal model name constants ─────────────────────────────────────────────
export const GROQ_MODELS = {
    CHAT_PRIMARY:    'llama-3.3-70b-versatile',
    CHAT_FALLBACK:   'llama-3.1-8b-instant',
    MEMORY_PRIMARY:  'llama-3.1-8b-instant',
    MEMORY_FALLBACK: 'gemma2-9b-it',
    SUMMARY:         'llama-3.1-8b-instant',
    // No EMBEDDING — Groq does not provide an embeddings API
};

// ─── UI catalogues ─────────────────────────────────────────────────────────────

export const GROQ_CHAT_LIST = [
    { id: 'llama-3.3-70b-versatile',   label: 'Llama 3.3 70B Versatile (domyślny)' },
    { id: 'llama-3.1-70b-versatile',   label: 'Llama 3.1 70B Versatile' },
    { id: 'llama-3.1-8b-instant',      label: 'Llama 3.1 8B Instant' },
    { id: 'mixtral-8x7b-32768',        label: 'Mixtral 8x7B' },
    { id: 'gemma2-9b-it',              label: 'Gemma 2 9B' },
    { id: 'qwen-qwq-32b',              label: 'Qwen QwQ 32B' },
];

export const GROQ_MEMORY_LIST = [
    { id: 'llama-3.1-8b-instant',      label: 'Llama 3.1 8B Instant (domyślny)' },
    { id: 'llama-3.3-70b-versatile',   label: 'Llama 3.3 70B Versatile' },
    { id: 'gemma2-9b-it',              label: 'Gemma 2 9B' },
    { id: 'mixtral-8x7b-32768',        label: 'Mixtral 8x7B' },
];

export const GROQ_SUMMARY_LIST = [
    { id: 'llama-3.1-8b-instant',      label: 'Llama 3.1 8B Instant (domyślny)' },
    { id: 'llama-3.3-70b-versatile',   label: 'Llama 3.3 70B Versatile' },
    { id: 'gemma2-9b-it',              label: 'Gemma 2 9B' },
    { id: 'mixtral-8x7b-32768',        label: 'Mixtral 8x7B' },
];

// ─── Default per-chat config ────────────────────────────────────────────────────
export const GROQ_DEFAULTS = {
    chat: {
        groqModel:         GROQ_MODELS.CHAT_PRIMARY,
        groqModelFallback: GROQ_MODELS.CHAT_FALLBACK,
    },
    memory: {
        groqModel:         GROQ_MODELS.MEMORY_PRIMARY,
        groqModelFallback: GROQ_MODELS.MEMORY_FALLBACK,
    },
    summary: {
        groqModel:         GROQ_MODELS.SUMMARY,
        groqModelFallback: null,
    },
    embed: {
        // Groq has no embeddings — embed task must use another provider
        groqModel: null,
    },
    groqApiKeys: [],
};
