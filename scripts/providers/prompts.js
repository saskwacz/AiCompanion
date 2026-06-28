/**
 * prompts.js — Language dispatcher and shared prompt utilities.
 */

import * as pl from './prompts-pl.js';
import * as en from './prompts-en.js';

export function getPrompts(lang = 'pl') {
    return lang === 'en' ? en : pl;
}

const TOKENS_PER_WORD = 1.3;

export function trimMessagesByTokens(messages, maxContextTokens) {
    let count = 0;
    const result = [];
    for (let i = messages.length - 1; i >= 0; i--) {
        const tokens = Math.ceil(messages[i].content.split(/\s+/).length * TOKENS_PER_WORD);
        if (count + tokens <= maxContextTokens) { result.unshift(messages[i]); count += tokens; }
        else break;
    }
    return result;
}

const RECENT_WINDOW   = 50;
const CHAT_MSG_WINDOW = 20;

export function selectChatMessages(messages, chatSummary, contextTokens) {
    if (chatSummary?.text || chatSummary?.rolling) {
        const recent = messages.slice(-CHAT_MSG_WINDOW);
        let i = 0;
        while (i < recent.length && recent[i].role !== 'user') i++;
        return recent.slice(i);
    }
    let recent = trimMessagesByTokens(messages, contextTokens);
    while (recent.length > 0 && recent[0].role !== 'user') recent = recent.slice(1);
    return recent;
}

export function buildChatSystemPrompt(systemPrompt, chatSummary) {
    if (!chatSummary?.text && !chatSummary?.rolling) return systemPrompt;

    const parts = [systemPrompt];

    if (chatSummary.text) {
        parts.push(
            '[HISTORIA ROZMOWY — kontekst historyczny]\n' +
            'Poniżej znajduje się podsumowanie wszystkiego, co wydarzyło się przed ostatnimi wiadomościami. ' +
            'Traktuj to jako pełny kontekst bieżącej rozmowy:\n\n' +
            chatSummary.text
        );
    }

    if (chatSummary.rolling) {
        parts.push(
            '[OSTATNIE СОБЫТИЯ — rolling summary]\n' +
            'Skrót ostatnich ~50 wiadomości (bezpośrednio przed widocznym oknem rozmowy):\n\n' +
            chatSummary.rolling
        );
    }

    return parts.join('\n\n');
}

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
