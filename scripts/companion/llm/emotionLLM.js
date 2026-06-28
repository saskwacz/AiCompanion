import { callMemoryAPI } from '../../providers/index.js';
import { retryOnce } from '../retryOnce.js';
import { applyDecay, deriveMood } from '../emotionService.js';
import { EMOTION_BOUNDS } from '../types.js';
import { buildPrompt } from '../prompts/promptConfigService.js';
import { extractJson } from '../prompts/renderer.js';

/** STEP 10 — Emotion LLM + decay. Returns new emotion state. No writes. */

function clamp01(n) {
    return Math.max(EMOTION_BOUNDS.min, Math.min(EMOTION_BOUNDS.max, Number(n) || 0));
}

const DELTA_KEYS = ['valence', 'energy', 'stress', 'trust_user', 'affection', 'fear', 'anger', 'curiosity', 'loneliness', 'confidence'];

export async function runEmotionLLM(emotionCfg, emotionTask, ctx) {
    const lang = emotionCfg.lang || 'pl';
    const chatConfig = emotionCfg.chatConfig || {};
    const e = ctx.emotions || {};

    const prompt = buildPrompt(chatConfig, 'emotion', {
        summary:     (ctx.summary || '').slice(0, 500),
        valence:     (e.valence ?? 0.5).toFixed(2),
        anger:       (e.anger ?? 0).toFixed(2),
        fear:        (e.fear ?? 0).toFixed(2),
        stress:      (e.stress ?? 0).toFixed(2),
        curiosity:   (e.curiosity ?? 0.5).toFixed(2),
        affection:   (e.affection ?? 0.5).toFixed(2),
        trust:       (e.trust_user ?? 0.5).toFixed(2),
        energy:      (e.energy ?? 0.5).toFixed(2),
        loneliness:  (e.loneliness ?? 0.2).toFixed(2),
        confidence:  (e.confidence ?? 0.5).toFixed(2),
    }, lang);

    const result = await retryOnce(
        () => callMemoryAPI(emotionCfg, {
            prompt,
            maxOutputTokens: emotionTask.maxTokens ?? 512,
            priority: 'normal',
        }),
        { label: 'Emotion LLM', fallback: null },
    );

    const deltas = result.ok ? (extractJson(result.value) || {}) : {};
    return applyEmotionDelta(ctx.emotions, deltas);
}

export function applyEmotionDelta(current, deltas) {
    let next = applyDecay({ ...current });

    for (const key of DELTA_KEYS) {
        if (deltas[key] !== undefined) {
            next[key] = clamp01(next[key] + Number(deltas[key]));
        }
    }

    next.mood = deriveMood(next);
    next.last_updated = Date.now();
    return next;
}
