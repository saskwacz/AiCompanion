/**
 * providers/index.js — Central provider router for AiComp.
 *
 * HOW IT WORKS
 * ─────────────
 * Every LLM task (chat, memory, summary, embeddings) goes through one of the
 * public functions below.  Each receives a `providerConfig` object built by
 * getProviderConfig() in main.js:
 *
 *   {
 *     provider:  'gemini' | 'ollama' | 'mistral' | 'groq' | 'openrouter' | 'openai' | 'claude'
 *     keys:      [{label, key}, …]     // Gemini/Mistral API keys (ignored for Ollama)
 *     ollamaUrl: 'http://…'            // Ollama base URL (ignored for Gemini/Mistral)
 *     model:     'model-id' | null     // per-role model override (null = provider default)
 *   }
 *
 * ADDING A NEW PROVIDER
 * ──────────────────────
 * 1. Create providers/foo.js + providers/foo-prompts.js + providers/foo-models.js
 * 2. Add one entry to PROVIDERS below.
 * 3. Add the new provider name to settings.js PROVIDER_NAMES and the UI select.
 */

// ─── Gemini ────────────────────────────────────────────────────────────────────
import {
    callGeminiAPI,
    callGeminiForMemory,
    callGeminiForSummary,
    embedText      as geminiEmbedText,
    embedContents  as geminiEmbedContents,
    parseMemoryJson as geminiParseMemoryJson,
    AllModelsRateLimitedError,
    rlGetStatus,
    rlGetStatusForKey,
    rlClear,
} from './gemini.js';

export { AllModelsRateLimitedError, rlGetStatus, rlGetStatusForKey, rlClear };

import {
    buildSystemPrompt       as geminiBuildSystemPrompt,
    buildMemoryUpdatePrompt as geminiBuildMemoryUpdatePrompt,
    buildMemorySeedPrompt   as geminiBuildMemorySeedPrompt,
    buildSummaryPrompt      as geminiBuildSummaryPrompt,
    selectChatMessages      as geminiSelectChatMessages,
} from './gemini-prompts.js';

// ─── Claude (Anthropic) ────────────────────────────────────────────────────────
import {
    callClaudeAPI,
    callClaudeForMemory,
    callClaudeForSummary,
    embedText       as claudeEmbedText,
    embedContents   as claudeEmbedContents,
    parseMemoryJson as claudeParseMemoryJson,
} from './claude.js';

import {
    buildSystemPrompt       as claudeBuildSystemPrompt,
    buildMemoryUpdatePrompt as claudeBuildMemoryUpdatePrompt,
    buildMemorySeedPrompt   as claudeBuildMemorySeedPrompt,
    buildSummaryPrompt      as claudeBuildSummaryPrompt,
    selectChatMessages      as claudeSelectChatMessages,
} from './claude-prompts.js';

// ─── OpenAI ────────────────────────────────────────────────────────────────────
import {
    callOpenAIAPI,
    callOpenAIForMemory,
    callOpenAIForSummary,
    embedText       as openaiEmbedText,
    embedContents   as openaiEmbedContents,
    parseMemoryJson as openaiParseMemoryJson,
} from './openai.js';

import {
    buildSystemPrompt       as openaiBuildSystemPrompt,
    buildMemoryUpdatePrompt as openaiBuildMemoryUpdatePrompt,
    buildMemorySeedPrompt   as openaiBuildMemorySeedPrompt,
    buildSummaryPrompt      as openaiBuildSummaryPrompt,
    selectChatMessages      as openaiSelectChatMessages,
} from './openai-prompts.js';

// ─── OpenRouter ────────────────────────────────────────────────────────────────
import {
    callOpenRouterAPI,
    callOpenRouterForMemory,
    callOpenRouterForSummary,
    embedText       as openrouterEmbedText,
    embedContents   as openrouterEmbedContents,
    parseMemoryJson as openrouterParseMemoryJson,
} from './openrouter.js';

import {
    buildSystemPrompt       as openrouterBuildSystemPrompt,
    buildMemoryUpdatePrompt as openrouterBuildMemoryUpdatePrompt,
    buildMemorySeedPrompt   as openrouterBuildMemorySeedPrompt,
    buildSummaryPrompt      as openrouterBuildSummaryPrompt,
    selectChatMessages      as openrouterSelectChatMessages,
} from './openrouter-prompts.js';

// ─── Groq ──────────────────────────────────────────────────────────────────────
import {
    callGroqAPI,
    callGroqForMemory,
    callGroqForSummary,
    embedText      as groqEmbedText,
    embedContents  as groqEmbedContents,
    parseMemoryJson as groqParseMemoryJson,
} from './groq.js';

