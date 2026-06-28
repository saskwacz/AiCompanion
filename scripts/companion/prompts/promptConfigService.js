import { DEFAULT_PROMPTS, getDefaultPrompt } from './defaults.js';
import { renderPrompt } from './renderer.js';
import { getServiceMeta } from '../config/serviceRegistry.js';

/**
 * Resolves prompts from chat config with fallback to defaults.
 * Custom prompts stored in chat.config.prompts[serviceId].
 */

export function getPromptsFromConfig(chatConfig) {
    return chatConfig?.prompts ?? {};
}

export function getPrompt(chatConfig, serviceId, lang = 'pl') {
    const custom = getPromptsFromConfig(chatConfig)[serviceId];
    if (custom && typeof custom === 'string' && custom.trim()) return custom;
    return getDefaultPrompt(serviceId, lang);
}

export function buildPrompt(chatConfig, serviceId, vars, lang = 'pl') {
    const template = getPrompt(chatConfig, serviceId, lang);
    return renderPrompt(template, vars);
}

export function resetPrompt(chatConfig, serviceId) {
    const prompts = { ...getPromptsFromConfig(chatConfig) };
    delete prompts[serviceId];
    return prompts;
}

export function resetAllPrompts() {
    return {};
}

export function setPrompt(chatConfig, serviceId, text) {
    return { ...getPromptsFromConfig(chatConfig), [serviceId]: text };
}

export function exportPrompts(chatConfig, lang = 'pl') {
    const custom = getPromptsFromConfig(chatConfig);
    const out = { version: 1, lang, exportedAt: new Date().toISOString(), prompts: {} };
    for (const id of Object.keys(DEFAULT_PROMPTS)) {
        out.prompts[id] = {
            custom: custom[id] ?? null,
            default: getDefaultPrompt(id, lang),
            meta: getServiceMeta(id),
        };
    }
    return out;
}

export function importPrompts(chatConfig, data) {
    if (!data?.prompts) throw new Error('Invalid prompt export format');
    const merged = { ...getPromptsFromConfig(chatConfig) };
    for (const [id, entry] of Object.entries(data.prompts)) {
        if (entry?.custom) merged[id] = entry.custom;
    }
    return merged;
}

export { DEFAULT_PROMPTS, getDefaultPrompt };
