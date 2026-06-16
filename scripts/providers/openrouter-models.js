/**
 * openrouter-models.js
 *
 * Source of truth for OpenRouter model identifiers, UI catalogues,
 * and default per-chat configuration.
 *
 * OpenRouter aggregates hundreds of models under a single API endpoint.
 * Model IDs follow the format: provider/model-name
 *
 * ⚠️  OpenRouter does NOT support embeddings (/embeddings endpoint).
 *     Use Gemini or Ollama for the embed task.
 */

export const OPENROUTER_MODELS = {
    CHAT_PRIMARY:    'anthropic/claude-sonnet-4-5',
    CHAT_FALLBACK:   'meta-llama/llama-3.3-70b-instruct',
    MEMORY_PRIMARY:  'meta-llama/llama-3.1-8b-instruct',
    MEMORY_FALLBACK: 'google/gemini-flash-1.5',
    SUMMARY:         'meta-llama/llama-3.1-8b-instruct',
};

// ─── UI catalogues ─────────────────────────────────────────────────────────────

export const OPENROUTER_CHAT_LIST = [
    { id: 'anthropic/claude-sonnet-4-5',           label: 'Claude Sonnet 4.5 (domyślny)' },
    { id: 'anthropic/claude-opus-4',               label: 'Claude Opus 4' },
    { id: 'openai/gpt-4o',                         label: 'GPT-4o' },
    { id: 'openai/gpt-4o-mini',                    label: 'GPT-4o Mini' },
    { id: 'google/gemini-2.5-pro',                 label: 'Gemini 2.5 Pro' },
    { id: 'google/gemini-2.0-flash-001',           label: 'Gemini 2.0 Flash' },
    { id: 'meta-llama/llama-3.3-70b-instruct',     label: 'Llama 3.3 70B' },
    { id: 'mistralai/mistral-large',               label: 'Mistral Large' },
    { id: 'deepseek/deepseek-r1',                  label: 'DeepSeek R1' },
    { id: 'deepseek/deepseek-chat-v3-0324',        label: 'DeepSeek Chat V3' },
    { id: 'qwen/qwen3-235b-a22b',                  label: 'Qwen3 235B' },
    { id: 'x-ai/grok-3',                           label: 'Grok 3' },
];

export const OPENROUTER_MEMORY_LIST = [
    { id: 'meta-llama/llama-3.1-8b-instruct',     label: 'Llama 3.1 8B (domyślny)' },
    { id: 'google/gemini-flash-1.5',               label: 'Gemini Flash 1.5' },
    { id: 'openai/gpt-4o-mini',                    label: 'GPT-4o Mini' },
    { id: 'mistralai/mistral-small',               label: 'Mistral Small' },
    { id: 'meta-llama/llama-3.3-70b-instruct',     label: 'Llama 3.3 70B' },
];

export const OPENROUTER_SUMMARY_LIST = [
    { id: 'meta-llama/llama-3.1-8b-instruct',     label: 'Llama 3.1 8B (domyślny)' },
    { id: 'google/gemini-flash-1.5',               label: 'Gemini Flash 1.5' },
    { id: 'openai/gpt-4o-mini',                    label: 'GPT-4o Mini' },
    { id: 'mistralai/mistral-small',               label: 'Mistral Small' },
    { id: 'anthropic/claude-sonnet-4-5',           label: 'Claude Sonnet 4.5' },
];

// ─── Default per-chat config ────────────────────────────────────────────────────
export const OPENROUTER_DEFAULTS = {
    chat: {
        openrouterModel:         OPENROUTER_MODELS.CHAT_PRIMARY,
        openrouterModelFallback: OPENROUTER_MODELS.CHAT_FALLBACK,
    },
    memory: {
        openrouterModel:         OPENROUTER_MODELS.MEMORY_PRIMARY,
        openrouterModelFallback: OPENROUTER_MODELS.MEMORY_FALLBACK,
    },
    summary: {
        openrouterModel:         OPENROUTER_MODELS.SUMMARY,
        openrouterModelFallback: null,
    },
    embed: {
        openrouterModel: null, // not supported
    },
    openrouterApiKeys: [],
};
