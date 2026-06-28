import {
    readContextBundle, readConversation, readGoals,
    readInitiativeMeta, emotionStateId,
} from './readService.js';
import {
    appendUserMessage, appendAssistantMessage,
    commitStateTransaction, commitEmbeddingUpdates,
    enqueueInitiative, buildSummaryRecord,
} from './persistenceService.js';
import { generateQueryEmbedding } from './embeddingService.js';
import { retrieveContext } from './contextService.js';
import { buildChatContext } from './contextBuilder.js';
import { generateChatResponse } from './chatService.js';
import { runSummaryLLM } from './llm/summaryLLM.js';
import { runMemoryLLM, applyMemoryDelta } from './llm/memoryLLM.js';
import { runGoalLLM, applyGoalDelta } from './llm/goalLLM.js';
import { runEmotionLLM } from './llm/emotionLLM.js';
import { runRelationshipUpdate } from './llm/relationshipLLM.js';
import { computeWorldStateUpdate } from './worldStateService.js';
import { validateBeforeWrite } from './consistencyService.js';
import { evaluateInitiative } from './initiativeService.js';
import { generateEmbedding } from './embeddingService.js';

/**
 * Deterministic 17-step Companion AI pipeline.
 * Only persistenceService writes to IndexedDB (steps 1, 6, 14, 15, 16).
 */

/**
 * @typedef {Object} PipelineInput
 * @property {number} chatId
 * @property {string} userInput
 * @property {object} character
 * @property {object|null} [userMessage] — if already saved (step 1 skip)
 * @property {object} chatCfg
 * @property {object} embedCfg
 * @property {object} memoryCfg
 * @property {object} summaryCfg
 * @property {object} chatTask
 * @property {object} goalCfg
 * @property {object} emotionCfg
 * @property {object} relationshipCfg
 * @property {object} goalTask
 * @property {object} emotionTask
 * @property {object} relationshipTask
 * @property {object[]} [messages]
 */

/**
 * Execute the full deterministic pipeline for one user turn.
 * @param {PipelineInput} input
 */