import {
    buildSystemPrompt       as groqBuildSystemPrompt,
    buildMemoryUpdatePrompt as groqBuildMemoryUpdatePrompt,
    buildMemorySeedPrompt   as groqBuildMemorySeedPrompt,
    buildSummaryPrompt      as groqBuildSummaryPrompt,
    selectChatMessages      as groqSelectChatMessages,
} from './groq-prompts.js';

// ─── Mistral ───────────────────────────────────────────────────────────────────
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

// ─── Ollama ────────────────────────────────────────────────────────────────────
import {
    callOllamaAPI,
    callOllamaForMemory,
    callOllamaForSummary,
    embedText      as ollamaEmbedText,
    embedContents  as ollamaEmbedContents,
    parseMemoryJson as ollamaParseMemoryJson,
} from './ollama.js';

import {
    buildSystemPrompt       as ollamaBuildSystemPrompt,
    buildMemoryUpdatePrompt as ollamaBuildMemoryUpdatePrompt,
    buildMemorySeedPrompt   as ollamaBuildMemorySeedPrompt,
    buildSummaryPrompt      as ollamaBuildSummaryPrompt,
    selectChatMessages      as ollamaSelectChatMessages,
} from './ollama-prompts.js';

// ─── Registry ──────────────────────────────────────────────────────────────────

