/**
 * gemini-prompts-en.js
 *
 * Prompt builders for Gemini — English communication mode.
 * Memory and summary are extracted/written in English.
 * Chat system prompt instructs the AI to respond in English.
 */

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
    const fmtPlain = arr => (arr || []).map(i => i.text || i).filter(Boolean);
    const existingStr = JSON.stringify({
        user: {
            profile:  fmtPlain(existing.profile),
            goals:    fmtPlain(existing.goals),
            memories: fmtPlain(existing.memories),
        },
        character: {
            charProfile:  fmtPlain(existing.charProfile),
            charGoals:    fmtPlain(existing.charGoals),
            charMemories: fmtPlain(existing.charMemories),
        },
    }, null, 2);

    const companionName   = character?.name || 'Companion';
    const allMessages     = recentMessages || [];
    const isFirstExchange = allMessages.filter(m => m.role === 'user').length <= 1;

    const contextMsgs = isFirstExchange ? [] : allMessages.slice(-8, -2);
    const recentStr   = contextMsgs
        .map(m => `${m.role === 'user' ? 'User' : companionName}: ${m.content}`)
        .join('\n');

    const welcomeMsg  = character?.welcomeMessage;
    const exchangeStr = (isFirstExchange && welcomeMsg)
        ? `${companionName}: ${welcomeMsg}\nUser: ${userMsg}\n${companionName}: ${aiMsg}`
        : `User: ${userMsg}\n${companionName}: ${aiMsg}`;

    const charCtx = character ? [
        `CHARACTER NAME: ${character.name}`,
        character.scenario           ? `SCENARIO: ${character.scenario}`                              : '',
        character.promptInstructions ? `CHARACTER INSTRUCTIONS:\n${character.promptInstructions}`    : '',
    ].filter(Boolean).join('\n') : '';

    return `You are a memory extraction assistant for an AI companion named ${companionName}.
Respond in English — ALL values in arrays must be written in English.

${charCtx ? `CHARACTER CONTEXT:\n${charCtx}\n` : ''}CURRENT MEMORY (preserve ALL existing entries, add new ones):
${existingStr}
${recentStr ? `\nRECENT CONVERSATION (context):\n${recentStr}\n` : ''}EXCHANGE TO ANALYSE${isFirstExchange ? ' (first meeting — analyse everything)' : ''}:
${exchangeStr}

Task:
1. Take ALL existing memory entries from above.
2. Add NEW facts, preferences, or goals from this exchange.
3. Remove an entry ONLY if it is directly contradicted in this exchange.
4. Return COMPLETE, updated lists — not just new items.

--- SECTION 1: user (what ${companionName} knows about THE USER) ---
- "profile"  = FULL list: facts, preferences, personality traits and relationships
- "goals"    = FULL list of goals, plans, wishes
- "memories" = FULL list of important moments and events

--- SECTION 2: character (what ${companionName} knows about THEMSELVES) ---
- "charProfile"  = FULL list: self-facts, preferences and personality traits
- "charGoals"    = FULL list of own goals and motivations
- "charMemories" = FULL list of own significant memories

Rules:
- Maximum 20 items per list — if exceeded, remove the least important.
- Each item is one short, clear English sentence.
- CHRONOLOGY: Each entry may have a "firstSeen" property (ms since 1970-01-01 epoch).
  New entry → stamp with current time. Updated entry → PRESERVE original "firstSeen".
- Return ONLY a single valid JSON object with exactly these 6 keys:
  profile, goals, memories, charProfile, charGoals, charMemories
- Each value is an array of strings (or objects with "text" and "firstSeen").`;
}

export function buildMemorySeedPrompt(character) {
    return `You are a knowledge extraction assistant for an AI character.
Analyse the character definition below and fill exactly 3 JSON keys.
ALL values must be written in ENGLISH.

CHARACTER NAME: ${character.name}
SCENARIO: ${character.scenario || 'none'}
CHARACTER DETAILS: ${character.characterDetails || 'none'}

Extract ONLY from the definition above:
- "charProfile"  : facts, preferences, personality traits, appearance, backstory — max 15 short sentences
- "charGoals"    : motivations, goals, desires — max 10 short sentences
- "charMemories" : past events, formative experiences — max 10 short sentences

Rules:
- Each item is one short English sentence (no bullet symbols).
- Return ONLY a valid JSON object with exactly these 3 keys. No other text.`;
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
