import { dbGet, dbGetAll, dbPut, dbDelete } from '../db.js';
import { STORES } from './types.js';

/**
 * IndexedDB wrapper scoped to companion AI object stores.
 * All persistence for agent state flows through this module.
 */

export function emotionStateId(chatId) {
    return `chat_${chatId}`;
}

export function sessionSummaryId(chatId) {
    return `session_${chatId}`;
}

// ── Memories ──────────────────────────────────────────────────────────────────

export async function getMemoryById(memoryId) {
    return dbGet(STORES.MEMORIES, memoryId);
}

export async function getMemoriesForChat(chatId) {
    return dbGetAll(STORES.MEMORIES, 'chatId', chatId);
}

export async function putMemory(record) {
    return dbPut(STORES.MEMORIES, record);
}

export async function deleteMemory(memoryId) {
    return dbDelete(STORES.MEMORIES, memoryId);
}

// ── Embeddings ────────────────────────────────────────────────────────────────

export async function getEmbeddingById(embeddingId) {
    return dbGet(STORES.EMBEDDINGS, embeddingId);
}

export async function getEmbeddingsForChat(chatId) {
    return dbGetAll(STORES.EMBEDDINGS, 'chatId', chatId);
}

export async function putEmbedding(record) {
    return dbPut(STORES.EMBEDDINGS, record);
}

export async function deleteEmbedding(embeddingId) {
    return dbDelete(STORES.EMBEDDINGS, embeddingId);
}

// ── Emotions ──────────────────────────────────────────────────────────────────

export async function getEmotionState(chatId) {
    return dbGet(STORES.EMOTIONS, emotionStateId(chatId));
}

export async function putEmotionState(state) {
    return dbPut(STORES.EMOTIONS, state);
}

// ── Goals ─────────────────────────────────────────────────────────────────────

export async function getGoalsForChat(chatId) {
    return dbGetAll(STORES.GOALS, 'chatId', chatId);
}

export async function getActiveGoalsForChat(chatId) {
    const all = await getGoalsForChat(chatId);
    return all.filter(g => g.status === 'active');
}

export async function putGoal(record) {
    return dbPut(STORES.GOALS, record);
}

export async function deleteGoal(goalId) {
    return dbDelete(STORES.GOALS, goalId);
}

// ── World state ───────────────────────────────────────────────────────────────

export async function getWorldState(chatId) {
    return dbGet(STORES.WORLD, chatId);
}

export async function putWorldState(state) {
    return dbPut(STORES.WORLD, state);
}

// ── Session summaries ─────────────────────────────────────────────────────────

export async function getSessionSummary(chatId) {
    return dbGet(STORES.SUMMARIES, sessionSummaryId(chatId));
}

export async function putSessionSummary(record) {
    return dbPut(STORES.SUMMARIES, record);
}

// ── Initiative metadata ───────────────────────────────────────────────────────

export async function getInitiativeMeta(chatId) {
    return dbGet(STORES.INITIATIVE_META, chatId) ?? {
        chatId,
        last_initiative_at: 0,
        last_user_message_at: Date.now(),
        cycle_count: 0,
    };
}

export async function putInitiativeMeta(meta) {
    return dbPut(STORES.INITIATIVE_META, meta);
}

/** Batch write companion records (sequential puts). */
export async function batchWrite({ memories = [], embeddings = [], goals = [], emotion = null, world = null, summary = null, initiativeMeta = null }) {
    for (const m of memories) await putMemory(m);
    for (const e of embeddings) await putEmbedding(e);
    for (const g of goals) await putGoal(g);
    if (emotion) await putEmotionState(emotion);
    if (world) await putWorldState(world);
    if (summary) await putSessionSummary(summary);
    if (initiativeMeta) await putInitiativeMeta(initiativeMeta);
}
