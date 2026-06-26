/**
 * summary.js — Multi-tier rolling summary system.
 *
 * TIERS (built every 50 messages, except rolling which is every message):
 *   rolling — concise recap of the last ROLLING_WINDOW messages (live context)
 *   chunks  — detailed summary of each CHUNK_SIZE-message window (historical)
 *   medium  — overview built from every MEDIUM_FROM_CHUNKS chunks (~1000 messages)
 *   global  — master summary built from every GLOBAL_FROM_MEDIUMS medium summaries
 *
 * Only rolling is included in the system prompt at chat-time.
 * Chunks/medium/global form layered historical context in buildSummaryContext().
 *
 * ALL-OR-NOTHING: compute functions never write to DB. Callers (triggerBackgroundTasks)
 * commit everything atomically after all computations succeed.
 */

import { dbGet, dbPut, dbDelete } from './db.js';
import {
    callSummaryAPI,
    buildSummaryPrompt as providerBuildSummaryPrompt,
} from './providers/index.js';

// ─── Constants ────────────────────────────────────────────────────────────────
export const ROLLING_WINDOW     = 50;  // messages in rolling summary
export const CHUNK_SIZE         = 50;  // messages per detailed chunk
export const MEDIUM_FROM_CHUNKS = 20;  // chunks needed to form one medium summary
export const GLOBAL_FROM_MEDIUMS= 20;  // mediums needed to form a global summary

// ─── State helpers ────────────────────────────────────────────────────────────
function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function defaultState(chatId) {
    return { chatId, rolling: null, chunks: [], medium: [], global: null, prohibitedMsgIds: [] };
}

/** Migrate old single-record format → new tiered format. */
function migrateState(raw) {
    if (!raw) return null;
    if ('chunks' in raw) {
        // Ensure new field exists on legacy tiered records
        if (!raw.prohibitedMsgIds) raw.prohibitedMsgIds = [];
        return raw;
    }
    // Old: { chatId, text, upToMessageCount, createdAt }
    const state = defaultState(raw.chatId);
    if (raw.text) {
        state.rolling = { text: raw.text, updatedAt: raw.createdAt ?? Date.now() };
    }
    return state;
}

// ─── DB ──────────────────────────────────────────────────────────────────────
export async function getSummaryState(chatId) {
    const raw = await dbGet('summaries', chatId);
    return migrateState(raw) ?? defaultState(chatId);
}

export async function saveSummaryState(state) {
    await dbPut('summaries', { ...state, savedAt: Date.now() });
}

/** Mark a message ID as prohibited (excluded from L1 chunk computation). */
export function markMsgProhibited(state, msgId) {
    const ids = state.prohibitedMsgIds ?? [];
    if (ids.includes(msgId)) return state;
    return { ...state, prohibitedMsgIds: [...ids, msgId] };
}

/** Remove message IDs from the prohibited list (called after message deletion). */
export function cleanProhibitedIds(state, deletedIds) {
    const deleted = new Set(deletedIds);
    return { ...state, prohibitedMsgIds: (state.prohibitedMsgIds ?? []).filter(id => !deleted.has(id)) };
}

export async function deleteSummaryForChat(chatId) {
    await dbDelete('summaries', chatId);
}

/** Prepare summary state for JSON export. */
export function summaryForExport(state) {
    if (!state) return null;
    const s = migrateState(state);
    return {
        rolling:          s.rolling          ?? null,
        chunks:           s.chunks           ?? [],
        medium:           s.medium           ?? [],
        global:           s.global           ?? null,
        prohibitedMsgIds: s.prohibitedMsgIds ?? [],
    };
}

/** Restore summary state from an imported JSON object. */
export function summaryFromImport(data, chatId) {
    if (!data) return null;
    if ('chunks' in data) {
        return {
            chatId,
            rolling:          data.rolling          ?? null,
            chunks:           data.chunks           ?? [],
            medium:           data.medium           ?? [],
            global:           data.global           ?? null,
            prohibitedMsgIds: data.prohibitedMsgIds ?? [],
        };
    }
    if (data.text) {
        return {
            chatId,
            rolling:          { text: data.text, updatedAt: data.createdAt ?? Date.now() },
            chunks:           [],
            medium:           [],
            global:           null,
            prohibitedMsgIds: [],
        };
    }
    return null;
}

// ─── Prohibited-content helper ────────────────────────────────────────────────
export function isProhibitedContent(err) {
    return /PROHIBITED|blocked by Gemini|SAFETY|RECITATION/i.test(err?.message ?? '');
}

// ─── Key rotator (distributes binary-search calls across available API keys) ──
function _makeKeyRotator(keys) {
    const pool = (Array.isArray(keys) ? [...keys] : [keys]).filter(Boolean);
    if (!pool.length) return () => keys; // passthrough if empty
    // Shuffle so different calls start from different positions
    pool.sort(() => Math.random() - 0.5);
    let idx = 0;
    return () => pool[idx++ % pool.length];
}

