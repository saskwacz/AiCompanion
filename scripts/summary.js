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
    return { chatId, rolling: null, chunks: [], medium: [], global: null };
}

/** Migrate old single-record format → new tiered format. */
function migrateState(raw) {
    if (!raw) return null;
    if ('chunks' in raw) return raw;   // already new format
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

export async function deleteSummaryForChat(chatId) {
    await dbDelete('summaries', chatId);
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

/** Compute a medium summary from MEDIUM_FROM_CHUNKS chunk objects. */
export async function computeMedium(chunks, character, cfg, maxOutputTokens = 4096) {
    const charName = character?.name || 'Companion';
    const convText = chunks.map((c, i) =>
        `Sekcja ${i + 1} (wiad. ${c.fromMsg}–${c.toMsg}):\n${c.text}`
    ).join('\n\n---\n\n');
    const fromChunk = 0;   // relative within the passed slice
    const toChunk   = chunks.length - 1;
    const fromMsg   = chunks[0]?.fromMsg ?? 0;
    const toMsg     = chunks[chunks.length - 1]?.toMsg ?? 0;
    const prompt = providerBuildSummaryPrompt(cfg, { convText, charName, type: 'medium', fromMsg, toMsg });
    const text = await callSummaryAPI(cfg, { prompt, maxOutputTokens });
    return { id: genId(), text, fromChunk, toChunk, fromMsg, toMsg, createdAt: Date.now() };
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