const PROVIDERS = {

    gemini: {
        callChat: ({ messages, systemPrompt, chatSummary, temperature, maxTokens, contextTokens, keys, model, modelFallback }) =>
            callGeminiAPI({ apiKey: keys, messages, systemPrompt, chatSummary, temperature, maxTokens, contextTokens, chatModel: model, chatModelFallback: modelFallback }),

        callMemory: ({ prompt, maxOutputTokens, keys, priority, model, modelFallback }) =>
            callGeminiForMemory({ prompt, apiKey: keys, maxOutputTokens, priority, memoryModel: model, memoryModelFallback: modelFallback }),

        callSummary: ({ prompt, maxOutputTokens, keys, model, modelFallback }) =>
            callGeminiForSummary({ prompt, apiKey: keys, maxOutputTokens, summaryModel: model, summaryModelFallback: modelFallback }),

        embedText: ({ text, keys, model }) =>
            geminiEmbedText({ apiKey: keys, text, embedModel: model }),

        embedContents: ({ texts, keys, model }) =>
            geminiEmbedContents({ apiKey: keys, texts, embedModel: model }),

        parseMemoryJson: geminiParseMemoryJson,

        // lang-aware prompt builders — first arg is always the language code
        buildSystemPrompt:       (lang, character, memCtx) => geminiBuildSystemPrompt(lang, character, memCtx),
        buildMemoryUpdatePrompt: (lang, existing, character, recentMessages, userMsg, aiMsg) => geminiBuildMemoryUpdatePrompt(lang, existing, character, recentMessages, userMsg, aiMsg),
        buildMemorySeedPrompt:   (lang, character) => geminiBuildMemorySeedPrompt(lang, character),
        buildSummaryPrompt:      (lang, opts) => geminiBuildSummaryPrompt(lang, opts),
        selectChatMessages:      geminiSelectChatMessages,
    },

    openai: {
        callChat: ({ messages, systemPrompt, chatSummary, temperature, maxTokens, contextTokens, keys, model, modelFallback }) =>
            callOpenAIAPI({ apiKey: keys, messages, systemPrompt, chatSummary, temperature, maxTokens, contextTokens, chatModel: model, chatModelFallback: modelFallback }),

        callMemory: ({ prompt, maxOutputTokens, keys, priority, model, modelFallback }) =>
            callOpenAIForMemory({ prompt, apiKey: keys, maxOutputTokens, priority, memoryModel: model, memoryModelFallback: modelFallback }),

        callSummary: ({ prompt, maxOutputTokens, keys, model, modelFallback }) =>
            callOpenAIForSummary({ prompt, apiKey: keys, maxOutputTokens, summaryModel: model, summaryModelFallback: modelFallback }),

        embedText:     ({ text, keys, model })  => openaiEmbedText({ text, apiKey: keys, embedModel: model }),
        embedContents: ({ texts, keys, model }) => openaiEmbedContents({ texts, apiKey: keys, embedModel: model }),

        parseMemoryJson: openaiParseMemoryJson,

        buildSystemPrompt:       (lang, character, memCtx) => openaiBuildSystemPrompt(lang, character, memCtx),
        buildMemoryUpdatePrompt: (lang, existing, character, recentMessages, userMsg, aiMsg) => openaiBuildMemoryUpdatePrompt(lang, existing, character, recentMessages, userMsg, aiMsg),
        buildMemorySeedPrompt:   (lang, character) => openaiBuildMemorySeedPrompt(lang, character),
        buildSummaryPrompt:      (lang, opts) => openaiBuildSummaryPrompt(lang, opts),
        selectChatMessages:      openaiSelectChatMessages,
    },

    claude: {
        callChat: ({ messages, systemPrompt, chatSummary, temperature, maxTokens, contextTokens, keys, model, modelFallback }) =>
            callClaudeAPI({ apiKey: keys, messages, systemPrompt, chatSummary, temperature, maxTokens, contextTokens, chatModel: model, chatModelFallback: modelFallback }),

        callMemory: ({ prompt, maxOutputTokens, keys, priority, model, modelFallback }) =>
            callClaudeForMemory({ prompt, apiKey: keys, maxOutputTokens, priority, memoryModel: model, memoryModelFallback: modelFallback }),

        callSummary: ({ prompt, maxOutputTokens, keys, model, modelFallback }) =>
            callClaudeForSummary({ prompt, apiKey: keys, maxOutputTokens, summaryModel: model, summaryModelFallback: modelFallback }),

        embedText:     ({ text, keys, model })  => claudeEmbedText({ text, apiKey: keys, embedModel: model }),
        embedContents: ({ texts, keys, model }) => claudeEmbedContents({ texts, apiKey: keys, embedModel: model }),

        parseMemoryJson: claudeParseMemoryJson,

        buildSystemPrompt:       (lang, character, memCtx) => claudeBuildSystemPrompt(lang, character, memCtx),
        buildMemoryUpdatePrompt: (lang, existing, character, recentMessages, userMsg, aiMsg) => claudeBuildMemoryUpdatePrompt(lang, existing, character, recentMessages, userMsg, aiMsg),
        buildMemorySeedPrompt:   (lang, character) => claudeBuildMemorySeedPrompt(lang, character),
        buildSummaryPrompt:      (lang, opts) => claudeBuildSummaryPrompt(lang, opts),
        selectChatMessages:      claudeSelectChatMessages,
    },

    openrouter: {
        callChat: ({ messages, systemPrompt, chatSummary, temperature, maxTokens, contextTokens, keys, model, modelFallback }) =>
            callOpenRouterAPI({ apiKey: keys, messages, systemPrompt, chatSummary, temperature, maxTokens, contextTokens, chatModel: model, chatModelFallback: modelFallback }),

        callMemory: ({ prompt, maxOutputTokens, keys, priority, model, modelFallback }) =>
            callOpenRouterForMemory({ prompt, apiKey: keys, maxOutputTokens, priority, memoryModel: model, memoryModelFallback: modelFallback }),

        callSummary: ({ prompt, maxOutputTokens, keys, model, modelFallback }) =>
            callOpenRouterForSummary({ prompt, apiKey: keys, maxOutputTokens, summaryModel: model, summaryModelFallback: modelFallback }),

        embedText:     ({ text, keys, model })   => openrouterEmbedText({ text, apiKey: keys, embedModel: model }),
        embedContents: ({ texts, keys, model })  => openrouterEmbedContents({ texts, apiKey: keys, embedModel: model }),

        parseMemoryJson: openrouterParseMemoryJson,

        buildSystemPrompt:       (lang, character, memCtx) => openrouterBuildSystemPrompt(lang, character, memCtx),
        buildMemoryUpdatePrompt: (lang, existing, character, recentMessages, userMsg, aiMsg) => openrouterBuildMemoryUpdatePrompt(lang, existing, character, recentMessages, userMsg, aiMsg),
        buildMemorySeedPrompt:   (lang, character) => openrouterBuildMemorySeedPrompt(lang, character),
        buildSummaryPrompt:      (lang, opts) => openrouterBuildSummaryPrompt(lang, opts),
        selectChatMessages:      openrouterSelectChatMessages,
    },

    groq: {
        callChat: ({ messages, systemPrompt, chatSummary, temperature, maxTokens, contextTokens, keys, model, modelFallback }) =>
            callGroqAPI({ apiKey: keys, messages, systemPrompt, chatSummary, temperature, maxTokens, contextTokens, chatModel: model, chatModelFallback: modelFallback }),

        callMemory: ({ prompt, maxOutputTokens, keys, priority, model, modelFallback }) =>
            callGroqForMemory({ prompt, apiKey: keys, maxOutputTokens, priority, memoryModel: model, memoryModelFallback: modelFallback }),

        callSummary: ({ prompt, maxOutputTokens, keys, model, modelFallback }) =>
            callGroqForSummary({ prompt, apiKey: keys, maxOutputTokens, summaryModel: model, summaryModelFallback: modelFallback }),

        embedText:    ({ text, keys, model })  => groqEmbedText({ text, apiKey: keys, embedModel: model }),
        embedContents: ({ texts, keys, model }) => groqEmbedContents({ texts, apiKey: keys, embedModel: model }),

        parseMemoryJson: groqParseMemoryJson,

        buildSystemPrompt:       (lang, character, memCtx) => groqBuildSystemPrompt(lang, character, memCtx),
        buildMemoryUpdatePrompt: (lang, existing, character, recentMessages, userMsg, aiMsg) => groqBuildMemoryUpdatePrompt(lang, existing, character, recentMessages, userMsg, aiMsg),
        buildMemorySeedPrompt:   (lang, character) => groqBuildMemorySeedPrompt(lang, character),
        buildSummaryPrompt:      (lang, opts) => groqBuildSummaryPrompt(lang, opts),
        selectChatMessages:      groqSelectChatMessages,
    },

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

    ollama: {
        callChat: ({ messages, systemPrompt, chatSummary, temperature, maxTokens, contextTokens, ollamaUrl, model }) =>
            callOllamaAPI({ messages, systemPrompt, chatSummary, temperature, maxTokens, contextTokens, baseUrl: ollamaUrl, modelOverrides: model ? { chat: model } : {} }),

        callMemory: ({ prompt, maxOutputTokens, ollamaUrl, model }) =>
            callOllamaForMemory({ prompt, maxOutputTokens, baseUrl: ollamaUrl, modelOverrides: model ? { memory: model } : {} }),

        callSummary: ({ prompt, maxOutputTokens, ollamaUrl, model }) =>
            callOllamaForSummary({ prompt, maxOutputTokens, baseUrl: ollamaUrl, modelOverrides: model ? { summary: model } : {} }),

        embedText: ({ text, ollamaUrl, model }) =>
            ollamaEmbedText({ text, baseUrl: ollamaUrl, modelOverrides: model ? { embedding: model } : {} }),

        embedContents: ({ texts, ollamaUrl, model }) =>
            ollamaEmbedContents({ texts, baseUrl: ollamaUrl, modelOverrides: model ? { embedding: model } : {} }),

        parseMemoryJson: ollamaParseMemoryJson,

        // Ollama prompts are language-neutral (English instructions, output follows chat lang)
        buildSystemPrompt:       (_lang, character, memCtx) => ollamaBuildSystemPrompt(character, memCtx),
        buildMemoryUpdatePrompt: (_lang, existing, character, recentMessages, userMsg, aiMsg) => ollamaBuildMemoryUpdatePrompt(existing, character, recentMessages, userMsg, aiMsg),
        buildMemorySeedPrompt:   (_lang, character) => ollamaBuildMemorySeedPrompt(character),
        buildSummaryPrompt:      (_lang, opts) => ollamaBuildSummaryPrompt(opts),
        selectChatMessages:      ollamaSelectChatMessages,
    },
};

