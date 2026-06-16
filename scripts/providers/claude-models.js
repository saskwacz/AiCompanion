/**
 * claude-models.js
 *
 * Source of truth for Anthropic Claude model identifiers, UI catalogues,
 * and default per-chat configuration.
 *
 * ⚠️  Claude does NOT support embeddings. Use Gemini, OpenAI, Mistral or Ollama for embed.
 */

export const CLAUDE_MODELS = {
    CHAT_PRIMARY:    'claude-sonnet-4-5',
    CHAT_FALLBACK:   'claude-haiku-4-5',
    MEMORY_PRIMARY:  'claude-haiku-4-5',
    MEMORY_FALLBACK: 'claude-sonnet-4-5',
    SUMMARY:         'claude-haiku-4-5',
};

export const CLAUDE_CHAT_LIST = [
    { id: 'claude-sonnet-4-5',   label: 'Claude Sonnet 4.5 (domyślny)' },
    { id: 'claude-opus-4',       label: 'Claude Opus 4' },
    { id: 'claude-haiku-4-5',    label: 'Claude Haiku 4.5' },
    { id: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-5-haiku-latest',  label: 'Claude 3.5 Haiku' },
];

export const CLAUDE_MEMORY_LIST = [
    { id: 'claude-haiku-4-5',    label: 'Claude Haiku 4.5 (domyślny)' },
    { id: 'claude-sonnet-4-5',   label: 'Claude Sonnet 4.5' },
    { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku' },
];

export const CLAUDE_SUMMARY_LIST = [
    { id: 'claude-haiku-4-5',    label: 'Claude Haiku 4.5 (domyślny)' },
    { id: 'claude-sonnet-4-5',   label: 'Claude Sonnet 4.5' },
    { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku' },
];

export const CLAUDE_DEFAULTS = {
    chat: {
        claudeModel:         CLAUDE_MODELS.CHAT_PRIMARY,
        claudeModelFallback: CLAUDE_MODELS.CHAT_FALLBACK,
    },
    memory: {
        claudeModel:         CLAUDE_MODELS.MEMORY_PRIMARY,
        claudeModelFallback: CLAUDE_MODELS.MEMORY_FALLBACK,
    },
    summary: {
        claudeModel:         CLAUDE_MODELS.SUMMARY,
        claudeModelFallback: null,
    },
    embed: {
        claudeModel: null,
    },
    claudeApiKeys: [],
};
