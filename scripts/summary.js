import { dbGet, dbPut, dbDelete } from './db.js';

const SUMMARY_MODEL_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';

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
/**
 * Returns true when we have accumulated AI_RESPONSES_PER_SUMMARY new AI
 * messages since the last summary was generated.
 */
export function shouldAutoSummarize(messages, existingSummary, everyN = AI_RESPONSES_PER_SUMMARY) {
    const baseline      = existingSummary?.upToMessageCount ?? 0;
    const newMessages   = messages.slice(baseline);
    const aiSinceLastSummary = newMessages.filter(m => m.role === 'assistant').length;
    return aiSinceLastSummary >= everyN;
}

// ============ GENERATION ============
/**
 * Builds a new rolling summary covering all messages except the last RECENT_WINDOW.
 * If a previous summary exists it is folded in so context accumulates.
 *
 * Saves the result to IndexedDB and returns the new summary record.
 */
export async function generateAndSaveSummary(chatId, messages, character, existingSummary, apiKey, maxOutputTokens = 8192) {
    // Summarise everything except the tail kept verbatim
    const cutoff     = Math.max(0, messages.length - RECENT_WINDOW);
    const toSummarise = messages.slice(0, cutoff);

    if (toSummarise.length === 0) return existingSummary;

    const charName   = character?.name || 'Companion';
    const convText   = toSummarise
        .map(m => `${m.role === 'user' ? 'User' : charName}: ${m.content}`)
        .join('\n\n');

    const prevSection = existingSummary?.text
        ? `PREVIOUS SUMMARY (incorporate this):\n${existingSummary.text}\n\n---\n\n`
        : '';

    const prompt =
`${prevSection}Write a comprehensive, detailed summary of the conversation below.
This summary will REPLACE the full history in future API calls, so include everything important.

Cover:
- All topics discussed and decisions made
- Important facts revealed about the user (name, age, job, hobbies, relationships, etc.)
- Key moments and memorable exchanges
- Emotional tone and relationship dynamic between user and ${charName}
- Any running themes, promises, inside jokes, or ongoing topics
- Anything that might be referenced in future messages

Be thorough and specific — omit nothing significant.

CONVERSATION:
${convText}`;

    const items = Array.isArray(apiKey) ? apiKey : [apiKey];
    let text, lastErr;
    for (const item of items) {
        const key   = typeof item === 'string' ? item : item.key;
        const label = typeof item === 'string' ? `…${key.slice(-6)}` : (item.label || `…${key.slice(-6)}`);
        console.log(`[API] Auto-summary → key: "${label}"`);
        if (window.DEBUG_PROMPTS) {
            console.groupCollapsed('[Prompt] Auto-summary');
            console.log(prompt);
            console.groupEnd();
        }
        try {
            const r = await fetch(`${SUMMARY_MODEL_URL}?key=${key}`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({
                    contents:         [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.3, maxOutputTokens, topP: 0.95 },
                }),
            });
            if (!r.ok) {
                const err = await r.json().catch(() => ({}));
                throw new Error(`Summary API error ${r.status}: ${err.error?.message || ''}`);
            }
            const data = await r.json();
            text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) throw new Error('Empty summary response');
            break;
        } catch (e) {
            lastErr = e;
            console.warn(`[Summary] "${label}" failed:`, e.message);
            if (items.indexOf(item) < items.length - 1) {
                console.log('[Summary] Waiting 5 s before trying next key…');
                await new Promise(r => setTimeout(r, 5000));
            }
        }
    }
    if (!text) throw lastErr;

    const record = { chatId, text, upToMessageCount: cutoff, createdAt: Date.now() };
    await saveSummaryForChat(chatId, text, cutoff);
    return record;
}
