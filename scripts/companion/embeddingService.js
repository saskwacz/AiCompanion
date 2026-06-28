import { embedText as providerEmbedText } from '../providers/index.js';
import { EMBEDDING_CHUNK_SIZE } from './types.js';

/**
 * Local vector operations + embedding generation via provider API.
 * Vectors are stored separately in IndexedDB (embeddingService does not write).
 */

export function cosineSimilarity(a, b) {
    if (!a?.length || !b?.length || a.length !== b.length) return 0;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 0 : dot / denom;
}

/** @param {number} createdAt */
export function recencyScore(createdAt, now = Date.now(), halfLifeMs = 7 * 24 * 60 * 60 * 1000) {
    const age = Math.max(0, now - createdAt);
    return Math.exp(-age / halfLifeMs);
}

/**
 * Rank memories by hybrid score.
 * @param {Array<{ memory: import('./types.js').MemoryRecord, vector: number[], similarity: number }>} candidates
 * @param {{ topK?: number, now?: number }} opts
 */
export function rankByHybridScore(candidates, opts = {}) {
    const { topK = 5, now = Date.now() } = opts;
    const scored = candidates.map(({ memory, similarity }) => {
        const recency = recencyScore(memory.last_accessed || memory.created_at, now);
        const score =
            similarity * 0.6 +
            (memory.importance ?? 0.5) * 0.3 +
            recency * 0.1;
        return { memory, similarity, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
}

/**
 * Chunked cosine search for large embedding sets.
 * Processes embeddings in fixed-size chunks to avoid blocking the main thread too long.
 * @param {number[]} queryVector
 * @param {Array<{ memory: import('./types.js').MemoryRecord, vector: number[] }>} items
 * @param {{ chunkSize?: number, onChunk?: (done: number, total: number) => void }} opts
 */
export async function chunkedSimilaritySearch(queryVector, items, opts = {}) {
    const { chunkSize = EMBEDDING_CHUNK_SIZE, onChunk } = opts;
    const results = [];
    for (let i = 0; i < items.length; i += chunkSize) {
        const chunk = items.slice(i, i + chunkSize);
        for (const item of chunk) {
            const similarity = cosineSimilarity(queryVector, item.vector);
            results.push({ ...item, similarity });
        }
        if (onChunk) onChunk(Math.min(i + chunkSize, items.length), items.length);
        if (i + chunkSize < items.length) {
            await new Promise(r => setTimeout(r, 0));
        }
    }
    return results;
}

/**
 * Generate embedding vector for text via configured provider.
 * @param {string} text
 * @param {Record<string, unknown>} embedCfg
 */
export async function generateQueryEmbedding(text, embedCfg) {
    const { vector } = await generateEmbedding(text, embedCfg);
    return vector;
}

export async function generateEmbedding(text, embedCfg) {
    const vector = await providerEmbedText(embedCfg, { text });
    const model = /** @type {string} */ (embedCfg.model || embedCfg.provider || 'unknown');
    return { vector, model };
}
