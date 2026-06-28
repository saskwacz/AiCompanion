/** @typedef {'fact'|'event'|'preference'|'relationship'|'rule'} MemoryType */
/** @typedef {'permanent'|'long_term'|'temporary'} MemoryValidity */
/** @typedef {'active'|'completed'|'failed'} GoalStatus */
/** @typedef {'reminder'|'question'|'emotional'|'action'|'narrative'} InitiativeType */

export const MEMORY_TYPES = /** @type {const} */ (['fact', 'event', 'preference', 'relationship', 'rule']);
export const MEMORY_VALIDITIES = /** @type {const} */ (['permanent', 'long_term', 'temporary']);
export const GOAL_STATUSES = /** @type {const} */ (['active', 'completed', 'failed']);

/** Logical store names mapped to IndexedDB object stores. */
export const STORES = {
    CONVERSATION: 'messages',
    MEMORIES: 'companion_memories',
    EMBEDDINGS: 'companion_embeddings',
    SUMMARIES: 'companion_summaries',
    GOALS: 'companion_goals',
    EMOTIONS: 'companion_emotions',
    RELATIONSHIPS: 'companion_relationships',
    WORLD: 'companion_world_state',
    CHARACTER_PROFILE: 'characters',
    SETTINGS: 'settings',
    INITIATIVE_QUEUE: 'companion_initiative_queue',
    INITIATIVE_META: 'companion_initiative_meta',
};

export const RAG_WEIGHTS = { similarity: 0.6, importance: 0.3, recency: 0.1 };
export const RAG_TOP_K_MIN = 3;
export const RAG_TOP_K_MAX = 7;
export const EMBEDDING_CHUNK_SIZE = 512;
export const RECENCY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

export const EMOTION_DECAY = {
    anger: 0.90,
    fear: 0.95,
    stress: 0.93,
    curiosity: 0.98,
    affection: 0.999,
};

export const EMOTION_BOUNDS = { min: 0, max: 1 };

export const IDLE_INTERVAL_MS = 5 * 60 * 1000;
