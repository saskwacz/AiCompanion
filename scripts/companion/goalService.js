import { getGoalsForChat, putGoal } from './dbService.js';

/**
 * Persistent goal management with deterministic conflict resolution.
 */

function clamp01(n) {
    return Math.max(0, Math.min(1, Number(n) || 0));
}

function norm(s) {
    return (s || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

export function createGoal(chatId, partial = {}) {
    const now = Date.now();
    return {
        goal_id: partial.goal_id ?? crypto.randomUUID(),
        chatId,
        text: partial.text ?? '',
        priority: Math.max(1, Math.min(10, partial.priority ?? 5)),
        status: partial.status ?? 'active',
        progress: clamp01(partial.progress ?? 0),
        created_at: partial.created_at ?? now,
        updated_at: partial.updated_at ?? now,
    };
}

export async function loadGoals(chatId, { status = null } = {}) {
    const all = await getGoalsForChat(chatId);
    if (!status) return all;
    return all.filter(g => g.status === status);
}

export async function loadActiveGoals(chatId) {
    return loadGoals(chatId, { status: 'active' });
}

/** Detect opposing goal pairs by keyword heuristics. */
export function detectGoalConflicts(goals) {
    const active = goals.filter(g => g.status === 'active');
    const conflicts = [];
    for (let i = 0; i < active.length; i++) {
        for (let j = i + 1; j < active.length; j++) {
            const a = norm(active[i].text);
            const b = norm(active[j].text);
            if (isOpposing(a, b)) {
                conflicts.push({ a: active[i], b: active[j] });
            }
        }
    }
    return conflicts;
}

function isOpposing(a, b) {
    const pairs = [
        ['open up', 'keep distance'],
        ['trust', 'suspicious'],
        ['leave', 'stay'],
        ['hide', 'reveal'],
        ['odwróć', 'zostań'],
        ['ufaj', 'nie ufaj'],
    ];
    return pairs.some(([x, y]) =>
        (a.includes(x) && b.includes(y)) || (a.includes(y) && b.includes(x))
    );
}

/**
 * Resolve conflicts: higher priority wins; tie → older goal kept, newer marked failed.
 * @returns {{ resolved: import('./types.js').GoalRecord[], failed: import('./types.js').GoalRecord[] }}
 */
export function resolveGoalConflicts(goals) {
    const conflicts = detectGoalConflicts(goals);
    const failed = [];
    const active = goals.filter(g => g.status === 'active');

    for (const { a, b } of conflicts) {
        const keep = a.priority > b.priority ? a
            : b.priority > a.priority ? b
            : a.created_at <= b.created_at ? a : b;
        const drop = keep.goal_id === a.goal_id ? b : a;
        drop.status = 'failed';
        drop.updated_at = Date.now();
        failed.push(drop);
    }

    return { resolved: active.filter(g => !failed.some(f => f.goal_id === g.goal_id)), failed };
}

export function evaluateGoalProgress(goals, userInput, assistantResponse) {
    const text = norm(`${userInput} ${assistantResponse}`);
    return goals.map(goal => {
        if (goal.status !== 'active') return goal;
        const gNorm = norm(goal.text);
        const keywords = gNorm.split(/\s+/).filter(w => w.length > 4);
        const hits = keywords.filter(k => text.includes(k)).length;
        if (hits === 0) return goal;
        const delta = Math.min(0.15, hits * 0.05);
        const progress = clamp01(goal.progress + delta);
        const status = progress >= 1 ? 'completed' : 'active';
        return { ...goal, progress, status, updated_at: Date.now() };
    });
}

export function detectStagnantGoals(goals, staleMs = 3 * 24 * 60 * 60 * 1000) {
    const now = Date.now();
    return goals.filter(g =>
        g.status === 'active' &&
        g.progress < 0.2 &&
        now - g.updated_at > staleMs
    );
}

/** Sync character goals from legacy memory charGoals section. */
export function goalsFromLegacy(chatId, legacyGoals = []) {
    return legacyGoals.map((item, idx) => {
        const text = typeof item === 'string' ? item : item?.text;
        return createGoal(chatId, {
            text,
            priority: Math.max(1, 10 - idx),
            progress: 0,
        });
    }).filter(g => g.text);
}

export async function persistGoals(goals) {
    for (const g of goals) await putGoal(g);
    return goals;
}

/** Prioritize goals using emotion: high affection boosts relationship goals. */
export function prioritizeGoals(goals, emotionState) {
    return [...goals].sort((a, b) => {
        let scoreA = a.priority;
        let scoreB = b.priority;
        if (/trust|connect|relationship|blisko/i.test(a.text)) scoreA += (emotionState?.affection ?? 0) * 3;
        if (/trust|connect|relationship|blisko/i.test(b.text)) scoreB += (emotionState?.affection ?? 0) * 3;
        if (/learn|discover|curious/i.test(a.text)) scoreA += (emotionState?.curiosity ?? 0) * 2;
        if (/learn|discover|curious/i.test(b.text)) scoreB += (emotionState?.curiosity ?? 0) * 2;
        return scoreB - scoreA;
    });
}