// ─── Internal resolver ─────────────────────────────────────────────────────────

function getProvider(name) {
    const p = PROVIDERS[name];
    if (!p) throw new Error(`Unknown provider "${name}". Available: ${Object.keys(PROVIDERS).join(', ')}`);
    return p;
}

// ─── Public unified interface ──────────────────────────────────────────────────

export function callChatAPI(cfg, { messages, systemPrompt, chatSummary, temperature, maxTokens, contextTokens }) {
    return getProvider(cfg.provider).callChat({
        messages, systemPrompt, chatSummary, temperature, maxTokens, contextTokens,
        keys:          cfg.keys,
        ollamaUrl:     cfg.ollamaUrl,
        model:         cfg.model ?? null,
        modelFallback: cfg.modelFallback ?? null,
    });
}

export function callMemoryAPI(cfg, { prompt, maxOutputTokens, priority = 'normal' }) {
    return getProvider(cfg.provider).callMemory({
        prompt, maxOutputTokens, priority,
        keys:          cfg.keys,
        ollamaUrl:     cfg.ollamaUrl,
        model:         cfg.model ?? null,
        modelFallback: cfg.modelFallback ?? null,
    });
}

export function callSummaryAPI(cfg, { prompt, maxOutputTokens }) {
    return getProvider(cfg.provider).callSummary({
        prompt, maxOutputTokens,
        keys:          cfg.keys,
        ollamaUrl:     cfg.ollamaUrl,
        model:         cfg.model ?? null,
        modelFallback: cfg.modelFallback ?? null,
    });
}

export function embedText(cfg, { text }) {
    return getProvider(cfg.provider).embedText({
        text,
        keys:      cfg.keys,
        ollamaUrl: cfg.ollamaUrl,
        model:     cfg.model ?? null,
    });
}

export function embedContents(cfg, { texts }) {
    return getProvider(cfg.provider).embedContents({
        texts,
        keys:      cfg.keys,
        ollamaUrl: cfg.ollamaUrl,
        model:     cfg.model ?? null,
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
