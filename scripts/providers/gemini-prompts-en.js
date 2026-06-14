/**
 * gemini-prompts-en.js
 *
 * Prompt builders for Gemini — English communication mode.
 * Memory and summary are extracted/written in English.
 * Chat system prompt instructs the AI to respond in English.
 */

// ─── CHAT — system prompt ─────────────────────────────────────────────────────

/**
 * Full character system prompt: personality → memory → scenario → dialogue.
 * Includes English language instruction.
 */
export function buildSystemPrompt(character, memCtx = '') {
    const parts = [];

    if (character.prompt) parts.push(character.prompt);
    if (memCtx)           parts.push(memCtx);
    if (character.scenario)
        parts.push(`Scenario: ${character.scenario}`);
    if (character.dialogueExamples)
        parts.push(`Dialogue Examples:\n${character.dialogueExamples}`);

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
        character.scenario         ? `SCENARIO: ${character.scenario}`                     : '',
        character.dialogueExamples ? `DIALOGUE EXAMPLES:\n${character.dialogueExamples}` : '',
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
PERSONALITY PROMPT: ${character.prompt || 'none'}
SCENARIO: ${character.scenario || 'none'}
CHARACTER DETAILS: ${character.characterDetails || 'none'}
DIALOGUE EXAMPLES:
${character.dialogueExamples || 'none'}

Extract ONLY from the definition above:
- "charProfile"  : facts, preferences, personality traits, appearance, backstory — max 15 short sentences
- "charGoals"    : motivations, goals, desires — max 10 short sentences
- "charMemories" : past events, formative experiences — max 10 short sentences

Rules:
- Each item is one short English sentence (no bullet symbols).
- Return ONLY a valid JSON object with exactly these 3 keys. No other text.`;
}

// ─── SUMMARY ─────────────────────────────────────────────────────────────────

export function buildSummaryPrompt({ convText, charName, previousSummaryText }) {
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
