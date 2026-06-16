/**
 * openai-prompts.js — prompt builders for the OpenAI provider.
 */

import {
    getPrompts,
    selectChatMessages,
    buildChatSystemPrompt,
} from './gemini-prompts.js';

export { selectChatMessages, buildChatSystemPrompt };

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
