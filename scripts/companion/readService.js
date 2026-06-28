import { dbGet, dbGetAll } from '../db.js';
import { STORES } from './types.js';
import { defaultEmotionState } from './emotionService.js';

/** Read-only IndexedDB access for pipeline steps. No writes. */

export function emotionStateId(chatId) {
    return `chat_${chatId}`;
}

export function sessionSummaryId(chatId) {
    return `session_${chatId}`;
}

export async function readConversation(chatId) {
    const msgs = await dbGetAll(STORES.CONVERSATION, 'chatId', chatId);
    return msgs.sort((a, b) => (a.seqId ?? a.timestamp) - (b.seqId ?? b.timestamp));
}

export async function readMemories(chatId) {
    const all = await dbGetAll(STORES.MEMORIES, 'chatId', chatId);
    const now = Date.now();
    return all.filter(m => !m.expires_at || m.expires_at > now);
}

export async function readEmbeddings(chatId) {
    return dbGetAll(STORES.EMBEDDINGS, 'chatId', chatId);
}

export async function readEmbeddingById(embeddingId) {
    return dbGet(STORES.EMBEDDINGS, embeddingId);
}

export async function readSummary(chatId) {
    return dbGet(STORES.SUMMARIES, sessionSummaryId(chatId));
}

export async function readGoals(chatId) {
    return dbGetAll(STORES.GOALS, 'chatId', chatId);
}

export async function readActiveGoals(chatId) {
    const all = await readGoals(chatId);
    return all.filter(g => g.status === 'active');
}

export async function readEmotions(chatId) {
    const state = await dbGet(STORES.EMOTIONS, emotionStateId(chatId));
    return state ?? defaultEmotionState(chatId);
}

export async function readRelationship(chatId) {
    return dbGet(STORES.RELATIONSHIPS, chatId) ?? defaultRelationship(chatId);
}

export function defaultRelationship(chatId) {
    return {
        chatId,
        trust:       0.4,
        respect:     0.35,
        friendship:  0.3,
        affection:   0.25,
        dependency:  0.1,
        jealousy:    0.05,
        romance:     0.1,
        hostility:   0.05,
        familiarity: 0.3,
        rapport:     0.35,
        last_updated: Date.now(),
    };
}

export async function readWorldState(chatId) {
    return dbGet(STORES.WORLD, chatId) ?? defaultWorldState(chatId);
}

export function defaultWorldState(chatId) {
    return {
        chatId,
        location: 'here',
        time: new Date().toLocaleTimeString(),
        active_scene: 'conversation',
        entities: [],
        inventory: [],
        narrative_flags: [],
        is_simulation: false,
    };
}

export async function readInitiativeMeta(chatId) {
    return dbGet(STORES.INITIATIVE_META, chatId) ?? {
        chatId,
        last_initiative_at: 0,
        last_user_message_at: Date.now(),
        cycle_count: 0,
    };
}

/** Load full context bundle for RAG (step 3). */
export async function readContextBundle(chatId) {
    const [memories, embeddings, summary, world, goals, emotions, relationship] = await Promise.all([
        readMemories(chatId),
        readEmbeddings(chatId),
        readSummary(chatId),
        readWorldState(chatId),
        readActiveGoals(chatId),
        readEmotions(chatId),
        readRelationship(chatId),
    ]);
    return { memories, embeddings, summary, world, goals, emotions, relationship };
}