export async function runPipeline(input) {
    const {
        chatId, userInput, character,
        chatCfg, embedCfg, memoryCfg, summaryCfg,
        goalCfg, emotionCfg, relationshipCfg,
        chatTask, memoryTask, summaryTask,
        goalTask, emotionTask, relationshipTask,
    } = input;

    const log = (step, detail = '') => console.log(`[Pipeline Step ${step}]${detail ? ' ' + detail : ''}`);

    // ── STEP 1: Receive user message ──────────────────────────────────────────
    log(1, 'Receive user message');
    let userMessage = input.userMessage;
    if (!userMessage) {
        userMessage = await appendUserMessage(chatId, userInput);
    }

    let messages = input.messages ?? await readConversation(chatId);
    if (!messages.find(m => m.id === userMessage.id)) {
        messages = [...messages, userMessage];
    }

    // ── STEP 2: Generate query embedding (no writes) ──────────────────────────
    log(2, 'Generate query embedding');
    let queryEmbedding = null;
    try {
        queryEmbedding = await generateQueryEmbedding(userInput, embedCfg);
    } catch (e) {
        console.warn('[Step 2] Embedding failed:', e.message);
    }

    // ── STEP 3: Retrieve context / RAG (read-only) ────────────────────────────
    log(3, 'Retrieve context (RAG)');
    const snapshot = await readContextBundle(chatId);
    const allGoals = await readGoals(chatId);
    const rag = await retrieveContext(chatId, userInput, embedCfg);

    // ── STEP 4: Build chat context (no writes) ────────────────────────────────
    log(4, 'Build chat context');
    const ctx = buildChatContext({
        character,
        emotions: snapshot.emotions,
        goals: snapshot.goals,
        summary: snapshot.summary,
        retrievedMemories: rag.retrievedMemories,
        messages,
        world: snapshot.world,
        relationship: snapshot.relationship,
        userInput,
        chatCfg,
    });

    // ── STEP 5: Generate chat response — Mistral Large (no writes) ────────────
    log(5, 'Generate chat response');
    const assistantText = await generateChatResponse(chatCfg, chatTask, {
        messages,
        systemPrompt: ctx.systemPrompt,
        summaryText: snapshot.summary?.summary || '',
    });

    // ── STEP 6: Append assistant message ──────────────────────────────────────
    log(6, 'Append assistant message');
    const assistantMessage = await appendAssistantMessage(chatId, assistantText);
    messages = [...messages, assistantMessage];

    // ── STEP 7: Summary LLM (no writes) ─────────────────────────────────────
    log(7, 'Summary LLM');
    const lang = chatCfg.lang || 'pl';
    const summaryText = await runSummaryLLM(summaryCfg, summaryTask, {
        character,
        messages,
        previousSummary: snapshot.summary?.summary || '',
        lang,
    });

    // ── STEPS 8–10: Parallel LLM updates (no writes) ──────────────────────────
    log('8-10', 'Parallel memory / goal / emotion LLM');
    const llmCtx = {
        character,
        summary: summaryText,
        emotions: snapshot.emotions,
        goals: allGoals,
        memories: snapshot.memories,
        retrieved: rag.retrievedMemories,
        userInput,
        assistantResponse: assistantText,
        lang,
    };

    const [memoryDelta, goalDelta, newEmotions] = await Promise.all([
        runMemoryLLM(memoryCfg, memoryTask, llmCtx),
        runGoalLLM(goalCfg, goalTask, llmCtx),
        runEmotionLLM(emotionCfg, emotionTask, {
            emotions: snapshot.emotions,
            summary: summaryText,
            lang,
        }),
    ]);

    const memoryResult = applyMemoryDelta(chatId, snapshot.memories, memoryDelta);
    const goalResult = applyGoalDelta(chatId, allGoals, goalDelta);

    // ── STEP 11: Relationship update (no writes) ────────────────────────────
    log(11, 'Relationship update');
    const newRelationship = await runRelationshipUpdate(relationshipCfg, relationshipTask, {
        character,
        relationship: snapshot.relationship,
        summary: summaryText,
        emotions: newEmotions,
    });

    // ── STEP 12: World state update ───────────────────────────────────────────
    log(12, 'World state update');
    const { world: newWorld } = computeWorldStateUpdate(
        snapshot.world, summaryText, character,
        { assistantResponse: assistantText },
    );

    // ── STEP 13: Consistency check ────────────────────────────────────────────
    log(13, 'Consistency check');
    const summaryRecord = buildSummaryRecord(
        chatId,
        summaryText,
        [userInput.slice(0, 80)],
    );

    const consistency = validateBeforeWrite({
        memories: memoryResult.newMemories,
        existingMemories: snapshot.memories.filter(m => !memoryResult.memoriesDelete.includes(m.memory_id)),
        emotion: newEmotions,
        previousEmotion: snapshot.emotions,
        goals: goalResult.goalsPut,
        world: newWorld,
        relationship: newRelationship,
    });

    // ── STEP 14: Atomic commit ────────────────────────────────────────────────
    log(14, 'Commit transaction');
    const finalMemories = mergeMemorySets(snapshot.memories, memoryResult, consistency);

    const emotionRecord = {
        ...(consistency.acceptedEmotion ?? newEmotions),
        state_id: emotionStateId(chatId),
        chatId,
    };

    await commitStateTransaction({
        memoriesPut: finalMemories,
        memoriesDelete: memoryResult.memoriesDelete,
        goalsPut: consistency.acceptedGoals,
        goalsDelete: goalResult.goalsDelete,
        emotion: emotionRecord,
        relationship: consistency.acceptedRelationship,
        world: consistency.acceptedWorld,
        summary: summaryRecord,
        embeddingsPut: [],
        embeddingsDelete: [],
    });

    // ── STEP 15: Generate embeddings for new memories ───────────────────────
    log(15, 'Generate embeddings');
    const toEmbed = finalMemories.filter(m => !m.embedding_id && m.content);
    const embeddingsPut = [];
    const memoriesWithEmb = [];

    for (const mem of toEmbed) {
        try {
            const { vector, model } = await generateEmbedding(mem.content, embedCfg);
            const embedding_id = crypto.randomUUID();
            embeddingsPut.push({
                embedding_id,
                memory_id: mem.memory_id,
                chatId,
                vector,
                model,
                created_at: Date.now(),
            });
            memoriesWithEmb.push({ ...mem, embedding_id });
        } catch (e) {
            console.warn('[Step 15] Embedding failed for memory:', mem.memory_id, e.message);
            memoriesWithEmb.push(mem);
        }
    }

    if (embeddingsPut.length) {
        await commitEmbeddingUpdates({
            embeddingsPut,
            memoriesPut: memoriesWithEmb,
        });
    }

    // ── STEP 16: Initiative evaluation (after all writes) ─────────────────────
    log(16, 'Initiative evaluation');
    const postSnapshot = await readContextBundle(chatId);
    const initiative = evaluateInitiative(chatId, {
        emotion: postSnapshot.emotions,
        goals: postSnapshot.goals,
        memories: postSnapshot.memories,
        meta: await readInitiativeMeta(chatId),
    });

    if (initiative) {
        await enqueueInitiative(chatId, initiative);
    }

    return {
        userMessage,
        assistantMessage,
        response: assistantText,
        queryEmbedding,
        retrievedMemories: rag.retrievedMemories,
        consistency,
        initiative,
        summary: summaryRecord,
    };
}

