/**
 * ollama-models.js
 *
 * Source of truth for all Ollama model identifiers, UI catalogues,
 * and the default per-chat configuration when Ollama is chosen.
 */

export const OLLAMA_MODELS = {
    CHAT:      'llama3.1:8b',
    MEMORY:    'qwen3:8b',
    SUMMARY:   'phi3:mini',
    EMBEDDING: 'jeffh/intfloat-multilingual-e5-small:q8_0',
};

// ─── UI catalogues ─────────────────────────────────────────────────────────────

export const OLLAMA_CHAT_LIST = [
    { id: 'llama3.1:8b',    label: 'Llama 3.1 8B (domyślny)' },
    { id: 'llama3.2:3b',    label: 'Llama 3.2 3B' },
    { id: 'llama3.3:70b',   label: 'Llama 3.3 70B' },
    { id: 'mistral:7b',     label: 'Mistral 7B' },
    { id: 'mistral-nemo',   label: 'Mistral Nemo' },
    { id: 'gemma3:9b',      label: 'Gemma 3 9B' },
    { id: 'gemma3:27b',     label: 'Gemma 3 27B' },
    { id: 'phi4:14b',       label: 'Phi-4 14B' },
    { id: 'qwen3:8b',       label: 'Qwen 3 8B' },
    { id: 'deepseek-r1:8b', label: 'DeepSeek R1 8B' },
];

export const OLLAMA_MEMORY_LIST = [
    { id: 'qwen3:8b',       label: 'Qwen 3 8B (domyślny)' },
    { id: 'qwen3:4b',       label: 'Qwen 3 4B' },
    { id: 'llama3.1:8b',    label: 'Llama 3.1 8B' },
    { id: 'phi4:14b',       label: 'Phi-4 14B' },
    { id: 'gemma3:9b',      label: 'Gemma 3 9B' },
];

export const OLLAMA_SUMMARY_LIST = [
    { id: 'phi3:mini',      label: 'Phi-3 Mini (domyślny)' },
    { id: 'phi4:14b',       label: 'Phi-4 14B' },
    { id: 'llama3.2:3b',    label: 'Llama 3.2 3B' },
    { id: 'gemma3:9b',      label: 'Gemma 3 9B' },
    { id: 'qwen3:4b',       label: 'Qwen 3 4B' },
];

export const OLLAMA_EMBED_LIST = [
    { id: 'jeffh/intfloat-multilingual-e5-small:q8_0', label: 'multilingual-e5-small (domyślny)' },
    { id: 'nomic-embed-text',                           label: 'nomic-embed-text' },
    { id: 'mxbai-embed-large',                          label: 'mxbai-embed-large' },
    { id: 'all-minilm',                                 label: 'all-minilm' },
];

// ─── Default per-chat config (Ollama for all tasks) ───────────────────────────
export const OLLAMA_DEFAULTS = {
    chat: {
        provider:      'ollama',
        temperature:   0.7,
        maxTokens:     4096,
        contextTokens: 4000,
        geminiModel:   'gemini-3.5-flash',
        ollamaModel:   OLLAMA_MODELS.CHAT,
    },
    memory: {
        provider:    'ollama',
        temperature: 0.1,
        maxTokens:   4096,
        geminiModel: 'gemini-3.0-flash',
        ollamaModel: OLLAMA_MODELS.MEMORY,
    },
    summary: {
        provider:    'ollama',
        temperature: 0.3,
        maxTokens:   4096,
        everyN:      10,
        geminiModel: 'gemini-3.1-flash-lite',
        ollamaModel: OLLAMA_MODELS.SUMMARY,
    },
    embed: {
        provider:    'ollama',
        geminiModel: 'gemini-embedding-2',
        ollamaModel: OLLAMA_MODELS.EMBEDDING,
    },
    apiKeys:       [],
    ollamaBaseUrl: 'http://localhost:11434',
    chatLang:      'pl',
};
