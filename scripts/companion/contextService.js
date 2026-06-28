import { readContextBundle, readEmbeddingById } from './readService.js';
import { generateQueryEmbedding, chunkedSimilaritySearch, rankByHybridScore } from './embeddingService.js';
import { RAG_TOP_K_MIN, RAG_TOP_K_MAX } from './types.js';

/**
 * STEP 3 — Retrieve Context (RAG)
 * Read-only. No IndexedDB writes.
 */

function norm(s) {
    return (s || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * @param {number} chatId
 * @param {string} query
 * @param {Record<string, unknown>|null} embedCfg
 */
export async function retrieveContext(chatId, query, embedCfg) {
    const bundle = await readContextBundle(chatId);
    const topK = Math.max(RAG_TOP_K_MIN, Math.min(RAG_TOP_K_MAX, 5));

    let retrievedMemories = [];

    if (bundle.memories.length && query) {
        let queryVector = null;
        if (embedCfg) {
            try {
                queryVector = await generateQueryEmbedding(query, embedCfg);
            } catch (e) {
                console.warn('[Step3] Query embedding failed, keyword fallback:', e.message);
            }
        }

        if (queryVector) {
            const pairs = [];
            for (const memory of bundle.memories) {
                if (!memory.embedding_id) continue;
                const emb = await readEmbeddingById(memory.embedding_id);
                if (emb?.vector?.length) pairs.push({ memory, vector: emb.vector });
            }
            if (pairs.length) {
                const withSim = await chunkedSimilaritySearch(queryVector, pairs);
                retrievedMemories = rankByHybridScore(withSim, { topK }).map(r => r.memory);
            }
        }

        if (!retrievedMemories.length) {
            const keywords = norm(query).split(/\s+/).filter(w => w.length > 2);
            retrievedMemories = bundle.memories
                .map(memory => {
                    const text = norm(memory.content);
                    const hits = keywords.filter(k => text.includes(k)).length;
                    const similarity = keywords.length ? hits / keywords.length : 0;
                    const score = similarity * 0.6 + (memory.importance ?? 0.5) * 0.3;
                    return { memory, score };
                })
                .sort((a, b) => b.score - a.score)
                .slice(0, topK)
                .map(r => r.memory);
        }
    }

    return {
        retrievedMemories,
        summary: bundle.summary,
        world: bundle.world,
        goals: bundle.goals,
        emotions: bundle.emotions,
        relationship: bundle.relationship,
    };
}