/**
 * Test whether a set of messages can be summarized without PROHIBITED error.
 * Uses computeChunk as the oracle (works for arbitrary subsets).
 * Returns true = OK, false = prohibited, throws on other errors.
 */
async function _testSubset(msgs, char, cfg, maxTok) {
    try {
        await computeChunk(msgs, char, cfg, maxTok);
        return true;
    } catch (e) {
        if (isProhibitedContent(e)) return false;
        throw e;
    }
}

/**
 * Binary search within msgs to identify which specific messages trigger
 * PROHIBITED CONTENT. Each recursive call uses the next key from nextKey()
 * to distribute load across available API keys.
 *
 * Returns an array of message IDs that are problematic.
 */
async function _findProhibitedMsgs(msgs, char, cfg, maxTok, nextKey, depth = 0) {
    const MAX_DEPTH = 10; // log2(1024) = 10, covers up to 1024 messages
    if (msgs.length === 0) return [];

    // Base case: test the single message directly
    if (msgs.length === 1) {
        const ok = await _testSubset(msgs, char, { ...cfg, keys: nextKey() }, maxTok);
        if (!ok) {
            console.warn(`[Summary] Found prohibited message: id=${msgs[0].id} seq=${msgs[0].seqId}`);
            return [msgs[0].id];
        }
        // Single message passes on its own — prohibited content comes from combination
        // (very rare); caller should mark the junction instead
        return [];
    }

    // Safety: stop splitting if too deep
    if (depth >= MAX_DEPTH) {
        console.warn(`[Summary] Binary search max depth reached — marking ${msgs.length} msgs`);
        return msgs.map(m => m.id);
    }

    const mid    = Math.floor(msgs.length / 2);
    const first  = msgs.slice(0, mid);
    const second = msgs.slice(mid);

    // Test each half with a different key to stay within per-minute quota
    const firstOk  = await _testSubset(first,  char, { ...cfg, keys: nextKey() }, maxTok);
    const secondOk = await _testSubset(second, char, { ...cfg, keys: nextKey() }, maxTok);

    const prohibited = [];
    if (!firstOk)  prohibited.push(...await _findProhibitedMsgs(first,  char, cfg, maxTok, nextKey, depth + 1));
    if (!secondOk) prohibited.push(...await _findProhibitedMsgs(second, char, cfg, maxTok, nextKey, depth + 1));

    // If both halves pass individually but the combined set fails, the issue is
    // likely in the context interaction at the boundary — mark the junction message.
    if (prohibited.length === 0) {
        console.warn('[Summary] Binary search inconclusive — marking junction message');
        return [msgs[mid - 1].id]; // last message of first half (the boundary)
    }
    return prohibited;
}

// ─── Fallback compute wrappers ────────────────────────────────────────────────
/**
 * Rolling fallback with binary-search identification of prohibited messages.
 *
 * Returns { rolling: RollingObj|null, prohibitedIds: number[] }
 *
 * Strategy:
 *   1. Try full window → if OK, return immediately.
 *   2. Assume last message is the culprit — try without it.
 *   3. If still failing → binary-search the full window.
 *   4. Filter out the found prohibited IDs and retry rolling.
 *   5. If still failing (multiple bad messages) → return rolling=null.
 */
export async function computeRollingFallback(msgs, char, cfg, maxTok) {
    // 1. Try the full window
    try {
        const rolling = await computeRolling(msgs, char, cfg, maxTok);
        return { rolling, prohibitedIds: [] };
    } catch (e) {
        if (!isProhibitedContent(e)) throw e;
    }

    const nextKey = _makeKeyRotator(cfg.keys);

    // 2. Try without the last message (the most likely culprit in a rolling window)
    if (msgs.length > 1) {
        const withoutLast = msgs.slice(0, -1);
        try {
            const rolling = await computeRolling(withoutLast, char, { ...cfg, keys: nextKey() }, maxTok);
            const lastId  = msgs.at(-1).id;
            console.warn(`[Summary] Rolling: last message (id=${lastId}) is prohibited`);
            return { rolling, prohibitedIds: [lastId] };
        } catch (e) {
            if (!isProhibitedContent(e)) throw e;
        }
    }

    // 3. Binary-search the full window to pinpoint all prohibited messages
    console.warn(`[Summary] Rolling: binary-searching ${msgs.length} messages for prohibited content`);
    const prohibitedIds = await _findProhibitedMsgs(msgs, char, cfg, maxTok, nextKey);

    if (!prohibitedIds.length) return { rolling: null, prohibitedIds: [] };

    // 4. Retry rolling with all prohibited messages filtered out
    const clean = msgs.filter(m => !prohibitedIds.includes(m.id));
    if (clean.length >= 3) {
        try {
            const rolling = await computeRolling(clean, char, { ...cfg, keys: nextKey() }, maxTok);
            return { rolling, prohibitedIds };
        } catch (e) {
            if (!isProhibitedContent(e)) throw e;
        }
    }

    return { rolling: null, prohibitedIds };
}

