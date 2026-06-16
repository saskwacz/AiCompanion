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

export { selectChatMessages };

// ─── Language-aware builders (delegated to pl/en modules) ─────────────────────

export function buildSystemPrompt(lang, character, memCtx) {
    return getPrompts(lang).buildSystemPrompt(character, memCtx);
}

export function buildMemoryUpdatePrompt(lang, existing, character, recentMessages, userMsg, aiMsg) {
    return getPrompts(lang).buildMemoryUpdatePrompt(existing, character, recentMessages, userMsg, aiMsg);
}

export function buildMemorySeedPrompt(lang, character) {
    return getPrompts(lang).buildMemorySeedPrompt(character);
}

export function buildSummaryPrompt(lang, opts) {
    return getPrompts(lang).buildSummaryPrompt(opts);
}

/**
 * Build the full system prompt string with memory and summary context injected.
 * Mistral uses the same system-prompt construction as Gemini.
 */
export { buildChatSystemPrompt };
