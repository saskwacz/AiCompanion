import { dbAdd, dbGet, dbPut, dbDelete, dbGetAll } from './db.js';

export async function createCharacter(data) {
    const now = Date.now();
    const char = {
        name:             data.name             || 'New Character',
        prompt:           data.prompt           || 'You are a helpful, friendly AI assistant.',
        welcomeMessage:   data.welcomeMessage   || 'Hello! How can I help you?',
        scenario:         data.scenario         || '',
        characterDetails: data.characterDetails || '',
        dialogueExamples: data.dialogueExamples || '',
        createdAt: now,
        updatedAt: now,
    };
    const id = await dbAdd('characters', char);
    return { ...char, id };
}

export async function updateCharacter(id, data) {
    const existing = await dbGet('characters', id);
    if (!existing) throw new Error('Character not found');
    const updated = { ...existing, ...data, id, updatedAt: Date.now() };
    await dbPut('characters', updated);
    return updated;
}

export async function deleteCharacterById(id) { await dbDelete('characters', id); }
export async function getCharacterById(id)    { return dbGet('characters', id); }
export async function getAllCharacters()       { return dbGetAll('characters'); }

// ============ AVATAR ============
export async function saveCharacterAvatar(characterId, blob) {
    await dbPut('avatars', { characterId, blob });
}
export async function getCharacterAvatar(characterId) {
    const r = await dbGet('avatars', characterId);
    return r?.blob ?? null;
}
export async function deleteCharacterAvatar(characterId) {
    await dbDelete('avatars', characterId);
}

/** Assembles the system prompt including optional memory context.
 *  Memory (structured character + user knowledge) is placed FIRST.
 *  Raw 'prompt' and 'characterDetails' fields are NOT repeated here —
 *  their content is already distilled into structured memory. */
export function buildSystemPrompt(character, memCtx = '') {
    let prompt = '';
    // Memory first — highest priority position
    if (memCtx) prompt += `${memCtx}\n\n`;
    if (character.scenario)         prompt += `Scenario: ${character.scenario}\n\n`;
    if (character.dialogueExamples) prompt += `Dialogue Examples:\n${character.dialogueExamples}`;
    
    // Add instruction about firstSeen for better timeline understanding
    if (memCtx && memCtx.includes('[since:')) {
        prompt += '\n\n[INSTRUCTION] Memory facts with [since: {miliseconds since 1970-01-01}] timestamps help you understand the chronological order of events and how relationships/knowledge developed over time. Use this information to provide contextually accurate responses that reflect what was known when.';
    }
    
    return prompt.trim();
}