/**
 * Chunk fallback with binary-search identification of prohibited messages.
 *
 * Returns { chunks: ChunkObj[], prohibited: number[] (msg IDs) }
 *
 * Strategy:
 *   1. Try full chunk → if OK, return immediately.
 *   2. Binary-search to find the specific prohibited message(s).
 *   3. Filter those out and retry computing the chunk.
 *   4. If the clean chunk still fails, return chunks=[] (give up on this window).
 */
export async function computeChunkFallback(msgs, char, cfg, maxTok) {
    // 1. Try the full chunk
    try {
        const chunk = await computeChunk(msgs, char, cfg, maxTok);
        return { chunks: [chunk], prohibited: [] };
    } catch (e) {
        if (!isProhibitedContent(e)) throw e;
    }

    // 2. Binary-search to identify the problematic messages
    console.warn(`[Summary] L1: binary-searching ${msgs.length} messages for prohibited content`);
    const nextKey       = _makeKeyRotator(cfg.keys);
    const prohibitedIds = await _findProhibitedMsgs(msgs, char, cfg, maxTok, nextKey);

    if (!prohibitedIds.length) return { chunks: [], prohibited: [] };

    // 3. Retry chunk with prohibited messages removed
    const clean = msgs.filter(m => !prohibitedIds.includes(m.id));
    if (clean.length >= 3) {
        try {
            const chunk = await computeChunk(clean, char, { ...cfg, keys: nextKey() }, maxTok);
            return { chunks: [chunk], prohibited: prohibitedIds };
        } catch (e) {
            if (!isProhibitedContent(e)) throw e;
            // Even the clean set failed — expand the prohibited list via another pass
            const extraIds = await _findProhibitedMsgs(clean, char, cfg, maxTok, nextKey);
            return { chunks: [], prohibited: [...prohibitedIds, ...extraIds] };
        }
    }

    return { chunks: [], prohibited: prohibitedIds };
}

// ─── Context builder for chat system prompt ───────────────────────────────────
/**
 * Build a layered historical context string from the summary state.
 * Ordered from oldest (global) to most recent (chunks just before rolling window).
 * The rolling summary itself is NOT included — the live messages cover that window.
 */
export function buildSummaryContext(state) {
    if (!state) return '';
    const parts = [];

    // ── Global: covers floor(medium.length/GLOBAL_FROM_MEDIUMS) mediums ──
    const mediumsCoveredByGlobal = state.global
        ? Math.floor(state.medium.length / GLOBAL_FROM_MEDIUMS) * GLOBAL_FROM_MEDIUMS
        : 0;

    if (state.global?.text) {
        parts.push(`[GLOBALNY KONTEKST — całość historii rozmowy]\n${state.global.text}`);
    }

    // ── Orphan mediums (after global) ──
    const orphanMediums = state.medium.slice(mediumsCoveredByGlobal);
    if (orphanMediums.length > 0) {
        const mt = orphanMediums.map((m, i) => {
            const n = mediumsCoveredByGlobal + i + 1;
            return `Część ${n} (wiad. ${m.fromMsg}–${m.toMsg}):\n${m.text}`;
        }).join('\n\n');
        parts.push(`[PODSUMOWANIA POŚREDNIE (~1000 wiadomości/część)]\n${mt}`);
    }

    // ── Orphan chunks (after last medium) ──
    const chunksCoveredByMedium = state.medium.length > 0
        ? state.medium[state.medium.length - 1].toChunk + 1
        : 0;
    const orphanChunks = state.chunks.slice(chunksCoveredByMedium);
    if (orphanChunks.length > 0) {
        const ct = orphanChunks.map((c, i) => {
            const n = chunksCoveredByMedium + i + 1;
            return `Okno ${n} (wiad. ${c.fromMsg}–${c.toMsg}):\n${c.text}`;
        }).join('\n\n');
        parts.push(`[SZCZEGÓŁOWE PODSUMOWANIA (~50 wiadomości/okno)]\n${ct}`);
    }

    return parts.join('\n\n' + '─'.repeat(48) + '\n\n');
}

// ─── Trigger logic ────────────────────────────────────────────────────────────
/**
 * Returns true when there are enough messages for a new chunk to be finalised
 * (i.e., the chunk has exited the rolling window).
 */
