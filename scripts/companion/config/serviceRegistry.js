/**
 * Central registry of Companion AI services.
 * Add new services here — pipeline and UI iterate this list.
 */

export const SERVICE_IDS = [
    'chat',
    'summary',
    'memory',
    'goals',
    'emotion',
    'relationship',
    'initiative',
    'consistency',
    'embed',
];

/** @typedef {import('./serviceRegistry.js').CompanionServiceMeta} CompanionServiceMeta */

export const SERVICE_REGISTRY = {
    chat: {
        id: 'chat',
        label: 'Chat',
        description: 'Generates in-character dialogue. Receives assembled context; does not extract memory.',
        usesLLM: true,
        configKey: 'chat',
        promptKey: 'chat',
        modelList: 'MISTRAL_CHAT_LIST',
    },
    summary: {
        id: 'summary',
        label: 'Summary',
        description: 'Compresses recent conversation into a rolling summary for context.',
        usesLLM: true,
        configKey: 'summary',
        promptKey: 'summary',
        modelList: 'MISTRAL_SUMMARY_LIST',
    },
    memory: {
        id: 'memory',
        label: 'Memory',
        description: 'Extracts structured memory deltas (add/update/remove). Does not write to DB.',
        usesLLM: true,
        configKey: 'memory',
        promptKey: 'memory',
        modelList: 'MISTRAL_MEMORY_LIST',
    },
    goals: {
        id: 'goals',
        label: 'Goals',
        description: 'Updates companion goal progress and status from conversation.',
        usesLLM: true,
        configKey: 'goals',
        promptKey: 'goals',
        modelList: 'MISTRAL_MEMORY_LIST',
    },
    emotion: {
        id: 'emotion',
        label: 'Emotion',
        description: 'Returns numeric emotion deltas applied after mandatory decay.',
        usesLLM: true,
        configKey: 'emotion',
        promptKey: 'emotion',
        modelList: 'MISTRAL_MEMORY_LIST',
    },
    relationship: {
        id: 'relationship',
        label: 'Relationship',
        description: 'Updates relationship metrics. Uses LLM when enabled, else deterministic rules.',
        usesLLM: true,
        configKey: 'relationship',
        promptKey: 'relationship',
        modelList: 'MISTRAL_MEMORY_LIST',
        deterministicFallback: true,
    },
    initiative: {
        id: 'initiative',
        label: 'Initiative',
        description: 'Evaluates proactive triggers from IndexedDB state. Deterministic (no LLM).',
        usesLLM: false,
        configKey: 'initiative',
        promptKey: 'initiative',
        modelList: null,
    },
    consistency: {
        id: 'consistency',
        label: 'Consistency Check',
        description: 'Validates pending updates before commit. Pure rules (no LLM).',
        usesLLM: false,
        configKey: 'consistency',
        promptKey: 'consistency',
        modelList: null,
    },
    embed: {
        id: 'embed',
        label: 'Embeddings',
        description: 'Generates vector embeddings for RAG retrieval.',
        usesLLM: false,
        configKey: 'embed',
        promptKey: null,
        modelList: 'MISTRAL_EMBED_LIST',
        isEmbedding: true,
    },
};

export function getServiceMeta(serviceId) {
    return SERVICE_REGISTRY[serviceId] ?? null;
}

export function listLLMServices() {
    return SERVICE_IDS.filter(id => SERVICE_REGISTRY[id]?.usesLLM);
}

export function listConfigurableServices() {
    return SERVICE_IDS.map(id => SERVICE_REGISTRY[id]);
}
