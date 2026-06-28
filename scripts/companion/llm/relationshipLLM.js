import { callMemoryAPI } from '../../providers/index.js';
import { retryOnce } from '../retryOnce.js';
import { buildPrompt } from '../prompts/promptConfigService.js';
import { extractJson } from '../prompts/renderer.js';
import { computeRelationshipUpdate, applyRelationshipDelta } from '../relationshipService.js';

/** STEP 11 — Relationship LLM with deterministic fallback. */

function formatRelationship(rel) {
    if (!rel) return '(none)';
    return Object.entries(rel)
        .filter(([k]) => typeof rel[k] === 'number')
        .map(([k, v]) => `${k}=${Number(v).toFixed(2)}`)
        .join(', ');
}

export async function runRelationshipUpdate(relCfg, relTask, ctx) {
    const taskCfg = relTask || {};
    const useLLM  = taskCfg.useLLM === true;

    if (!useLLM || relCfg.provider === 'deterministic') {
        return computeRelationshipUpdate(ctx.relationship, ctx.summary, ctx.emotions);
    }

    const lang = relCfg.lang || 'pl';
    const chatConfig = relCfg.chatConfig || {};
    const e = ctx.emotions || {};

    const prompt = buildPrompt(chatConfig, 'relationship', {
        characterName: ctx.character?.name || 'Companion',
        summary:       (ctx.summary || '').slice(0, 500),
        mood:          e.mood || 'neutral',
        trust:         (e.trust_user ?? 0.5).toFixed(2),
        affection:     (e.affection ?? 0.5).toFixed(2),
        relationship:  formatRelationship(ctx.relationship),
    }, lang);

    const result = await retryOnce(
        () => callMemoryAPI(relCfg, {
            prompt,
            maxOutputTokens: relTask.maxTokens ?? 512,
            priority: 'normal',
        }),
        { label: 'Relationship LLM', fallback: null },
    );

    if (!result.ok) {
        return computeRelationshipUpdate(ctx.relationship, ctx.summary, ctx.emotions);
    }

    const deltas = extractJson(result.value) || {};
    return applyRelationshipDelta(ctx.relationship, deltas);
}
