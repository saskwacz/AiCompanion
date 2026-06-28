import {
    getMemoriesForChat, getEmbeddingById, putMemory, putEmbedding, deleteMemory, deleteEmbedding,
} from './dbService.js';
import { generateEmbedding, chunkedSimilaritySearch, rankByHybridScore } from './embeddingService.js';
import { RAG_TOP_K_MIN, RAG_TOP_K_MAX } from './types.js';

/**
 * Structured memory CRUD + RAG retrieval.
 * Does NOT call LLM — memory extraction is handled by legacy memory.js bridge.
 */

export function createMemoryRecord(chatId, partial = {}) {
    const now = Date.now();
    return {
        memory_id: partial.memory_id ?? crypto.randomUUID(),
        chatId,
        type: partial.type ?? 'fact',
        content: partial.content ?? '',
        importance: clamp01(partial.importance ?? 0.5),
        confidence: clamp01(partial.confidence ?? 0.8),
        entities: partial.entities ?? [],
        tags: partial.tags ?? [],
        embedding_id: partial.embedding_id ?? null,
        created_at: partial.created_at ?? now,
        last_accessed: partial.last_accessed ?? now,
        validity: partial.validity ?? 'long_term',
        expires_at: partial.expires_at ?? null,
    };
}

function clamp01(n) {
    return Math.max(0, Math.min(1, Number(n) || 0));
}

function norm(s) {
    return (s || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

export async function listMemories(chatId, { includeExpired = false } = {}) {
    const all = await getMemoriesForChat(chatId);
    const now = Date.now();
    if (includeExpired) return all;
    return all.filter(m => !m.expires_at || m.expires_at > now);
}

export async function saveMemoryWithEmbedding(chatId, partial, embedCfg) {
    const memory = createMemoryRecord(chatId, partial);
    let embeddingRecord = null;

    if (embedCfg && memory.content) {
        const { vector, model } = await generateEmbedding(memory.content, embedCfg);
        const embedding_id = crypto.randomUUID();
        embeddingRecord = {
            embedding_id,
            memory_id: memory.memory_id,
            chatId,
            vector,
            model,
            created_at: Date.now(),
        };
        memory.embedding_id = embedding_id;
    }

    await putMemory(memory);
    if (embeddingRecord) await putEmbedding(embeddingRecord);
    return { memory, embedding: embeddingRecord };
}

export async function removeMemory(memoryId) {
    const mem = await import('./dbService.js').then(m => m.getMemoryById(memoryId));
    if (mem?.embedding_id) await deleteEmbedding(mem.embedding_id);
    await deleteMemory(memoryId);
}

/**
 * RAG retrieval pipeline (steps 2–4 of system pipeline).
 * @param {number} chatId
 * @param {string} query
 * @param {Record<string, unknown>|null} embedCfg
 * @param {{ topK?: number }} opts
 */
export async function retrieveMemories(chatId, query, embedCfg, opts = {}) {
    const topK = Math.max(RAG_TOP_K_MIN, Math.min(RAG_TOP_K_MAX, opts.topK ?? 5));
    const memories = await listMemories(chatId);
    if (!memories.length) return [];

    let queryVector = null;
    if (embedCfg && query) {
        try {
            const { vector } = await generateEmbedding(query, embedCfg);
            queryVector = vector;
        } catch (e) {
            console.warn('[CompanionMemory] Embedding query failed, falling back to keyword:', e.message);
        }
    }

    const pairs = [];
    for (const memory of memories) {
        if (!memory.embedding_id) continue;
        const emb = await getEmbeddingById(memory.embedding_id);
        if (emb?.vector?.length) pairs.push({ memory, vector: emb.vector });
    }

    let ranked;
    if (queryVector && pairs.length) {
        const withSim = await chunkedSimilaritySearch(queryVector, pairs);
        ranked = rankByHybridScore(withSim, { topK });
    } else {
        // Keyword fallback when no embeddings
        const q = norm(query);
        const keywords = q.split(/\s+/).filter(w => w.length > 2);
        ranked = memories
            .map(memory => {
                const text = norm(memory.content);
                const hits = keywords.filter(k => text.includes(k)).length;
                const similarity = keywords.length ? hits / keywords.length : 0;
                return { memory, similarity, score: similarity * 0.6 + (memory.importance ?? 0.5) * 0.4 };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, topK);
    }

    const now = Date.now();
    for (const { memory } of ranked) {
        memory.last_accessed = now;
        await putMemory({ ...memory, last_accessed: now });
    }

    return ranked.map(r => r.memory);
}

/** Map legacy memory sections into structured MemoryRecords. */
export function legacyMemoryToRecords(chatId, legacyMem) {
    const map = [
        { key: 'profile', type: 'fact', validity: 'long_term' },
        { key: 'goals', type: 'preference', validity: 'long_term' },
        { key: 'memories', type: 'event', validity: 'long_term' },
        { key: 'charProfile', type: 'fact', validity: 'permanent' },
        { key: 'charGoals', type: 'preference', validity: 'permanent' },
        { key: 'charMemories', type: 'event', validity: 'long_term' },
    ];
    const records = [];
    for (const { key, type, validity } of map) {
        for (const item of legacyMem[key] || []) {
            const text = typeof item === 'string' ? item : item?.text;
            if (!text) continue;
            records.push(createMemoryRecord(chatId, {
                type,
                content: text,
                importance: key.startsWith('char') ? 0.6 : 0.7,
                confidence: 0.85,
                tags: [key],
                validity,
                created_at: item.firstSeen ?? Date.now(),
            }));
        }
    }
    return records;
}

/** Extract new memory candidates from user/assistant exchange (deterministic heuristics). */
export function extractMemoriesFromExchange(chatId, userInput, assistantResponse, emotionState) {
    const records = [];
    const now = Date.now();
    const affectionBoost = (emotionState?.affection ?? 0.5) * 0.1;

    if (userInput.length > 20) {
        records.push(createMemoryRecord(chatId, {
            type: 'event',
            content: `User said: ${userInput.slice(0, 500)}`,
            importance: clamp01(0.4 + affectionBoost),
            confidence: 0.7,
            tags: ['exchange', 'user'],
            validity: 'long_term',
            created_at: now,
        }));
    }

    const nameMatch = userInput.match(/\b(?:my name is|i'm|i am)\s+([A-Za-z]{2,30})/i);
    if (nameMatch) {
        records.push(createMemoryRecord(chatId, {
            type: 'fact',
            content: `User's name is ${nameMatch[1]}`,
            importance: 0.95,
            confidence: 0.9,
            entities: [nameMatch[1]],
            tags: ['profile', 'name'],
            validity: 'permanent',
        }));
    }

    if (assistantResponse.length > 30) {
        records.push(createMemoryRecord(chatId, {
            type: 'event',
            content: `I responded: ${assistantResponse.slice(0, 400)}`,
            importance: 0.35,
            confidence: 0.75,
            tags: ['exchange', 'character'],
            validity: 'temporary',
            expires_at: now + 30 * 24 * 60 * 60 * 1000,
        }));
    }

    return records;
}

export function adjustImportanceByEmotion(memory, emotionState) {
    if (!emotionState) return memory;
    let boost = 0;
    if (memory.tags?.includes('user')) boost += (emotionState.trust_user ?? 0.5) * 0.05;
    if (memory.type === 'relationship') boost += (emotionState.affection ?? 0.5) * 0.08;
    if (memory.type === 'event' && (emotionState.stress ?? 0) > 0.6) boost += 0.05;
    return { ...memory, importance: clamp01((memory.importance ?? 0.5) + boost) };
}
