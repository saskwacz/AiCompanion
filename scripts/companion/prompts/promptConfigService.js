import { DEFAULT_PROMPTS, getDefaultPrompt } from './defaults.js';
import { renderPrompt } from './renderer.js';
import { getServiceMeta } from '../config/serviceRegistry.js';
import { normalizeMistralApiKeys } from '../../settings.js';

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
    const out = {
        version: 2,
        lang,
        exportedAt: new Date().toISOString(),
        chatLang: chatConfig?.chatLang || lang,
        // Sensitive — treat export files like secrets.
        mistralApiKeys: normalizeMistralApiKeys(chatConfig?.mistralApiKeys),
        prompts: {},
    };
    for (const id of Object.keys(DEFAULT_PROMPTS)) {
        out.prompts[id] = {
            custom: custom[id] ?? null,
            default: getDefaultPrompt(id, lang),
            meta: getServiceMeta(id),
        };
    }
    return out;
}

/**
 * @returns {{ prompts: object, mistralApiKeys: {label:string,key:string}[], chatLang?: string }}
 */
export function importPrompts(chatConfig, data) {
    if (!data?.prompts) throw new Error('Invalid prompt export format');
    const merged = { ...getPromptsFromConfig(chatConfig) };
    for (const [id, entry] of Object.entries(data.prompts)) {
        if (entry?.custom) merged[id] = entry.custom;
    }
    const mistralApiKeys = data.mistralApiKeys?.length
        ? normalizeMistralApiKeys(data.mistralApiKeys)
        : normalizeMistralApiKeys(chatConfig?.mistralApiKeys);
    return {
        prompts: merged,
        mistralApiKeys,
        chatLang: data.chatLang || chatConfig?.chatLang,
    };
}

export { DEFAULT_PROMPTS, getDefaultPrompt };
