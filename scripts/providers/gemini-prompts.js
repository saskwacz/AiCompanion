/**
 * gemini-prompts.js
 *
 * Language dispatcher for Gemini prompt builders.
 *
 * Language-sensitive builders (system prompt, memory, summary) are delegated
 * to the appropriate locale file:
 *   gemini-prompts-pl.js  — Polish
 *   gemini-prompts-en.js  — English
 *
 * Language-neutral utilities (token trimming, message selection, Gemini
 * contents format) are kept here and re-exported directly.
 */

import * as pl from './gemini-prompts-pl.js';
import * as en from './gemini-prompts-en.js';

// ─── Language resolver ────────────────────────────────────────────────────────

/** Return the correct prompt module for the given language code. */
export function getPrompts(lang = 'pl') {
    return lang === 'en' ? en : pl;
}

// ─── Language-neutral utilities ───────────────────────────────────────────────

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

const RECENT_WINDOW   = 50;   // rolling summary window (matches summary.js ROLLING_WINDOW)
const CHAT_MSG_WINDOW = 20;   // verbatim messages sent when historical context is present

export function selectChatMessages(messages, chatSummary, contextTokens) {
    // When we have historical context (summaries), send only the recent verbatim window.
    // Rolling summary covers the last RECENT_WINDOW messages so 20 verbatim is enough.
    if (chatSummary?.text || chatSummary?.rolling) {
        const recent = messages.slice(-CHAT_MSG_WINDOW);
        let i = 0;
        while (i < recent.length && recent[i].role !== 'user') i++;
        return recent.slice(i);
    }
    // No summaries yet — trim by token budget and always start on a user turn.
    let recent = trimMessagesByTokens(messages, contextTokens);
    while (recent.length > 0 && recent[0].role !== 'user') recent = recent.slice(1);
    return recent;
}

/** Assemble the full system prompt with memory, historical summaries and rolling summary. */
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

/** Map app messages → Gemini `contents` array. */
export function buildChatContents(recentMessages) {
    const contents = recentMessages.map(m => ({
        role:  m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }],
    }));
    if (contents.length === 0) {
        contents.push({ role: 'user', parts: [{ text: '(continue the conversation)' }] });
    }
    return contents;
}

// ─── Language-dispatched exports ──────────────────────────────────────────────
// These are called by providers/index.js with an explicit `lang` first argument.

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
