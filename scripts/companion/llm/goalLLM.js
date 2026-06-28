import { callMemoryAPI } from '../../providers/index.js';
import { retryOnce } from '../retryOnce.js';
import { createGoal } from '../goalService.js';
import { buildPrompt } from '../prompts/promptConfigService.js';
import { extractJson } from '../prompts/renderer.js';

/** STEP 9 — Goal LLM. Returns goal updates. No writes. */

function formatGoals(goals) {
    return (goals || []).map(g =>
        `${g.goal_id} | P${g.priority} | ${Math.round((g.progress ?? 0) * 100)}% | ${g.text}`
    ).join('\n') || '(none)';
}

function parseGoalDelta(raw) {
    const parsed = extractJson(raw);
    if (!parsed) return { add: [], update: [], remove: [] };
    return {
        add:    Array.isArray(parsed.add)    ? parsed.add    : [],
        update: Array.isArray(parsed.update) ? parsed.update : [],
        remove: Array.isArray(parsed.remove) ? parsed.remove : [],
    };
}

export async function runGoalLLM(goalCfg, goalTask, ctx) {
    const lang = goalCfg.lang || 'pl';
    const chatConfig = goalCfg.chatConfig || {};
    const emotions = ctx.emotions || {};

    const prompt = buildPrompt(chatConfig, 'goals', {
        characterName: ctx.character?.name || 'Companion',
        summary:       (ctx.summary || '').slice(0, 600),
        mood:          emotions.mood || 'neutral',
        trust:         (emotions.trust_user ?? 0.5).toFixed(2),
        affection:     (emotions.affection ?? 0.5).toFixed(2),
        goals:         formatGoals(ctx.goals),
    }, lang);

    const result = await retryOnce(
        () => callMemoryAPI(goalCfg, {
            prompt,
            maxOutputTokens: goalTask.maxTokens ?? 1024,
            priority: 'normal',
        }),
        { label: 'Goal LLM', fallback: null },
    );

    return result.ok ? parseGoalDelta(result.value) : { add: [], update: [], remove: [] };
}

export function applyGoalDelta(chatId, existing, delta) {
    const byId = new Map(existing.map(g => [g.goal_id, { ...g }]));
    const toDelete = new Set(delta.remove || []);

    for (const upd of delta.update || []) {
        if (!upd.goal_id || !byId.has(upd.goal_id)) continue;
        const cur = byId.get(upd.goal_id);
        byId.set(upd.goal_id, {
            ...cur,
            progress:   upd.progress ?? cur.progress,
            status:     upd.status   ?? cur.status,
            priority:   upd.priority ?? cur.priority,
            text:       upd.text     ?? cur.text,
            updated_at: Date.now(),
        });
    }

    for (const item of delta.add || []) {
        if (!item.text) continue;
        const g = createGoal(chatId, { text: item.text, priority: item.priority });
        byId.set(g.goal_id, g);
    }

    return {
        goalsPut:    [...byId.values()].filter(g => !toDelete.has(g.goal_id)),
        goalsDelete: [...toDelete],
    };
}
