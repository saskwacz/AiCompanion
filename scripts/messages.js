import { dbAdd, dbDelete, dbGet, dbPut, dbGetAll } from './db.js';

// ============ SEQ ID HELPERS ============
// Each chat has an auto-incrementing seqId counter (1-based) stored in 'messageSeq'.

async function nextSeqId(chatId) {
    const rec = await dbGet('messageSeq', chatId);
    const next = (rec?.next ?? 0) + 1;
    await dbPut('messageSeq', { chatId, next });
    return next;
}

export async function resetSeqForChat(chatId) {
    await dbPut('messageSeq', { chatId, next: 0 });
}

// ============ CRUD ============

export async function addMessage(chatId, role, content) {
    const seqId = await nextSeqId(chatId);
    const msg   = { chatId, role, content, timestamp: Date.now(), seqId };
    const id    = await dbAdd('messages', msg);
    return { ...msg, id };
}

export async function getMessagesForChat(chatId) {
    const msgs = await dbGetAll('messages', 'chatId', chatId);
    // Sort by seqId if available, fall back to timestamp for legacy messages
    return msgs.sort((a, b) => (a.seqId ?? a.timestamp) - (b.seqId ?? b.timestamp));
}

export async function deleteMessageById(id) { return dbDelete('messages', id); }

/**
 * Deletes the message with fromId and all messages after it (by DB id).
 * Returns { remaining, deletedSeqIds } where deletedSeqIds is a sorted array
 * of the seqId values that were removed (for memory pruning).
 */
export async function deleteMessagesFrom(chatId, fromId) {
    const all       = await getMessagesForChat(chatId);
    const toDelete  = all.filter(m => m.id >= fromId);
    const deletedSeqIds = toDelete.map(m => m.seqId).filter(s => s != null);
    const deletedIds    = toDelete.map(m => m.id);
    for (const m of toDelete) await dbDelete('messages', m.id);
    const remaining = all.filter(m => m.id < fromId);
    return { remaining, deletedSeqIds, deletedIds };
}

export async function deleteAllForChat(chatId) {
    const msgs = await getMessagesForChat(chatId);
    for (const m of msgs) await dbDelete('messages', m.id);
    await resetSeqForChat(chatId);
}
