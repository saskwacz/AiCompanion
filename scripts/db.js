// ============ IndexedDB WRAPPER ============
// Stores: characters | chats | messages | memory | settings | summaries | avatars

const DB_NAME = 'aicomp_db';
const DB_VERSION = 6;

let _db = null;

export function openDB() {
    return new Promise((resolve, reject) => {
        if (_db) { resolve(_db); return; }

        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = e => {
            const db         = e.target.result;
            const oldVersion = e.oldVersion; // 0 = fresh install

            // v1 stores (skip if already exist — upgrade from v1)
            if (!db.objectStoreNames.contains('characters')) {
                db.createObjectStore('characters', { keyPath: 'id', autoIncrement: true });
            }
            if (!db.objectStoreNames.contains('chats')) {
                const s = db.createObjectStore('chats', { keyPath: 'id', autoIncrement: true });
                s.createIndex('characterId', 'characterId');
            }
            if (!db.objectStoreNames.contains('messages')) {
                const s = db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
                s.createIndex('chatId', 'chatId');
            }
            if (!db.objectStoreNames.contains('memory')) {
                db.createObjectStore('memory', { keyPath: 'chatId' });
            }
            if (!db.objectStoreNames.contains('settings')) {
                db.createObjectStore('settings', { keyPath: 'key' });
            }

            // v2 migration: rolling summaries per chat
            if (oldVersion < 2 && !db.objectStoreNames.contains('summaries')) {
                db.createObjectStore('summaries', { keyPath: 'chatId' });
            }

            // v3 migration: character avatar blobs
            if (!db.objectStoreNames.contains('avatars')) {
                db.createObjectStore('avatars', { keyPath: 'characterId' });
            }

            // v4 migration: per-chat sequential message counters
            if (oldVersion < 4 && !db.objectStoreNames.contains('messageSeq')) {
                db.createObjectStore('messageSeq', { keyPath: 'chatId' });
            }

            // v5 migration: companion AI object stores (client-side agent state)
            if (oldVersion < 5) {
                if (!db.objectStoreNames.contains('companion_memories')) {
                    const s = db.createObjectStore('companion_memories', { keyPath: 'memory_id' });
                    s.createIndex('chatId', 'chatId');
                    s.createIndex('chatId_type', ['chatId', 'type']);
                }
                if (!db.objectStoreNames.contains('companion_embeddings')) {
                    const s = db.createObjectStore('companion_embeddings', { keyPath: 'embedding_id' });
                    s.createIndex('memory_id', 'memory_id');
                    s.createIndex('chatId', 'chatId');
                }
                if (!db.objectStoreNames.contains('companion_emotions')) {
                    db.createObjectStore('companion_emotions', { keyPath: 'state_id' });
                }
                if (!db.objectStoreNames.contains('companion_goals')) {
                    const s = db.createObjectStore('companion_goals', { keyPath: 'goal_id' });
                    s.createIndex('chatId', 'chatId');
                    s.createIndex('chatId_status', ['chatId', 'status']);
                }
                if (!db.objectStoreNames.contains('companion_world_state')) {
                    db.createObjectStore('companion_world_state', { keyPath: 'chatId' });
                }
                if (!db.objectStoreNames.contains('companion_summaries')) {
                    const s = db.createObjectStore('companion_summaries', { keyPath: 'session_id' });
                    s.createIndex('chatId', 'chatId');
                }
                if (!db.objectStoreNames.contains('companion_initiative_meta')) {
                    db.createObjectStore('companion_initiative_meta', { keyPath: 'chatId' });
                }
            }

            // v6 migration: relationships + initiative queue
            if (oldVersion < 6) {
                if (!db.objectStoreNames.contains('companion_relationships')) {
                    db.createObjectStore('companion_relationships', { keyPath: 'chatId' });
                }
                if (!db.objectStoreNames.contains('companion_initiative_queue')) {
                    const s = db.createObjectStore('companion_initiative_queue', { keyPath: 'initiative_id' });
                    s.createIndex('chatId', 'chatId');
                }
            }
        };

        req.onsuccess = e => { _db = e.target.result; resolve(_db); };
        req.onerror   = () => reject(req.error);
        req.onblocked = () => reject(new Error('IndexedDB blocked – close other tabs and refresh.'));
    });
}

function db() {
    if (!_db) throw new Error('DB not initialized – call openDB() first.');
    return _db;
}

export function dbGet(store, key) {
    return new Promise((res, rej) => {
        const r = db().transaction(store, 'readonly').objectStore(store).get(key);
        r.onsuccess = () => res(r.result ?? null);
        r.onerror   = () => rej(r.error);
    });
}

export function dbGetAll(store, index, query) {
    return new Promise((res, rej) => {
        const tx  = db().transaction(store, 'readonly');
        const src = index ? tx.objectStore(store).index(index) : tx.objectStore(store);
        const r   = query !== undefined ? src.getAll(query) : src.getAll();
        r.onsuccess = () => res(r.result);
        r.onerror   = () => rej(r.error);
    });
}

export function dbPut(store, item) {
    return new Promise((res, rej) => {
        const r = db().transaction(store, 'readwrite').objectStore(store).put(item);
        r.onsuccess = () => res(r.result);
        r.onerror   = () => rej(r.error);
    });
}

export function dbAdd(store, item) {
    return new Promise((res, rej) => {
        const r = db().transaction(store, 'readwrite').objectStore(store).add(item);
        r.onsuccess = () => res(r.result);
        r.onerror   = () => rej(r.error);
    });
}

export function dbDelete(store, key) {
    return new Promise((res, rej) => {
        const r = db().transaction(store, 'readwrite').objectStore(store).delete(key);
        r.onsuccess = () => res();
        r.onerror   = () => rej(r.error);
    });
}

/**
 * Run a synchronous callback against multiple object stores in one transaction.
 * Throws inside fn abort the transaction (automatic rollback).
 * @param {string[]} storeNames
 * @param {'readonly'|'readwrite'} mode
 * @param {(stores: Record<string, IDBObjectStore>) => void} fn
 */
export function dbTransaction(storeNames, mode, fn) {
    return new Promise((resolve, reject) => {
        const tx = db().transaction(storeNames, mode);
        const stores = Object.fromEntries(storeNames.map(n => [n, tx.objectStore(n)]));
        tx.oncomplete = () => resolve(undefined);
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
        try {
            fn(stores);
        } catch (e) {
            tx.abort();
            reject(e);
        }
    });
}
