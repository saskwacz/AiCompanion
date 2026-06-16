/**
 * chat-config.js
 *
 * Shared utilities for building and resolving per-chat configurations.
 * Imported by main.js, character-editor.js, chat-settings-page.js.
 */

import { GEMINI_DEFAULTS }      from './providers/gemini-models.js';
import { MISTRAL_DEFAULTS }     from './providers/mistral-models.js';
import { GROQ_DEFAULTS }        from './providers/groq-models.js';
import { OPENROUTER_DEFAULTS }  from './providers/openrouter-models.js';
import { OPENAI_DEFAULTS }      from './providers/openai-models.js';
import { CLAUDE_DEFAULTS }      from './providers/claude-models.js';

export { GEMINI_DEFAULTS, MISTRAL_DEFAULTS, GROQ_DEFAULTS, OPENROUTER_DEFAULTS, OPENAI_DEFAULTS, CLAUDE_DEFAULTS };

const TASKS = ['chat', 'memory', 'summary', 'embed'];

/**
 * Migrate any legacy config format to the current nested structure.
 *
 * Handles two legacy formats:
 *  v1 — very old flat keys like chatProvider, chatModel, temperature, …
 *  v2 — nested tasks but with a single `model` instead of geminiModel/ollamaModel
 */
export function migrateConfig(cfg) {
    if (!cfg) return null;

    // ── v2 → current: replace task.model with task.geminiModel / task.ollamaModel ──
    if (cfg.chat && typeof cfg.chat === 'object') {
        const needsModelSplit = TASKS.some(
            r => cfg[r] && 'model' in cfg[r] && !('geminiModel' in cfg[r])
        );
        if (!needsModelSplit) return cfg; // already current format

        const result = { ...cfg };
        for (const role of TASKS) {
            if (!result[role]) continue;
            const task = { ...result[role] };
            if ('model' in task && !('geminiModel' in task)) {
                const provider = task.provider || 'gemini';
                const def      = GEMINI_DEFAULTS[role] || {};
                if (provider === 'ollama') {
                    task.ollamaModel = task.model || def.ollamaModel;
                    task.geminiModel = task.geminiModel || def.geminiModel;
                } else {
                    task.geminiModel = task.model || def.geminiModel;
                    task.ollamaModel = task.ollamaModel || def.ollamaModel;
                }
                delete task.model;
            }
            result[role] = task;
        }
        return result;
    }

    // ── v1 → current: flat keys → nested ──
    return {
        chat: {
            provider:      cfg.chatProvider    || 'gemini',
            temperature:   cfg.temperature     ?? GEMINI_DEFAULTS.chat.temperature,
            maxTokens:     cfg.maxTokens       ?? GEMINI_DEFAULTS.chat.maxTokens,
            contextTokens: cfg.contextTokens   ?? GEMINI_DEFAULTS.chat.contextTokens,
            geminiModel:   cfg.chatModel       || GEMINI_DEFAULTS.chat.geminiModel,
            ollamaModel:   GEMINI_DEFAULTS.chat.ollamaModel,
        },
        memory: {
            provider:    cfg.memoryProvider  || 'gemini',
            temperature: GEMINI_DEFAULTS.memory.temperature,
            maxTokens:   cfg.memoryTokens    ?? GEMINI_DEFAULTS.memory.maxTokens,
            geminiModel: cfg.memoryModel     || GEMINI_DEFAULTS.memory.geminiModel,
            ollamaModel: GEMINI_DEFAULTS.memory.ollamaModel,
        },
        summary: {
            provider:    cfg.summaryProvider || 'gemini',
            temperature: GEMINI_DEFAULTS.summary.temperature,
            maxTokens:   cfg.summaryTokens   ?? GEMINI_DEFAULTS.summary.maxTokens,
            everyN:      cfg.summaryEvery    ?? GEMINI_DEFAULTS.summary.everyN,
            geminiModel: cfg.summaryModel    || GEMINI_DEFAULTS.summary.geminiModel,
            ollamaModel: GEMINI_DEFAULTS.summary.ollamaModel,
        },
        embed: {
            provider:    cfg.embedProvider || 'gemini',
            geminiModel: cfg.embedModel    || GEMINI_DEFAULTS.embed.geminiModel,
            ollamaModel: GEMINI_DEFAULTS.embed.ollamaModel,
        },
        apiKeys:      cfg.apiKeys      || [],
        ollamaBaseUrl: cfg.ollamaBaseUrl || 'http://localhost:11434',
    };
}

/**
 * Merge a stored chat.config (after migration) with GEMINI_DEFAULTS so
 * every field is guaranteed to exist.
 */
