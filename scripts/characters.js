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

