import { dbGet, dbPut, dbDelete } from './db.js';
import { callSummaryAPI, buildSummaryPrompt as providerBuildSummaryPrompt } from './providers/index.js';

/** How many AI responses between automatic summaries. */
export const AI_RESPONSES_PER_SUMMARY = 10;

/**
 * How many messages to always send verbatim (never summarised).
 * These are the most recent messages kept as live context.
 */
export const RECENT_WINDOW = 20;

// ============ CRUD ============
export async function getSummaryForChat(chatId) {
    return (await dbGet('summaries', chatId)) || null;
}

export async function saveSummaryForChat(chatId, text, upToMessageCount) {
    await dbPut('summaries', { chatId, text, upToMessageCount, createdAt: Date.now() });
}

export async function deleteSummaryForChat(chatId) {
    await dbDelete('summaries', chatId);
}

// ============ TRIGGER LOGIC ============
export function shouldAutoSummarize(messages, existingSummary, everyN = AI_RESPONSES_PER_SUMMARY) {
    const baseline           = existingSummary?.upToMessageCount ?? 0;
    const newMessages        = messages.slice(baseline);
    const aiSinceLastSummary = newMessages.filter(m => m.role === 'assistant').length;
    return aiSinceLastSummary >= everyN;
}

// ============ GENERATION ============
/**
 * Builds a new rolling summary covering all messages except the last RECENT_WINDOW.
 * If a previous summary exists it is folded in so context accumulates.
 *
 * @param {string}   chatId
 * @param {object[]} messages
 * @param {object}   character
 * @param {object}   existingSummary
 * @param {object}   cfg             — providerConfig from getProviderConfig()
 * @param {number}  [maxOutputTokens]
 */
export async function generateAndSaveSummary(chatId, messages, character, existingSummary, cfg, maxOutputTokens = 8192) {
    const cutoff      = Math.max(0, messages.length - RECENT_WINDOW);
    const toSummarise = messages.slice(0, cutoff);

    if (toSummarise.length === 0) return existingSummary;

    const charName  = character?.name || 'Companion';
    const convText  = toSummarise
        .map(m => `${m.role === 'user' ? 'User' : charName}: ${m.content}`)
        .join('\n\n');

    const prompt = providerBuildSummaryPrompt(cfg, {
        convText,
        charName,
        previousSummaryText: existingSummary?.text,
    });

    const text = await callSummaryAPI(cfg, { prompt, maxOutputTokens });

    const record = { chatId, text, upToMessageCount: cutoff, createdAt: Date.now() };
    await saveSummaryForChat(chatId, text, cutoff);
    return record;
}
