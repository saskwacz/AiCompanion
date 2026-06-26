/**
 * gemini-prompts-en.js
 *
 * Prompt builders for Gemini — English communication mode.
 * Memory and summary are extracted/written in English.
 * Chat system prompt instructs the AI to respond in English.
 */

import {
    buildMemoryUpdatePrompt as sharedMemoryUpdate,
    buildMemorySeedPrompt   as sharedMemorySeed,
} from './memory-prompt-shared.js';

// ─── CHAT — system prompt ─────────────────────────────────────────────────────

/**
 * Full character system prompt: instructions → memory.
 * Includes English language instruction.
 */
export function buildSystemPrompt(character, memCtx = '') {
    const parts = [];

    // Primary instructions (formerly dialogue examples)
    if (character.promptInstructions)
        parts.push(character.promptInstructions);

    // Injected memory context
    if (memCtx) parts.push(memCtx);

    const instruction = [];
    if (memCtx && memCtx.includes('[since:')) {
        instruction.push('[INSTRUCTION] Memory facts tagged [since: {ms since 1970-01-01}] indicate chronological order. Use this to provide responses accurate to what was known at each point in time.');
    }
    instruction.push('[LANGUAGE] Communicate exclusively in English, unless the user writes in a different language — then mirror their language.');

    parts.push(instruction.join('\n'));
    return parts.filter(Boolean).join('\n\n').trim();
}

// ─── MEMORY ───────────────────────────────────────────────────────────────────

export function buildMemoryUpdatePrompt(existing, character, recentMessages, userMsg, aiMsg) {
    return sharedMemoryUpdate('en', existing, character, recentMessages, userMsg, aiMsg);
}

export function buildMemorySeedPrompt(character) {
    return sharedMemorySeed('en', character);
}

// ─── SUMMARY ─────────────────────────────────────────────────────────────────

export function buildSummaryPrompt({ convText, charName, previousSummaryText, type = 'rolling', fromMsg, toMsg }) {
    const skipNote = 'IMPORTANT: If any part of the conversation contains content you cannot process, skip that part and summarize the rest. Do not refuse the entire response.\n\n';
    switch (type) {

        case 'rolling': {
            const prev = previousSummaryText
                ? `PREVIOUS RECAP (for context):\n${previousSummaryText}\n\n---\n\n`
                : '';
            return `${skipNote}${prev}Write a CONCISE recap of the conversation excerpt below (last ~50 messages).
Goal: quick orientation on what's happened recently — 3–6 sentences.
Write in English. Don't omit important facts, decisions, or emotional moments.

CONVERSATION:
${convText}`;
        }

        case 'chunk': {
            const loc = (fromMsg != null && toMsg != null) ? ` (messages ${fromMsg}–${toMsg})` : '';
            return `${skipNote}Write a DETAILED summary of the conversation window below${loc}.
This summary will be stored as a historical record. Include EVERYTHING significant:
- Topics, decisions, facts about the user and character
- Key moments, emotions, relationship dynamics
- Promises, inside jokes, recurring themes
Write in English. Be specific.

CONVERSATION:
${convText}`;
        }

        case 'medium': {
            const loc = (fromMsg != null && toMsg != null) ? ` (msgs ${fromMsg}–${toMsg})` : '';
            return `${skipNote}Below are detailed summaries of successive conversation windows${loc}.
Write a HIGHER-LEVEL OVERVIEW that synthesises this whole period (~1000 messages).
Focus on: main relationship threads, key facts about the user and character, major events.
Write in English. Be concise — this is a higher-level summary.

WINDOW SUMMARIES:
${convText}`;
        }

        case 'global': {
            return `${skipNote}Below are medium-level summaries covering the entire conversation with ${charName || 'the AI character'}.
Write a GLOBAL OVERVIEW of the full relationship history.
Include: relationship evolution, most important facts, key moments, persistent themes.
Write in English. Be synthetic — this is the top-level context for the whole history.

MEDIUM SUMMARIES:
${convText}`;
        }

        default: {
            const prevSection = previousSummaryText
                ? `PREVIOUS SUMMARY (incorporate this):\n${previousSummaryText}\n\n---\n\n`
                : '';
            return `${prevSection}Write a comprehensive, detailed summary of the conversation below.
This summary will REPLACE the full history in future API calls, so include everything important.

Cover:
- All topics discussed and decisions made
- Important facts revealed about the user (name, age, job, hobbies, relationships, etc.)
- Key moments and memorable exchanges
- Emotional tone and relationship dynamic between user and ${charName}
- Any running themes, promises, inside jokes, or ongoing topics
- Anything that might be referenced in future messages

Be thorough and specific — omit nothing significant.
Write in English.

CONVERSATION:
${convText}`;
        }
    }
}
