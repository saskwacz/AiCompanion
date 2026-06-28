/**
 * chat-config.js — Per-chat configuration with extensible service tasks.
 */

import { MISTRAL_DEFAULTS } from './providers/mistral-models.js';
import { SERVICE_IDS } from './companion/config/serviceRegistry.js';

export { MISTRAL_DEFAULTS };

const LLM_TASKS = ['chat', 'memory', 'summary', 'goals', 'emotion', 'relationship', 'embed'];

function pickMistralTask(stored, role) {
    const base = MISTRAL_DEFAULTS[role] || {};
    const src  = stored?.[role] || {};
    return {
        provider:             'mistral',
        temperature:          src.temperature          ?? base.temperature,
        maxTokens:            src.maxTokens            ?? base.maxTokens,
        contextTokens:        src.contextTokens        ?? base.contextTokens,
        everyN:               src.everyN               ?? base.everyN,
        useLLM:               src.useLLM               ?? base.useLLM,
        mistralModel:         src.mistralModel         ?? base.mistralModel,
        mistralModelFallback: src.mistralModelFallback ?? base.mistralModelFallback ?? null,
    };
}

function pickDeterministicTask(stored, role) {
    const base = MISTRAL_DEFAULTS[role] || {};
    const src  = stored?.[role] || {};
    return {
        provider: src.provider ?? base.provider ?? 'deterministic',
        enabled:  src.enabled  ?? base.enabled  ?? true,
    };
}

export function migrateConfig(cfg) {
    if (!cfg) return null;

    const stored = cfg.chat && typeof cfg.chat === 'object' ? cfg : null;
    const base   = stored || cfg;

    const result = {
        mistralApiKeys: base.mistralApiKeys || base.apiKeys || [],
        chatLang:       base.chatLang || 'pl',
        prompts:        base.prompts || {},
    };

    for (const role of LLM_TASKS) {
        result[role] = pickMistralTask(base, role);
    }
    result.initiative   = pickDeterministicTask(base, 'initiative');
    result.consistency  = pickDeterministicTask(base, 'consistency');

    return result;
}

export function normalizeChatConfig(cfg) {
    return resolveChatConfig({ config: cfg ?? null });
}

export function resolveChatConfig(chat) {
    if (!chat?.config) return buildDefaultChatConfig();
    const stored = migrateConfig(chat.config) || {};
    const result = {
        mistralApiKeys: stored.mistralApiKeys || [],
        chatLang:       stored.chatLang || 'pl',
        prompts:        stored.prompts || {},
    };
    for (const role of SERVICE_IDS) {
        result[role] = {
            ...(MISTRAL_DEFAULTS[role] || {}),
            ...(stored[role] || {}),
        };
    }
    return result;
}

export function buildDefaultChatConfig(globalMistralApiKeys = []) {
    const result = {
        mistralApiKeys: [...(globalMistralApiKeys || [])],
        chatLang:       'pl',
        prompts:        {},
    };
    for (const role of SERVICE_IDS) {
        result[role] = { ...(MISTRAL_DEFAULTS[role] || {}) };
    }
    return result;
}

export function resolveModel(taskCfg) {
    if (!taskCfg) return null;
    return taskCfg.mistralModel || null;
}

export function buildProviderConfig(chatConfig, role, keys) {
    const taskCfg = chatConfig[role] || MISTRAL_DEFAULTS[role] || {};
    return {
        provider:      taskCfg.provider === 'deterministic' ? 'deterministic' : 'mistral',
        keys,
        model:         taskCfg.mistralModel || null,
        modelFallback: taskCfg.mistralModelFallback || null,
        lang:          chatConfig.chatLang || 'pl',
        chatConfig,
    };
}

export function getTaskConfig(chatConfig, role) {
    return chatConfig[role] || MISTRAL_DEFAULTS[role] || {};
}
