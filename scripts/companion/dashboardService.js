import { readContextBundle, readEmbeddings, readGoals, readConversation } from './readService.js';
import { relationshipScore } from './relationshipService.js';
import { deriveMood } from './emotionService.js';

/**
 * Aggregates IndexedDB companion state for the Memory Dashboard.
 * Single read path — no duplicated state.
 */

const CHAR_FACT_TAGS = new Set(['charProfile', 'charGoals']);
const CHAR_MEMORY_TAGS = new Set(['charMemories']);
const USER_FACT_TAGS = new Set(['profile', 'goals', 'name']);

function hasTag(m, tags) {
    return (m.tags || []).some(t => tags.has(t));
}

/** Permanent/static character traits and motivations from bio. */
export function isCharacterFact(m) {
    return hasTag(m, CHAR_FACT_TAGS) ||
        (m.validity === 'permanent' && (m.tags || []).some(t => t.startsWith('char') && !CHAR_MEMORY_TAGS.has(t)));
}

/** Past events / backstory — character or user conversation memories. */
export function isLongTermMemory(m) {
    if (isCharacterFact(m)) return false;
    if (hasTag(m, USER_FACT_TAGS)) return false;
    if (hasTag(m, CHAR_MEMORY_TAGS)) return true;
    if ((m.tags || []).includes('memories')) return true;
    if (m.type === 'event') return true;
    if (m.validity === 'long_term' || m.validity === 'temporary') return true;
    return false;
}

export async function loadDashboard(chatId) {
    const [bundle, allGoals, embeddings, messages] = await Promise.all([
        readContextBundle(chatId),
        readGoals(chatId),
        readEmbeddings(chatId),
        readConversation(chatId),
    ]);

    const memories = bundle.memories;
    const characterFacts = memories.filter(isCharacterFact);
    const longTermMemories = memories.filter(isLongTermMemory);

    const stats = computeStats(memories, embeddings, bundle, allGoals);

    return {
        chatId,
        characterFacts,
        longTermMemories,
        memories,
        emotions: {
            ...bundle.emotions,
            mood: bundle.emotions?.mood || deriveMood(bundle.emotions),
        },
        relationship: bundle.relationship,
        relationshipScore: relationshipScore(bundle.relationship),
        goals: {
            active:    allGoals.filter(g => g.status === 'active'),
            completed: allGoals.filter(g => g.status === 'completed'),
            failed:    allGoals.filter(g => g.status === 'failed'),
            all:       allGoals,
        },
        world: bundle.world,
        summary: bundle.summary,
        stats,
        messageCount: messages.length,
    };
}

function computeStats(memories, embeddings, bundle, goals) {
    const imp = memories.map(m => m.importance ?? 0);
    const conf = memories.map(m => m.confidence ?? 0);
    const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    const emotionVals = [
        bundle.emotions?.valence, bundle.emotions?.affection,
        bundle.emotions?.trust_user, bundle.emotions?.energy,
    ].filter(v => v !== undefined);

    return {
        totalMemories:     memories.length,
        permanentCount:    memories.filter(m => m.validity === 'permanent').length,
        temporaryCount:    memories.filter(m => m.validity === 'temporary').length,
        longTermCount:     memories.filter(m => m.validity === 'long_term').length,
        avgImportance:     avg(imp),
        avgConfidence:     avg(conf),
        embeddingCount:    embeddings.length,
        lastUpdate:        Math.max(
            bundle.emotions?.last_updated || 0,
            bundle.relationship?.last_updated || 0,
            bundle.summary?.created_at || 0,
            ...memories.map(m => m.last_accessed || m.created_at || 0),
        ),
        relationshipScore: relationshipScore(bundle.relationship),
        emotionScore:      avg(emotionVals),
        activeGoals:       goals.filter(g => g.status === 'active').length,
    };
}

export function filterMemories(memories, { search = '', type = '', sort = 'importance' } = {}) {
    let list = [...memories];
    const q = search.toLowerCase().trim();
    if (q) {
        list = list.filter(m =>
            (m.content || '').toLowerCase().includes(q) ||
            (m.tags || []).some(t => t.toLowerCase().includes(q))
        );
    }
    if (type) list = list.filter(m => m.type === type);

    switch (sort) {
        case 'recency':
            list.sort((a, b) => (b.last_accessed || b.created_at) - (a.last_accessed || a.created_at));
            break;
        case 'confidence':
            list.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
            break;
        case 'created':
            list.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
            break;
        default:
            list.sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
    }
    return list;
}
