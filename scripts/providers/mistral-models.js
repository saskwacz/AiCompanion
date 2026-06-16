/**
 * mistral-models.js
 *
 * Source of truth for all Mistral model identifiers, UI catalogues,
 * and the default per-chat configuration when Mistral is chosen.
 */

// ─── Internal model name constants ─────────────────────────────────────────────
export const MISTRAL_MODELS = {
    CHAT_PRIMARY:    'mistral-large-latest',
    CHAT_FALLBACK:   'mistral-small-latest',
    MEMORY_PRIMARY:  'mistral-small-latest',
    MEMORY_FALLBACK: 'open-mistral-7b',
    SUMMARY:         'mistral-small-latest',
    EMBEDDING:       'mistral-embed',
};

// ─── UI catalogues ─────────────────────────────────────────────────────────────

export const MISTRAL_CHAT_LIST = [
    { id: 'mistral-large-latest',  label: 'Mistral Large (domyślny)' },
    { id: 'mistral-medium-latest', label: 'Mistral Medium' },
    { id: 'mistral-small-latest',  label: 'Mistral Small' },
    { id: 'open-mixtral-8x22b',    label: 'Mixtral 8x22B' },
    { id: 'open-mixtral-8x7b',     label: 'Mixtral 8x7B' },
    { id: 'open-mistral-7b',       label: 'Mistral 7B' },
];

export const MISTRAL_MEMORY_LIST = [
    { id: 'mistral-small-latest',  label: 'Mistral Small (domyślny)' },
    { id: 'mistral-large-latest',  label: 'Mistral Large' },
    { id: 'open-mistral-7b',       label: 'Mistral 7B' },
];

export const MISTRAL_SUMMARY_LIST = [
    { id: 'mistral-small-latest',  label: 'Mistral Small (domyślny)' },
    { id: 'mistral-large-latest',  label: 'Mistral Large' },
    { id: 'open-mistral-7b',       label: 'Mistral 7B' },
];

export const MISTRAL_EMBED_LIST = [
    { id: 'mistral-embed',         label: 'Mistral Embed (domyślny)' },
];

// ─── Default per-chat config ────────────────────────────────────────────────────
/**
 * Each task carries: provider, temperature, maxTokens, and mistralModel.
 * Both mistralModel and geminiModel/ollamaModel are stored so switching
 * providers never loses a selection.
 */
export const MISTRAL_DEFAULTS = {
    chat: {
        mistralModel:         MISTRAL_MODELS.CHAT_PRIMARY,
        mistralModelFallback: MISTRAL_MODELS.CHAT_FALLBACK,
    },
    memory: {
        mistralModel:         MISTRAL_MODELS.MEMORY_PRIMARY,
        mistralModelFallback: MISTRAL_MODELS.MEMORY_FALLBACK,
    },
    summary: {
        mistralModel:         MISTRAL_MODELS.SUMMARY,
        mistralModelFallback: null,
    },
    embed: {
        mistralModel: MISTRAL_MODELS.EMBEDDING,
    },
    mistralApiKeys: [],
};
