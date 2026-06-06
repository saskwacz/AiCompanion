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
    return prompt.trim();
}
