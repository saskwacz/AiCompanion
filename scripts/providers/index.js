/**
 * providers/index.js — Central provider router for AiComp (Mistral only).
 */

import {
    callMistralAPI,
    callMistralForMemory,
    callMistralForSummary,
    embedText      as mistralEmbedText,
    embedContents  as mistralEmbedContents,
    parseMemoryJson as mistralParseMemoryJson,
} from './mistral.js';

import {
    buildSystemPrompt       as mistralBuildSystemPrompt,
    buildMemoryUpdatePrompt as mistralBuildMemoryUpdatePrompt,
    buildMemorySeedPrompt   as mistralBuildMemorySeedPrompt,
    buildSummaryPrompt      as mistralBuildSummaryPrompt,
    selectChatMessages      as mistralSelectChatMessages,
} from './mistral-prompts.js';

const PROVIDERS = {
    mistral: {
        callChat: ({ messages, systemPrompt, chatSummary, temperature, maxTokens, contextTokens, keys, model, modelFallback }) =>
            callMistralAPI({ apiKey: keys, messages, systemPrompt, chatSummary, temperature, maxTokens, contextTokens, chatModel: model, chatModelFallback: modelFallback }),

        callMemory: ({ prompt, maxOutputTokens, keys, priority, model, modelFallback }) =>
            callMistralForMemory({ prompt, apiKey: keys, maxOutputTokens, priority, memoryModel: model, memoryModelFallback: modelFallback }),

        callSummary: ({ prompt, maxOutputTokens, keys, model, modelFallback }) =>
            callMistralForSummary({ prompt, apiKey: keys, maxOutputTokens, summaryModel: model, summaryModelFallback: modelFallback }),

        embedText: ({ text, keys, model }) =>
            mistralEmbedText({ apiKey: keys, text, embedModel: model }),

        embedContents: ({ texts, keys, model }) =>
            mistralEmbedContents({ apiKey: keys, texts, embedModel: model }),

        parseMemoryJson: mistralParseMemoryJson,

        buildSystemPrompt:       (lang, character, memCtx) => mistralBuildSystemPrompt(lang, character, memCtx),
        buildMemoryUpdatePrompt: (lang, existing, character, recentMessages, userMsg, aiMsg) => mistralBuildMemoryUpdatePrompt(lang, existing, character, recentMessages, userMsg, aiMsg),
        buildMemorySeedPrompt:   (lang, character) => mistralBuildMemorySeedPrompt(lang, character),
        buildSummaryPrompt:      (lang, opts) => mistralBuildSummaryPrompt(lang, opts),
        selectChatMessages:      mistralSelectChatMessages,
    },
};

function getProvider(name) {
    const p = PROVIDERS[name];
    if (!p) throw new Error(`Unknown provider "${name}". Available: ${Object.keys(PROVIDERS).join(', ')}`);
    return p;
}

export function callChatAPI(cfg, { messages, systemPrompt, chatSummary, temperature, maxTokens, contextTokens }) {
    return getProvider(cfg.provider).callChat({
        messages, systemPrompt, chatSummary, temperature, maxTokens, contextTokens,
        keys:          cfg.keys,
        model:         cfg.model ?? null,
        modelFallback: cfg.modelFallback ?? null,
    });
}

export function callMemoryAPI(cfg, { prompt, maxOutputTokens, priority = 'normal' }) {
    return getProvider(cfg.provider).callMemory({
        prompt, maxOutputTokens, priority,
        keys:          cfg.keys,
        model:         cfg.model ?? null,
        modelFallback: cfg.modelFallback ?? null,
    });
}

export function callSummaryAPI(cfg, { prompt, maxOutputTokens }) {
    return getProvider(cfg.provider).callSummary({
        prompt, maxOutputTokens,
        keys:          cfg.keys,
        model:         cfg.model ?? null,
        modelFallback: cfg.modelFallback ?? null,
    });
}

export function embedText(cfg, { text }) {
    return getProvider(cfg.provider).embedText({
        text,
        keys:  cfg.keys,
        model: cfg.model ?? null,
    });
}

export function embedContents(cfg, { texts }) {
    return getProvider(cfg.provider).embedContents({
        texts,
        keys:  cfg.keys,
        model: cfg.model ?? null,
    });
}

export function buildSystemPrompt(cfg, character, memCtx) {
    return getProvider(cfg.provider).buildSystemPrompt(cfg.lang ?? 'pl', character, memCtx);
}

export function buildMemoryUpdatePrompt(cfg, existing, character, recentMessages, userMsg, aiMsg) {
    return getProvider(cfg.provider).buildMemoryUpdatePrompt(cfg.lang ?? 'pl', existing, character, recentMessages, userMsg, aiMsg);
}

export function buildMemorySeedPrompt(cfg, character) {
    return getProvider(cfg.provider).buildMemorySeedPrompt(cfg.lang ?? 'pl', character);
}

export function buildSummaryPrompt(cfg, opts) {
    return getProvider(cfg.provider).buildSummaryPrompt(cfg.lang ?? 'pl', opts);
}

export function selectChatMessages(cfg, messages, chatSummary, contextTokens) {
    return getProvider(cfg.provider).selectChatMessages(messages, chatSummary, contextTokens);
}

export function parseMemoryJson(cfg, text) {
    return getProvider(cfg.provider).parseMemoryJson(text);
}

export function availableProviders() {
    return Object.keys(PROVIDERS);
}