function mergeMemorySets(existing, memoryResult, consistency) {
    const deleted = new Set(memoryResult.memoriesDelete);
    const rejected = new Set(consistency.rejected);
    const acceptedIds = new Set(consistency.acceptedMemories.map(m => m.memory_id));
    const byId = new Map(existing.map(m => [m.memory_id, m]));

    for (const m of memoryResult.memoriesPut) {
        if (deleted.has(m.memory_id)) {
            byId.delete(m.memory_id);
            continue;
        }
        if (rejected.has(m.memory_id)) continue;

        const isNew = memoryResult.newMemories.some(n => n.memory_id === m.memory_id);
        if (isNew && !acceptedIds.has(m.memory_id)) continue;

        byId.set(m.memory_id, m);
    }

    for (const m of consistency.acceptedMemories) {
        byId.set(m.memory_id, m);
    }

    return [...byId.values()];
}

/** @deprecated Use runPipeline */
export const runCompanionExchange = runPipeline;

export async function seedCompanionState(chatId, legacyMemory, embedCfg = null, opts = {}) {
    const { character = null, initWorld = false } = opts;
    const { goalsFromLegacy } = await import('./goalService.js');
    const { legacyMemoryToRecords, listMemories, createMemoryRecord } = await import('./memoryService.js');
    const { defaultEmotionState } = await import('./emotionService.js');
    const { defaultRelationship, defaultWorldState, readContextBundle } = await import('./readService.js');
    const { worldStateFromScenario } = await import('./worldStateService.js');

    const snapshot = await readContextBundle(chatId);
    const charTags = new Set(['charProfile', 'charGoals', 'charMemories']);
    const existing = await listMemories(chatId, { includeExpired: true });
    const memoriesDelete = [];
    const embeddingsDelete = [];
    for (const m of existing) {
        if (!m.tags?.some(t => charTags.has(t))) continue;
        memoriesDelete.push(m.memory_id);
        if (m.embedding_id) embeddingsDelete.push(m.embedding_id);
    }

    const partials = legacyMemoryToRecords(chatId, legacyMemory).filter(r =>
        r.tags?.some(t => charTags.has(t)),
    );

    const memoriesPut = [];
    const embeddingsPut = [];
    for (const partial of partials) {
        const memory = createMemoryRecord(chatId, partial);
        if (hasEmbedKeys(embedCfg) && memory.content) {
            try {
                const { vector, model } = await generateEmbedding(memory.content, embedCfg);
                const embedding_id = crypto.randomUUID();
                memory.embedding_id = embedding_id;
                embeddingsPut.push({
                    embedding_id,
                    memory_id: memory.memory_id,
                    chatId,
                    vector,
                    model,
                    created_at: Date.now(),
                });
            } catch (e) {
                console.warn('[Companion] Bio memory embed failed:', e.message);
            }
        }
        memoriesPut.push(memory);
    }

    const existingGoals = await readGoals(chatId);
    const goalsPut = existingGoals.length
        ? []
        : goalsFromLegacy(chatId, legacyMemory?.charGoals || []);

    let world = snapshot.world ?? defaultWorldState(chatId);
    if (initWorld && character?.scenario?.trim()) {
        world = worldStateFromScenario(chatId, character.scenario);
    }

    await commitStateTransaction({
        goalsPut,
        memoriesPut,
        memoriesDelete,
        goalsDelete: [],
        emotion: snapshot.emotions ?? defaultEmotionState(chatId),
        relationship: snapshot.relationship ?? defaultRelationship(chatId),
        world,
        summary: snapshot.summary ?? buildSummaryRecord(chatId, '', []),
        embeddingsPut,
        embeddingsDelete,
    });
}

function hasEmbedKeys(embedCfg) {
    const keys = embedCfg?.keys;
    if (!Array.isArray(keys) || !keys.length) return false;
    return keys.some(k => (typeof k === 'string' ? k : k?.key)?.trim());
}

export async function getCompanionState(chatId) {
    return readContextBundle(chatId);
}
