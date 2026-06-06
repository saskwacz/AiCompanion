import { dbAdd, dbDelete, dbGetAll } from './db.js';

export async function addMessage(chatId, role, content) {
    const msg = { chatId, role, content, timestamp: Date.now() };
    const id  = await dbAdd('messages', msg);
    return { ...msg, id };
}

export async function getMessagesForChat(chatId) {
    const msgs = await dbGetAll('messages', 'chatId', chatId);
    return msgs.sort((a, b) => a.timestamp - b.timestamp);
}

export async function deleteMessageById(id) { return dbDelete('messages', id); }

/**
 * Deletes the message with fromId and all messages after it (by id).
 * Returns the remaining messages for the chat.
 */
export async function deleteMessagesFrom(chatId, fromId) {
    const all      = await getMessagesForChat(chatId);
    const toDelete = all.filter(m => m.id >= fromId);
    for (const m of toDelete) await dbDelete('messages', m.id);
    return all.filter(m => m.id < fromId);
}

export async function deleteAllForChat(chatId) {
    const msgs = await getMessagesForChat(chatId);
    for (const m of msgs) await dbDelete('messages', m.id);
}