export function resolveChatConfig(chat) {
    if (!chat?.config) return buildDefaultChatConfig();
    const stored = migrateConfig(chat.config) || {};
    return {
        chat:    { ...GEMINI_DEFAULTS.chat,    ...MISTRAL_DEFAULTS.chat,    ...GROQ_DEFAULTS.chat,    ...OPENROUTER_DEFAULTS.chat,    ...OPENAI_DEFAULTS.chat,    ...CLAUDE_DEFAULTS.chat,    ...(stored.chat    || {}) },
        memory:  { ...GEMINI_DEFAULTS.memory,  ...MISTRAL_DEFAULTS.memory,  ...GROQ_DEFAULTS.memory,  ...OPENROUTER_DEFAULTS.memory,  ...OPENAI_DEFAULTS.memory,  ...CLAUDE_DEFAULTS.memory,  ...(stored.memory  || {}) },
        summary: { ...GEMINI_DEFAULTS.summary, ...MISTRAL_DEFAULTS.summary, ...GROQ_DEFAULTS.summary, ...OPENROUTER_DEFAULTS.summary, ...OPENAI_DEFAULTS.summary, ...CLAUDE_DEFAULTS.summary, ...(stored.summary || {}) },
        embed:   { ...GEMINI_DEFAULTS.embed,   ...MISTRAL_DEFAULTS.embed,   ...GROQ_DEFAULTS.embed,   ...OPENROUTER_DEFAULTS.embed,   ...OPENAI_DEFAULTS.embed,   ...CLAUDE_DEFAULTS.embed,   ...(stored.embed   || {}) },
        apiKeys:           stored.apiKeys           || [],
        mistralApiKeys:    stored.mistralApiKeys    || [],
        groqApiKeys:       stored.groqApiKeys       || [],
        openrouterApiKeys: stored.openrouterApiKeys || [],
        openaiApiKeys:     stored.openaiApiKeys     || [],
        claudeApiKeys:     stored.claudeApiKeys     || [],
        ollamaBaseUrl:     stored.ollamaBaseUrl     || 'http://localhost:11434',
        chatLang:          stored.chatLang          || 'pl',
    };
}

/**
 * Build a fresh chat config seeded with global API keys / Ollama URL.
 */
export function buildDefaultChatConfig(globalApiKeys = [], ollamaBaseUrl = 'http://localhost:11434', globalMistralApiKeys = [], globalGroqApiKeys = [], globalOpenRouterApiKeys = [], globalOpenaiApiKeys = [], globalClaudeApiKeys = []) {
    return {
        chat:    { ...GEMINI_DEFAULTS.chat,    ...MISTRAL_DEFAULTS.chat,    ...GROQ_DEFAULTS.chat,    ...OPENROUTER_DEFAULTS.chat,    ...OPENAI_DEFAULTS.chat,    ...CLAUDE_DEFAULTS.chat },
        memory:  { ...GEMINI_DEFAULTS.memory,  ...MISTRAL_DEFAULTS.memory,  ...GROQ_DEFAULTS.memory,  ...OPENROUTER_DEFAULTS.memory,  ...OPENAI_DEFAULTS.memory,  ...CLAUDE_DEFAULTS.memory },
        summary: { ...GEMINI_DEFAULTS.summary, ...MISTRAL_DEFAULTS.summary, ...GROQ_DEFAULTS.summary, ...OPENROUTER_DEFAULTS.summary, ...OPENAI_DEFAULTS.summary, ...CLAUDE_DEFAULTS.summary },
        embed:   { ...GEMINI_DEFAULTS.embed,   ...MISTRAL_DEFAULTS.embed,   ...GROQ_DEFAULTS.embed,   ...OPENROUTER_DEFAULTS.embed,   ...OPENAI_DEFAULTS.embed,   ...CLAUDE_DEFAULTS.embed },
        apiKeys:           [...(globalApiKeys           || [])],
        mistralApiKeys:    [...(globalMistralApiKeys    || [])],
        groqApiKeys:       [...(globalGroqApiKeys       || [])],
        openrouterApiKeys: [...(globalOpenRouterApiKeys || [])],
        openaiApiKeys:     [...(globalOpenaiApiKeys     || [])],
        claudeApiKeys:     [...(globalClaudeApiKeys     || [])],
        ollamaBaseUrl:     ollamaBaseUrl || 'http://localhost:11434',
        chatLang:          'pl',
    };
}

/**
 * Resolve the active model for a given task role from a resolved config.
 * Returns null when the model string is empty.
 */
export function resolveModel(taskCfg) {
    if (!taskCfg) return null;
    const provider = taskCfg.provider || 'gemini';
    if (provider === 'ollama')   return taskCfg.ollamaModel  || null;
    if (provider === 'mistral')  return taskCfg.mistralModel || null;
    if (provider === 'groq')        return taskCfg.groqModel        || null;
    if (provider === 'openrouter')  return taskCfg.openrouterModel  || null;
    if (provider === 'openai')      return taskCfg.openaiModel      || null;
    if (provider === 'claude')      return taskCfg.claudeModel      || null;
    return taskCfg.geminiModel || null;
}
