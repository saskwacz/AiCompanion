import { dbAdd, dbGet, dbPut, dbDelete, dbGetAll } from './db.js';

export async function createChat(characterId) {
    const now  = Date.now();
    const chat = {
        characterId,
        title:           'New Chat',
        createdAt:       now,
        updatedAt:       now,
        messageCount:    0,
        lastMessage:     null,
        lastMessageTime: null,
    };
    const id = await dbAdd('chats', chat);
    return { ...chat, id };
}

export async function updateChat(id, data) {
    const existing = await dbGet('chats', id);
    if (!existing) throw new Error('Chat not found');
    const updated = { ...existing, ...data };
    await dbPut('chats', updated);
    return updated;
}

export async function deleteChatById(id)            { await dbDelete('chats', id); }
export async function getChatById(id)               { return dbGet('chats', id); }

export async function getChatsForCharacter(characterId) {
    const chats = await dbGetAll('chats', 'characterId', characterId);
    return chats.sort((a, b) => b.updatedAt - a.updatedAt);
}
