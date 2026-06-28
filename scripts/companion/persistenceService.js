import { dbTransaction } from '../db.js';
import { addMessage } from '../messages.js';
import { STORES } from './types.js';
import { emotionStateId, sessionSummaryId } from './readService.js';

/**
 * Persistence Layer — the ONLY module that writes companion state to IndexedDB.
 * Conversation messages (steps 1 & 6) use dedicated helpers.
 * State commits (steps 14 & 15) use atomic transactions.
 */

// ── Steps 1 & 6: conversation store ───────────────────────────────────────────

export async function appendUserMessage(chatId, content) {
    return addMessage(chatId, 'user', content);
}

export async function appendAssistantMessage(chatId, content) {
    return addMessage(chatId, 'assistant', content);
}

// ── Step 14: atomic state commit ──────────────────────────────────────────────

/**
 * @typedef {Object} StateCommitPayload
 * @property {object[]} memoriesPut
 * @property {string[]} memoriesDelete
 * @property {object[]} goalsPut
 * @property {string[]} goalsDelete
 * @property {object|null} emotion
 * @property {object|null} relationship
 * @property {object|null} world
 * @property {object|null} summary
 * @property {object[]} embeddingsPut
 * @property {string[]} embeddingsDelete
 */

/** @param {StateCommitPayload} payload */
export async function commitStateTransaction(payload) {
    const storeNames = [
        STORES.MEMORIES,
        STORES.EMBEDDINGS,
        STORES.GOALS,
        STORES.EMOTIONS,
        STORES.RELATIONSHIPS,
        STORES.WORLD,
        STORES.SUMMARIES,
    ];

    await dbTransaction(storeNames, 'readwrite', (stores) => {
        for (const id of payload.memoriesDelete ?? []) {
            stores[STORES.MEMORIES].delete(id);
        }
        for (const m of payload.memoriesPut ?? []) {
            stores[STORES.MEMORIES].put(m);
        }
        for (const id of payload.embeddingsDelete ?? []) {
            stores[STORES.EMBEDDINGS].delete(id);
        }
        for (const e of payload.embeddingsPut ?? []) {
            stores[STORES.EMBEDDINGS].put(e);
        }
        for (const id of payload.goalsDelete ?? []) {
            stores[STORES.GOALS].delete(id);
        }
        for (const g of payload.goalsPut ?? []) {
            stores[STORES.GOALS].put(g);
        }
        if (payload.emotion) {
            stores[STORES.EMOTIONS].put(payload.emotion);
        }
        if (payload.relationship) {
            stores[STORES.RELATIONSHIPS].put(payload.relationship);
        }
        if (payload.world) {
            stores[STORES.WORLD].put(payload.world);
        }
        if (payload.summary) {
            stores[STORES.SUMMARIES].put(payload.summary);
        }
    });
}

// ── Step 15: embedding commit (separate atomic transaction) ───────────────────

export async function commitEmbeddingUpdates({ memoriesPut = [], embeddingsPut = [], embeddingsDelete = [] }) {
    await dbTransaction([STORES.MEMORIES, STORES.EMBEDDINGS], 'readwrite', (stores) => {
        for (const id of embeddingsDelete) stores[STORES.EMBEDDINGS].delete(id);
        for (const e of embeddingsPut) stores[STORES.EMBEDDINGS].put(e);
        for (const m of memoriesPut) stores[STORES.MEMORIES].put(m);
    });
}

// ── Step 16: initiative queue ─────────────────────────────────────────────────

export async function recordUserActivity(chatId) {
    const { readInitiativeMeta } = await import('./readService.js');
    const meta = await readInitiativeMeta(chatId);
    await dbTransaction([STORES.INITIATIVE_META], 'readwrite', (stores) => {
        stores[STORES.INITIATIVE_META].put({
            ...meta,
            chatId,
            last_user_message_at: Date.now(),
        });
    });
}

export async function enqueueInitiative(chatId, initiative) {
    if (!initiative) return null;
    const { readInitiativeMeta } = await import('./readService.js');
    const meta = await readInitiativeMeta(chatId);
    const record = {
        initiative_id: crypto.randomUUID(),
        chatId,
        ...initiative,
        created_at: Date.now(),
        displayed: false,
    };
    await dbTransaction([STORES.INITIATIVE_QUEUE, STORES.INITIATIVE_META], 'readwrite', (stores) => {
        stores[STORES.INITIATIVE_QUEUE].put(record);
        stores[STORES.INITIATIVE_META].put({
            ...meta,
            chatId,
            last_initiative_at: Date.now(),
            cycle_count: (meta.cycle_count || 0) + 1,
        });
    });
    return record;
}

// ── Step 17: idle state commit ────────────────────────────────────────────────

export async function commitIdleUpdates(payload) {
    return commitStateTransaction(payload);
}

export function buildSummaryRecord(chatId, summary, keyEvents = []) {
    return {
        session_id: sessionSummaryId(chatId),
        chatId,
        summary,
        key_events: keyEvents,
        created_at: Date.now(),
    };
}

export { emotionStateId, sessionSummaryId };
