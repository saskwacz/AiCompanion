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

function sameChatMessage(a, b) {
    if (!a || !b) return false;
    if (a.id != null && b.id != null) return a.id === b.id;
    return a.role === b.role && a.content === b.content;
}

/** First assistant message before any user turn — the welcome opener. */
export function getOpeningWelcomeMessage(messages) {
    if (!messages?.length || messages[0].role !== 'assistant') return null;
    const firstUserIdx = messages.findIndex(m => m.role === 'user');
    if (firstUserIdx === 0) return null;
    return messages[0];
}

export function selectChatMessages(messages, chatSummary, contextTokens) {
    let recent;
    if (chatSummary?.text || chatSummary?.rolling) {
        recent = messages.slice(-CHAT_MSG_WINDOW);
    } else {
        recent = trimMessagesByTokens(messages, contextTokens);
    }

    if (!recent.length) return recent;

    const welcome = getOpeningWelcomeMessage(messages);
    if (!welcome) {
        let i = 0;
        while (i < recent.length && recent[i].role !== 'user') i++;
        return recent.slice(i);
    }

    const welcomeInRecent = recent.find(m => sameChatMessage(m, welcome));
    if (!welcomeInRecent) {
        let i = 0;
        while (i < recent.length && recent[i].role !== 'user') i++;
        return recent.slice(i);
    }

    const firstUserIdx = recent.findIndex(m => m.role === 'user');
    if (firstUserIdx === -1) return [welcomeInRecent];

    const fromFirstUser = recent.slice(firstUserIdx);
    if (sameChatMessage(fromFirstUser[0], welcomeInRecent)) return fromFirstUser;
    return [welcomeInRecent, ...fromFirstUser];
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
