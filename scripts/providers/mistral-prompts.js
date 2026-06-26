/**
 * mistral-prompts.js
 *
 * Prompt builders for the Mistral provider.
 * Delegates to the same language files as Gemini — the underlying prompt
 * content is provider-agnostic; only the API transport differs.
 *
 * Mistral uses OpenAI-style messages (role/content), so we reuse Gemini's
 * language-aware builders (pl/en) and the shared selectChatMessages utility.
 */

import {
    getPrompts,
    selectChatMessages,
    buildChatSystemPrompt,
} from './gemini-prompts.js';

import {
    buildMemoryUpdatePrompt as sharedMemoryUpdate,
    buildMemorySeedPrompt   as sharedMemorySeed,
} from './memory-prompt-shared.js';

export { selectChatMessages };

export function buildSystemPrompt(lang, character, memCtx) {
    return getPrompts(lang).buildSystemPrompt(character, memCtx);
}

/** Mistral: ultra-compact memory prompts (smaller default models). */
export function buildMemoryUpdatePrompt(lang, existing, character, recentMessages, userMsg, aiMsg) {
    return sharedMemoryUpdate(lang, existing, character, recentMessages, userMsg, aiMsg, { ultra: true });
}

export function buildMemorySeedPrompt(lang, character) {
    return sharedMemorySeed(lang, character, { ultra: true });
}

export function buildSummaryPrompt(lang, opts) {
    return getPrompts(lang).buildSummaryPrompt(opts);
}

/**
 * Build the full system prompt string with memory and summary context injected.
 * Mistral uses the same system-prompt construction as Gemini.
 */
export { buildChatSystemPrompt };
