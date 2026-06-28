import { detectStagnantGoals } from './goalService.js';

/**
 * STEP 16 — Initiative evaluation (read-only computation).
 * Persistence layer enqueues result. Max 1 initiative per cycle.
 */

const MIN_INITIATIVE_INTERVAL_MS = 5 * 60 * 1000;
const LONELINESS_THRESHOLD = 0.62;
const CURIOSITY_THRESHOLD = 0.72;
const STRESS_THRESHOLD = 0.75;

/**
 * @param {number} chatId
 * @param {{
 *   emotion: object,
 *   goals: object[],
 *   memories: object[],
 *   meta: object,
 * }} ctx
 */
export function evaluateInitiative(chatId, ctx) {
    const meta = ctx.meta ?? {};
    const now = Date.now();
    const timeSinceLast = now - (meta.last_initiative_at || 0);

    const candidates = [];

    if (ctx.emotion.loneliness >= LONELINESS_THRESHOLD) {
        candidates.push({
            type: 'emotional',
            content: 'I feel a bit alone — would you like to talk?',
            priority: 6,
            trigger_reason: `loneliness=${ctx.emotion.loneliness.toFixed(2)}`,
            context_links: [],
            should_interrupt_user: false,
        });
    }

    if (ctx.emotion.curiosity >= CURIOSITY_THRESHOLD) {
        const topic = ctx.memories[0]?.content?.slice(0, 80);
        candidates.push({
            type: 'question',
            content: topic
                ? `I am still curious about something we discussed: "${topic}…"`
                : 'There is something I would like to understand better about you.',
            priority: 5,
            trigger_reason: `curiosity=${ctx.emotion.curiosity.toFixed(2)}`,
            context_links: ctx.memories.slice(0, 2).map(m => m.memory_id),
            should_interrupt_user: false,
        });
    }

    if (ctx.emotion.stress >= STRESS_THRESHOLD) {
        candidates.push({
            type: 'emotional',
            content: 'Things feel tense — I might need a moment to collect myself.',
            priority: 3,
            trigger_reason: `stress=${ctx.emotion.stress.toFixed(2)}`,
            context_links: [],
            should_interrupt_user: false,
        });
    }

    const stagnant = detectStagnantGoals(ctx.goals);
    if (stagnant.length) {
        candidates.push({
            type: 'reminder',
            content: `I still have an unfinished aim: "${stagnant[0].text.slice(0, 100)}"`,
            priority: 7,
            trigger_reason: 'goal_stagnation',
            context_links: [stagnant[0].goal_id],
            should_interrupt_user: false,
        });
    }

    if (!candidates.length) return null;
    if (timeSinceLast < MIN_INITIATIVE_INTERVAL_MS) return null;

    candidates.sort((a, b) => b.priority - a.priority);
    return candidates[0];
}