export function shouldBuildChunk(messages, state) {
    const needed = (state.chunks.length + 1) * CHUNK_SIZE + ROLLING_WINDOW;
    return messages.length >= needed;
}

// ─── Compute functions (NO DB writes) ────────────────────────────────────────

/** Compute rolling summary of the last ROLLING_WINDOW messages. */
export async function computeRolling(messages, character, cfg, maxOutputTokens = 4096) {
    const window = messages.slice(-ROLLING_WINDOW);
    if (window.length < 2) return null;
    const charName = character?.name || 'Companion';
    const convText = window
        .map(m => `${m.role === 'user' ? 'User' : charName}: ${m.content}`)
        .join('\n\n');
    const prompt = providerBuildSummaryPrompt(cfg, { convText, charName, type: 'rolling' });
    const text = await callSummaryAPI(cfg, { prompt, maxOutputTokens });
    return { text, updatedAt: Date.now() };
}

/** Compute a detailed chunk summary for a specific window of messages. */
export async function computeChunk(chunkMsgs, character, cfg, maxOutputTokens = 4096) {
    const charName = character?.name || 'Companion';
    const fromMsg  = chunkMsgs[0]?.seqId  ?? 0;
    const toMsg    = chunkMsgs[chunkMsgs.length - 1]?.seqId ?? chunkMsgs.length - 1;
    const convText = chunkMsgs
        .map(m => `${m.role === 'user' ? 'User' : charName}: ${m.content}`)
        .join('\n\n');
    const prompt = providerBuildSummaryPrompt(cfg, { convText, charName, type: 'chunk', fromMsg, toMsg });
    const text = await callSummaryAPI(cfg, { prompt, maxOutputTokens });
    return { id: genId(), text, fromMsg, toMsg, createdAt: Date.now() };
}

/** Compute a medium summary from a slice of chunk objects.
 *  fromChunkAbs — absolute index of the first chunk in state.chunks (used for staleness checks). */
export async function computeMedium(chunks, character, cfg, maxOutputTokens = 4096, fromChunkAbs = 0) {
    const charName    = character?.name || 'Companion';
    const convText    = chunks.map((c, i) =>
        `Sekcja ${i + 1} (wiad. ${c.fromMsg}–${c.toMsg}):\n${c.text}`
    ).join('\n\n---\n\n');
    const fromChunkAbs_ = fromChunkAbs;
    const toChunkAbs    = fromChunkAbs + chunks.length - 1;
    const fromMsg   = chunks[0]?.fromMsg ?? 0;
    const toMsg     = chunks[chunks.length - 1]?.toMsg ?? 0;
    const prompt = providerBuildSummaryPrompt(cfg, { convText, charName, type: 'medium', fromMsg, toMsg });
    const text = await callSummaryAPI(cfg, { prompt, maxOutputTokens });
    return { id: genId(), text, fromChunkAbs: fromChunkAbs_, toChunkAbs, fromMsg, toMsg, createdAt: Date.now() };
}

/** Compute a global summary from all medium summaries. */
export async function computeGlobal(mediums, character, cfg, maxOutputTokens = 8192) {
    const charName = character?.name || 'Companion';
    const convText = mediums.map((m, i) =>
        `Część ${i + 1} (wiad. ${m.fromMsg}–${m.toMsg}):\n${m.text}`
    ).join('\n\n---\n\n');
    const prompt = providerBuildSummaryPrompt(cfg, { convText, charName, type: 'global' });
    const text = await callSummaryAPI(cfg, { prompt, maxOutputTokens });
    return { text, createdAt: Date.now() };
}

// ─── Backward-compat helpers ──────────────────────────────────────────────────
/** @deprecated Use computeRolling + saveSummaryState directly. */
export async function generateAndSaveSummary(chatId, messages, character, existingState, cfg, maxOutputTokens = 8192) {
    const state     = existingState && 'chunks' in existingState
        ? existingState
        : (existingState ? migrateState(existingState) : null) ?? await getSummaryState(chatId);
    const newRolling = await computeRolling(messages, character, cfg, maxOutputTokens);
    const newState   = { ...state, rolling: newRolling ?? state.rolling };
    await saveSummaryState(newState);
    return newState;
}

/** @deprecated Use shouldBuildChunk. Kept for callers that haven't migrated. */
export function shouldAutoSummarize(messages, _existingSummary, everyN = 50) {
    return messages.filter(m => m.role === 'assistant').length % everyN === 0;
}

// Legacy shim for getSummaryForChat — returns the full state so callers don't break.
export const getSummaryForChat = getSummaryState;
// Legacy shim for saveSummaryForChat.
export async function saveSummaryForChat(chatId, text, upToMessageCount) {
    const state = await getSummaryState(chatId);
    state.rolling = { text, updatedAt: Date.now() };
    await saveSummaryState(state);
}
