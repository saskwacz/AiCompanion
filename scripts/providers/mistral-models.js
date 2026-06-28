/**
 * mistral-models.js — Model catalogues and default per-service configuration.
 */

export const MISTRAL_MODELS = {
    CHAT_PRIMARY:    'mistral-large-latest',
    CHAT_FALLBACK:   'mistral-small-latest',
    MEMORY_PRIMARY:  'mistral-small-latest',
    MEMORY_FALLBACK: 'open-mistral-7b',
    SUMMARY:         'mistral-small-latest',
    GOALS:           'mistral-small-latest',
    EMOTION:         'mistral-small-latest',
    RELATIONSHIP:    'mistral-small-latest',
    EMBEDDING:       'mistral-embed',
};

export const MISTRAL_CHAT_LIST = [
    { id: 'mistral-large-latest',  label: 'Mistral Large (domyślny chat)' },
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
    { id: 'mistral-embed', label: 'Mistral Embed (domyślny)' },
];

/** Map service id → model dropdown list */
export const SERVICE_MODEL_LISTS = {
    chat:         MISTRAL_CHAT_LIST,
    summary:      MISTRAL_SUMMARY_LIST,
    memory:       MISTRAL_MEMORY_LIST,
    goals:        MISTRAL_MEMORY_LIST,
    emotion:      MISTRAL_MEMORY_LIST,
    relationship: MISTRAL_MEMORY_LIST,
    embed:        MISTRAL_EMBED_LIST,
};

const taskDefaults = (model, fallback = null, extra = {}) => ({
    provider:             'mistral',
    temperature:          extra.temperature ?? 0.1,
    maxTokens:            extra.maxTokens ?? 2048,
    mistralModel:         model,
    mistralModelFallback: fallback,
    ...extra,
});

export const MISTRAL_DEFAULTS = {
    chat: taskDefaults(MISTRAL_MODELS.CHAT_PRIMARY, MISTRAL_MODELS.CHAT_FALLBACK, {
        temperature:   0.7,
        maxTokens:     8192,
        contextTokens: 8000,
    }),
    memory: taskDefaults(MISTRAL_MODELS.MEMORY_PRIMARY, MISTRAL_MODELS.MEMORY_FALLBACK, {
        temperature: 0.05,
        maxTokens:   2048,
    }),
    summary: taskDefaults(MISTRAL_MODELS.SUMMARY, null, {
        temperature: 0.2,
        maxTokens:   1024,
        everyN:      10,
    }),
    goals: taskDefaults(MISTRAL_MODELS.GOALS, null, {
        temperature: 0.05,
        maxTokens:   1024,
    }),
    emotion: taskDefaults(MISTRAL_MODELS.EMOTION, null, {
        temperature: 0.05,
        maxTokens:   512,
    }),
    relationship: taskDefaults(MISTRAL_MODELS.RELATIONSHIP, null, {
        temperature: 0.05,
        maxTokens:   512,
        useLLM:      false,
    }),
    initiative: {
        provider: 'deterministic',
        enabled:  true,
    },
    consistency: {
        provider: 'deterministic',
        enabled:  true,
    },
    embed: {
        provider:     'mistral',
        mistralModel: MISTRAL_MODELS.EMBEDDING,
    },
    mistralApiKeys: [],
    chatLang:       'pl',
    prompts:        {},
};

export function getModelListForService(serviceId) {
    return SERVICE_MODEL_LISTS[serviceId] ?? MISTRAL_MEMORY_LIST;
}

export function getDefaultTaskConfig(serviceId) {
    return MISTRAL_DEFAULTS[serviceId] ?? {};
}
