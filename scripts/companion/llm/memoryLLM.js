import { callMemoryAPI } from '../../providers/index.js';
import { retryOnce } from '../retryOnce.js';
import { createMemoryRecord } from '../memoryService.js';
import { buildMemoryExtractionPrompt } from '../memoryPromptBuilder.js';
import { parseMemoryDelta } from '../memoryDeltaParser.js';

/** STEP 8 — Memory LLM. Returns { add, update, remove }. No writes. */

function formatMemories(memories) {
    return (memories || []).slice(0, 24).map(m =>
        `${m.memory_id}|${m.type}|${(m.tags || [])[0] || '?'}|${(m.content || '').slice(0, 100)}`,
    ).join('\n') || '(empty)';
}

function formatRetrieved(retrieved) {
    return (retrieved || []).slice(0, 5).map(m =>
        `- ${(m.content || '').slice(0, 80)}`,
    ).join('\n') || '(none)';
}

function resolveMemoryPrompt(memoryCfg, ctx) {
    const lang = memoryCfg.lang || 'pl';
    const custom = memoryCfg.chatConfig?.prompts?.memory;

    if (custom?.trim()) {
        return custom
            .replace(/\{\{characterName\}\}/g, ctx.character?.name || 'Companion')
            .replace(/\{\{summary\}\}/g, (ctx.summary || '').slice(0, 600))
            .replace(/\{\{retrievedMemories\}\}/g, formatRetrieved(ctx.retrieved))
            .replace(/\{\{currentMemories\}\}/g, formatMemories(ctx.memories))
            .replace(/\{\{userInput\}\}/g, (ctx.userInput || '').slice(0, 500))
            .replace(/\{\{assistantResponse\}\}/g, (ctx.assistantResponse || '').slice(0, 500));
    }

    return buildMemoryExtractionPrompt(ctx, lang);
}

export async function runMemoryLLM(memoryCfg, memoryTask, ctx) {
    const prompt = resolveMemoryPrompt(memoryCfg, ctx);

    const result = await retryOnce(
        () => callMemoryAPI(memoryCfg, {
            prompt,
            maxOutputTokens: memoryTask.maxTokens ?? 2048,
            priority: 'normal',
        }),
        { label: 'Memory LLM', fallback: null },
    );

    if (!result.ok) return { add: [], update: [], remove: [] };
    return parseMemoryDelta(result.value);
}

export function applyMemoryDelta(chatId, existing, delta) {
    const byId = new Map(existing.map(m => [m.memory_id, { ...m }]));
    const toDelete = new Set(delta.remove || []);

    for (const upd of delta.update || []) {
        if (!upd.memory_id || !byId.has(upd.memory_id)) continue;
        const cur = byId.get(upd.memory_id);
        byId.set(upd.memory_id, {
            ...cur,
            content:       upd.content      ?? cur.content,
            importance:    upd.importance   ?? cur.importance,
            confidence:    upd.confidence   ?? cur.confidence,
            type:          upd.type         ?? cur.type,
            last_accessed: Date.now(),
        });
    }

    const added = [];
    for (const item of delta.add || []) {
        if (!item.content) continue;
        const rec = createMemoryRecord(chatId, {
            type:       item.type,
            content:    item.content,
            importance: item.importance,
            confidence: item.confidence,
            tags:       item.tags,
            validity:   item.validity,
        });
        byId.set(rec.memory_id, rec);
        added.push(rec);
    }

    return {
        memoriesPut:    [...byId.values()].filter(m => !toDelete.has(m.memory_id)),
        memoriesDelete: [...toDelete],
        newMemories:    added,
    };
}
