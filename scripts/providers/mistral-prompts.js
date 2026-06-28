/**
 * mistral-prompts.js — Prompt builders for the Mistral provider.
 */

import {
    getPrompts,
    selectChatMessages,
    buildChatSystemPrompt,
} from './prompts.js';

import {
    buildMemoryUpdatePrompt as sharedMemoryUpdate,
    buildMemorySeedPrompt   as sharedMemorySeed,
} from './memory-prompt-shared.js';

export { selectChatMessages };

export function buildSystemPrompt(lang, character, memCtx) {
    return getPrompts(lang).buildSystemPrompt(character, memCtx);
}

export function buildMemoryUpdatePrompt(lang, existing, character, recentMessages, userMsg, aiMsg) {
    return sharedMemoryUpdate(lang, existing, character, recentMessages, userMsg, aiMsg, { ultra: true });
}

export function buildMemorySeedPrompt(lang, character) {
    return sharedMemorySeed(lang, character, { seed: true });
}

export function buildSummaryPrompt(lang, opts) {
    return getPrompts(lang).buildSummaryPrompt(opts);
}

export { buildChatSystemPrompt };
