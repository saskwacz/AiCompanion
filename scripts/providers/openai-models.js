/**
 * openai-models.js
 *
 * Source of truth for OpenAI model identifiers, UI catalogues,
 * and default per-chat configuration.
 */

export const OPENAI_MODELS = {
    CHAT_PRIMARY:    'gpt-4o',
    CHAT_FALLBACK:   'gpt-4o-mini',
    MEMORY_PRIMARY:  'gpt-4o-mini',
    MEMORY_FALLBACK: 'gpt-4o',
    SUMMARY:         'gpt-4o-mini',
    EMBEDDING:       'text-embedding-3-small',
};

export const OPENAI_CHAT_LIST = [
    { id: 'gpt-4o',              label: 'GPT-4o (domyślny)' },
    { id: 'gpt-4o-mini',         label: 'GPT-4o Mini' },
    { id: 'gpt-4.1',             label: 'GPT-4.1' },
    { id: 'gpt-4.1-mini',        label: 'GPT-4.1 Mini' },
    { id: 'o3-mini',             label: 'o3-mini' },
    { id: 'o4-mini',             label: 'o4-mini' },
];

export const OPENAI_MEMORY_LIST = [
    { id: 'gpt-4o-mini',         label: 'GPT-4o Mini (domyślny)' },
    { id: 'gpt-4o',              label: 'GPT-4o' },
    { id: 'gpt-4.1-mini',        label: 'GPT-4.1 Mini' },
];

export const OPENAI_SUMMARY_LIST = [
    { id: 'gpt-4o-mini',         label: 'GPT-4o Mini (domyślny)' },
    { id: 'gpt-4o',              label: 'GPT-4o' },
    { id: 'gpt-4.1-mini',        label: 'GPT-4.1 Mini' },
];

export const OPENAI_EMBED_LIST = [
    { id: 'text-embedding-3-small', label: 'text-embedding-3-small (domyślny)' },
    { id: 'text-embedding-3-large', label: 'text-embedding-3-large' },
    { id: 'text-embedding-ada-002', label: 'text-embedding-ada-002' },
];

export const OPENAI_DEFAULTS = {
    chat: {
        openaiModel:         OPENAI_MODELS.CHAT_PRIMARY,
        openaiModelFallback: OPENAI_MODELS.CHAT_FALLBACK,
    },
    memory: {
        openaiModel:         OPENAI_MODELS.MEMORY_PRIMARY,
        openaiModelFallback: OPENAI_MODELS.MEMORY_FALLBACK,
    },
    summary: {
        openaiModel:         OPENAI_MODELS.SUMMARY,
        openaiModelFallback: null,
    },
    embed: {
        openaiModel: OPENAI_MODELS.EMBEDDING,
    },
    openaiApiKeys: [],
};
