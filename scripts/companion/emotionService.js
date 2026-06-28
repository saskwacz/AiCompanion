import { getEmotionState, putEmotionState, emotionStateId } from './dbService.js';
import { EMOTION_DECAY, EMOTION_BOUNDS } from './types.js';

/**
 * Client-side emotion state machine with exponential decay.
 */

function clamp01(n) {
    return Math.max(EMOTION_BOUNDS.min, Math.min(EMOTION_BOUNDS.max, Number(n) || 0));
}

export function defaultEmotionState(chatId) {
    const now = Date.now();
    return {
        state_id: emotionStateId(chatId),
        chatId,
        mood: 'neutral',
        valence: 0.5,
        energy: 0.6,
        stress: 0.2,
        trust_user: 0.5,
        affection: 0.4,
        fear: 0.1,
        anger: 0.05,
        curiosity: 0.5,
        loneliness: 0.2,
        confidence: 0.6,
        last_updated: now,
    };
}

export async function loadEmotionState(chatId) {
    const existing = await getEmotionState(chatId);
    return existing ?? defaultEmotionState(chatId);
}

/**
 * Apply exponential decay based on elapsed time since last update.
 * Decay is applied per interaction cycle (not continuous wall-clock simulation).
 */
export function applyDecay(state) {
    const next = { ...state };
    for (const [key, rate] of Object.entries(EMOTION_DECAY)) {
        if (next[key] !== undefined) next[key] = clamp01(next[key] * rate);
    }
    // Slow decay for dimensions without explicit rates
    next.valence = clamp01(next.valence * 0.995 + 0.5 * 0.005);
    next.energy = clamp01(next.energy * 0.97);
    next.loneliness = clamp01(next.loneliness * 0.96);
    next.confidence = clamp01(next.confidence * 0.99);
    next.trust_user = clamp01(next.trust_user * EMOTION_DECAY.affection);
    return next;
}

const POSITIVE = /\b(thank|love|great|awesome|happy|glad|nice|wonderful|dziękuj|kocham|super|świetnie)\b/i;
const NEGATIVE = /\b(hate|angry|stupid|worst|leave|shut up|idiot|nienawid|wkurz|głupi)\b/i;
const CURIOUS = /\b(why|how|what if|explain|tell me|dlaczego|jak|co jeśli)\b/i;
const FEAR = /\b(scared|afraid|worried|anxious|boję|przestrasz|lęk)\b/i;

/**
 * Deterministic emotion deltas from user input text.
 * @param {import('./types.js').EmotionState} state
 * @param {string} userInput
 * @param {string} [assistantResponse]
 */
export function updateFromInteraction(state, userInput, assistantResponse = '') {
    let next = applyDecay({ ...state });
    const text = `${userInput} ${assistantResponse}`;

    if (POSITIVE.test(userInput)) {
        next.valence = clamp01(next.valence + 0.08);
        next.affection = clamp01(next.affection + 0.05);
        next.trust_user = clamp01(next.trust_user + 0.04);
        next.stress = clamp01(next.stress - 0.05);
        next.anger = clamp01(next.anger - 0.06);
    }
    if (NEGATIVE.test(userInput)) {
        next.valence = clamp01(next.valence - 0.1);
        next.anger = clamp01(next.anger + 0.12);
        next.stress = clamp01(next.stress + 0.08);
        next.trust_user = clamp01(next.trust_user - 0.06);
        next.affection = clamp01(next.affection - 0.03);
    }
    if (CURIOUS.test(userInput)) {
        next.curiosity = clamp01(next.curiosity + 0.1);
        next.energy = clamp01(next.energy + 0.03);
    }
    if (FEAR.test(userInput)) {
        next.fear = clamp01(next.fear + 0.1);
        next.stress = clamp01(next.stress + 0.05);
    }

    if (userInput.length > 5) next.loneliness = clamp01(next.loneliness - 0.08);

    next.mood = deriveMood(next);
    next.last_updated = Date.now();
    return next;
}

export function deriveMood(state) {
    if (state.anger > 0.65) return 'irritated';
    if (state.fear > 0.6) return 'anxious';
    if (state.stress > 0.7) return 'stressed';
    if (state.affection > 0.7 && state.valence > 0.6) return 'warm';
    if (state.curiosity > 0.7) return 'curious';
    if (state.loneliness > 0.6) return 'lonely';
    if (state.valence > 0.65) return 'positive';
    if (state.valence < 0.35) return 'low';
    return 'neutral';
}

/** Tone hints injected into LLM system prompt. */
export function emotionToPromptHints(state) {
    return {
        mood: state.mood,
        tone: [
            state.affection > 0.6 ? 'warm and caring' : null,
            state.anger > 0.5 ? 'slightly tense, stay composed' : null,
            state.curiosity > 0.6 ? 'inquisitive' : null,
            state.loneliness > 0.55 ? 'seek connection without being needy' : null,
            state.confidence < 0.35 ? 'slightly uncertain' : null,
        ].filter(Boolean).join('; ') || 'balanced',
        valence: state.valence,
        energy: state.energy,
    };
}

export async function persistEmotionState(state) {
    await putEmotionState(state);
    return state;
}
