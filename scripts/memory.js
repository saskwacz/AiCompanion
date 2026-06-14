import { dbGet, dbPut } from './db.js';
import {
    callMemoryAPI, embedText as providerEmbedText, embedContents as providerEmbedContents,
    buildMemoryUpdatePrompt as providerBuildMemoryUpdatePrompt,
    buildMemorySeedPrompt   as providerBuildMemorySeedPrompt,
} from './providers/index.js';

export const MEMORY_SCHEMA_VERSION = 3;

/** @readonly */
export const MEMORY_KEYS = [
    'profile', 'goals', 'memories',
    'charProfile', 'charGoals', 'charMemories',
];

export const MEMORY_TOP_K        = 20;
export const MEMORY_MIN_SCORE    = 0.28;
export const MEMORY_FALLBACK_PER = 8;
export const EMBEDDING_DIM       = 768;
const EMBED_BATCH_SIZE           = 32;

const SECTION_LABELS = {
    charProfile:  'Self-profile',
    charGoals:    'Own goals',
    charMemories: 'Own memories',
    profile:      'Profile',
    goals:        'Goals',
    memories:     'Memories',
};

// ============ ITEM SHAPE ============
// { id, text, count, firstSeen, embedding: number[] | null }

export function createMemoryItem(text, existing = null, createdAtMsgId = null) {
    const now = Date.now();
    const sameText = existing && norm(existing.text || existing) === norm(text);
    return {
        id:             existing?.id ?? crypto.randomUUID(),
        text,
        count:          existing?.count ?? 1,
        firstSeen:      existing?.firstSeen ?? now,
        createdAtMsgId: existing?.createdAtMsgId ?? createdAtMsgId,
        embedding:      sameText ? (existing?.embedding ?? null) : null,
    };
}

function normalizeItem(item) {
    if (!item) return null;
    const text = typeof item === 'string' ? item : item.text;
    if (!text) return null;
    return createMemoryItem(text, typeof item === 'object' ? item : null);
}

function normalizeItems(items) {
    return (items || []).map(normalizeItem).filter(Boolean);
}

function mergeLegacyItems(...arrays) {
    const seen = new Set();
    const result = [];
    for (const arr of arrays) {
        for (const item of arr || []) {
            const normalized = normalizeItem(item);
            if (!normalized) continue;
            const key = norm(normalized.text);
            if (seen.has(key)) continue;
            seen.add(key);
            result.push(normalized);
        }
    }
    return result;
}

function isLegacyMemory(mem) {
    return mem.facts !== undefined || mem.preferences !== undefined
        || mem.charFacts !== undefined || mem.charPreferences !== undefined
        || mem.charPersonality !== undefined || mem.relationships !== undefined;
}

/** Migrates legacy memory to current schema. */
export function normalizeMemory(mem) {
    if (!mem) return emptyMemory();

    const migrated = isLegacyMemory(mem) ? {
        chatId:       mem.chatId,
        schemaVersion: MEMORY_SCHEMA_VERSION,
        profile:      mergeLegacyItems(mem.facts, mem.preferences, mem.relationships),
        goals:        mem.goals        || [],
        memories:     mem.memories     || [],
        charProfile:  mergeLegacyItems(mem.charFacts, mem.charPreferences, mem.charPersonality),
        charGoals:    mem.charGoals    || [],
        charMemories: mem.charMemories || [],
        updatedAt:    mem.updatedAt ?? Date.now(),
    } : { ...mem };

    for (const key of MEMORY_KEYS) {
        migrated[key] = normalizeItems(migrated[key]);
    }
    migrated.schemaVersion = MEMORY_SCHEMA_VERSION;
    migrated.updatedAt     = mem.updatedAt ?? Date.now();
    return migrated;
}

export function emptyMemory(chatId) {
    return {
        chatId,
        schemaVersion: MEMORY_SCHEMA_VERSION,
        profile:      [],
        goals:        [],
        memories:     [],
        charProfile:  [],
        charGoals:    [],
        charMemories: [],
        updatedAt:    Date.now(),
    };
}

// ============ CRUD ============
export async function getMemoryForChat(chatId) {
    const raw = await dbGet('memory', chatId);
    return raw ? normalizeMemory(raw) : emptyMemory(chatId);
}

export async function saveMemory(mem) {
    await dbPut('memory', normalizeMemory({ ...mem, updatedAt: Date.now() }));
}

/**
 * Remove all memory items whose createdAtMsgId is in the deletedSeqIds set.
 * Persists the pruned memory and returns it.
 */
export async function pruneMemoryByMsgIds(chatId, deletedSeqIds) {
    if (!deletedSeqIds?.length) return null;
    const idSet = new Set(deletedSeqIds);
    const mem   = await getMemoryForChat(chatId);
    let changed = false;
    const pruned = { ...mem };
    for (const key of MEMORY_KEYS) {
        const before = pruned[key] || [];
        const after  = before.filter(item => {
            if (item.createdAtMsgId != null && idSet.has(item.createdAtMsgId)) {
                changed = true;
                return false;
            }
            return true;
        });
        pruned[key] = after;
    }
    if (changed) {
        await saveMemory(pruned);
        console.log(`[Memory] Pruned items tied to msgIds: [${[...idSet].join(', ')}]`);
    }
    return pruned;
}

// ============ EXPORT / IMPORT ============
export function memoryForExport(mem) {
    const m = normalizeMemory(mem);
    const out = { schemaVersion: MEMORY_SCHEMA_VERSION };
    for (const key of MEMORY_KEYS) {
        out[key] = (m[key] || []).map(({ id, text, count, firstSeen, createdAtMsgId, embedding }) => ({
            id, text, count, firstSeen, createdAtMsgId: createdAtMsgId ?? null, embedding: embedding ?? null,
        }));
    }
    return out;
}

export function memoryFromImport(data, chatId) {
    if (!data) return emptyMemory(chatId);
    return normalizeMemory({ chatId, ...data });
}

// ============ EMBEDDINGS ============

export function flattenMemoryItems(mem) {
    const m = normalizeMemory(mem);
    return MEMORY_KEYS.flatMap(key =>
        (m[key] || []).map(item => ({ ...item, section: key })),
    );
}

export function itemsNeedingEmbedding(mem) {
    return flattenMemoryItems(mem).filter(i => !i.embedding?.length);
}

export function cosineSimilarity(a, b) {
    if (!a?.length || a.length !== b?.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na  += a[i] * a[i];
        nb  += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom ? dot / denom : 0;
}

function applyEmbeddings(mem, items, vectors) {
    const byId = new Map(items.map((item, i) => [item.id, vectors[i]]));
    const updated = { ...mem };
    for (const key of MEMORY_KEYS) {
        updated[key] = (mem[key] || []).map(item =>
            byId.has(item.id) ? { ...item, embedding: byId.get(item.id) } : item,
        );
    }
    return updated;
}

/** Embed all items missing vectors; returns updated memory (does not persist). */
export async function ensureEmbeddings(mem, cfg) {
    const m       = normalizeMemory(mem);
    const needing = itemsNeedingEmbedding(m);
    if (!needing.length || !cfg) return m;

    const vectors = [];
    for (let i = 0; i < needing.length; i += EMBED_BATCH_SIZE) {
        const batch     = needing.slice(i, i + EMBED_BATCH_SIZE);
        const batchVecs = await providerEmbedContents(cfg, { texts: batch.map(item => item.text) });
        vectors.push(...batchVecs);
    }

    console.log(`[Memory] Embedded ${needing.length} item(s)`);
    return applyEmbeddings(m, needing, vectors);
}

// ============ SEMANTIC SEARCH ============

export function searchMemoryItems(mem, queryEmbedding, { topK = MEMORY_TOP_K, minScore = MEMORY_MIN_SCORE } = {}) {
    return flattenMemoryItems(mem)
        .filter(i => i.embedding?.length)
        .map(item => ({ ...item, score: cosineSimilarity(queryEmbedding, item.embedding) }))
        .filter(i => i.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
}

function fallbackItems(mem, perSection = MEMORY_FALLBACK_PER) {
    const m = normalizeMemory(mem);
    return MEMORY_KEYS.flatMap(key =>
        [...(m[key] || [])]
            .sort((a, b) => (b.count || 1) - (a.count || 1))
            .slice(0, perSection)
            .map(item => ({ ...item, section: key, score: 0 })),
    );
}

function formatMemoryContext(items) {
    if (!items.length) return '';

    const bySection = {};
    for (const item of items) {
        if (!bySection[item.section]) bySection[item.section] = [];
        bySection[item.section].push(item);
    }

    const fmtSection = (sectionKey, sectionItems) => {
        const label = SECTION_LABELS[sectionKey] || sectionKey;
        const lines = sectionItems
            .sort((a, b) => (b.score || 0) - (a.score || 0) || (b.count || 1) - (a.count || 1))
            .map(i => {
                const c  = i.count || 1;
                const fs = i.firstSeen ? ` [since: ${i.firstSeen}]` : '';
                const sc = i.score > 0 ? ` [rel: ${i.score.toFixed(2)}]` : '';
                const text = c > 1 ? `${i.text} [x${c}]${fs}${sc}` : `${i.text}${fs}${sc}`;
                return text;
            })
            .join(' | ');
        return `${label}: ${lines}`;
    };

    const charKeys = ['charProfile', 'charGoals', 'charMemories'];
    const userKeys = ['profile', 'goals', 'memories'];

    const charParts = charKeys.filter(k => bySection[k]?.length).map(k => fmtSection(k, bySection[k]));
    const userParts = userKeys.filter(k => bySection[k]?.length).map(k => fmtSection(k, bySection[k]));

    const parts = [];
    if (charParts.length) parts.push(`[ABOUT YOURSELF]\n${charParts.join('\n')}`);
    if (userParts.length) parts.push(`[ABOUT THE USER]\n${userParts.join('\n')}`);

    const ctx  = `[COMPANION MEMORY — semantic retrieval]\n${parts.join('\n\n')}`;
    const note = '\n\n[NOTE] Memory items are ranked by relevance to the current message. Timestamps [since: …] mark when a fact was first learned.';
    return ctx + note;
}

/**
 * Builds memory context for the system prompt using semantic search.
 * @param {object} mem
 * @param {{ query?: string, cfg?: object, topK?: number, minScore?: number }} opts
 */
export async function memoryToContext(mem, { query = '', cfg, topK = MEMORY_TOP_K, minScore = MEMORY_MIN_SCORE } = {}) {
    let m = normalizeMemory(mem);
    if (!flattenMemoryItems(m).length) return '';

    if (cfg) {
        m = await ensureEmbeddings(m, cfg);
    }

    const embedded = flattenMemoryItems(m).filter(i => i.embedding?.length);
    let selected;

    if (query && cfg && embedded.length) {
        try {
            const queryEmb = await providerEmbedText(cfg, { text: query });
            selected = searchMemoryItems(m, queryEmb, { topK, minScore });
            if (window.DEBUG_PROMPTS) {
                console.groupCollapsed('[Memory] Semantic retrieval');
                console.log('Query:', query.substring(0, 120));
                console.log('Hits:', selected.map(i => `${i.score.toFixed(3)} ${i.section}: ${i.text.substring(0, 60)}`));
                console.groupEnd();
            }
        } catch (e) {
            console.warn('[Memory] Semantic search failed, using fallback:', e.message);
            selected = fallbackItems(m);
        }
    } else {
        selected = fallbackItems(m);
    }

    if (!selected.length) selected = fallbackItems(m);
    return formatMemoryContext(selected);
}

// ============ MERGE / PARSE ============
function norm(s) {
    return String(s).toLowerCase().replace(/[^\w\s]/g, '').trim();
}

/** Build a memory object containing only the items whose IDs are in `ids`. */
function filterMemoryToIds(mem, ids) {
    const out = { ...mem };
    for (const key of MEMORY_KEYS) {
        out[key] = (mem[key] || []).filter(item => ids.has(item.id));
    }
    return out;
}

/**
 * Semantically select memory items to show in the update prompt.
 *
 * - Items WITHOUT embeddings → always included (need LLM exposure to become useful).
 * - Items WITH embeddings → selected by cosine similarity ≥ 0.15, up to topK=30.
 * - If no embedCfg or no embedded items → fall back to all items.
 *
 * Returns { promptMemory, selectedIds }:
 *   promptMemory — filtered memory to pass to buildMemoryUpdatePrompt
 *   selectedIds  — Set<id> of all items shown to the LLM (candidates for update/delete)
 */
async function selectForUpdatePrompt(existing, exchangeText, embedCfg) {
    const allItems = flattenMemoryItems(existing);
    if (!allItems.length) return { promptMemory: existing, selectedIds: new Set() };

    const withEmb    = allItems.filter(i => i.embedding?.length);
    const withoutEmb = allItems.filter(i => !i.embedding?.length);

    // Items without embeddings always go into the prompt so the LLM can see and refine them
    const alwaysIds = new Set(withoutEmb.map(i => i.id));

    if (!embedCfg || !withEmb.length) {
        // No semantic selection possible — show everything
        const allIds = new Set(allItems.map(i => i.id));
        return { promptMemory: existing, selectedIds: allIds };
    }

    try {
        const queryEmb = await providerEmbedText(embedCfg, { text: exchangeText });
        const scored = withEmb
            .map(item => ({ ...item, score: cosineSimilarity(queryEmb, item.embedding) }))
            .filter(i => i.score >= 0.15)
            .sort((a, b) => b.score - a.score)
            .slice(0, 30);

        const selectedIds  = new Set([...scored.map(i => i.id), ...alwaysIds]);
        const promptMemory = filterMemoryToIds(existing, selectedIds);
        console.log(`[Memory] Update prompt: showing ${selectedIds.size}/${allItems.length} items (semantic + unembedded)`);
        return { promptMemory, selectedIds };
    } catch (e) {
        console.warn('[Memory] Semantic selection for update prompt failed — using all items:', e.message);
        const allIds = new Set(allItems.map(i => i.id));
        return { promptMemory: existing, selectedIds: allIds };
    }
}

/**
 * Merge existing memory items with strings returned by the LLM.
 *
 * @param {object[]} existingItems  - current items for this section
 * @param {string[]} newStrings     - strings returned by the LLM for this section
 * @param {string}   exchangeText   - user + AI text (used for mention counting)
 * @param {*}        aiMsgSeqId     - message seq id for new items
 * @param {Set|null} selectedIds    - IDs of items that were shown to the LLM.
 *   null  → keep-all mode (seeding): never delete, only add/update existing.
 *   Set   → selective mode:
 *             • item in selectedIds  + returned by LLM  → updated
 *             • item in selectedIds  + NOT returned      → DELETED (LLM dropped it)
 *             • item NOT in selectedIds                  → PRESERVED (LLM never saw it)
 *             • new string not matching any existing     → ADDED
 */
function mergeItems(existingItems, newStrings, exchangeText = '', aiMsgSeqId = null, selectedIds = null) {
    const exNorm   = norm(exchangeText);
    const now      = Date.now();
    const existing = normalizeItems(existingItems);
    const newArr   = newStrings || [];

    // Track which indices of newArr have been claimed by an existing item
    const newMatched = new Set();

    const result = [];
    for (const item of existing) {
        const isSelected = !selectedIds || selectedIds.has(item.id);

        if (!isSelected) {
            // LLM never saw this item — always preserve unchanged
            result.push(item);
            continue;
        }

        // Item was shown to LLM — find best matching new string (bidirectional keyword overlap)
        const itemNorm = norm(item.text);
        const itemKw   = itemNorm.split(/\s+/).filter(w => w.length > 3);

        const matchIdx = newArr.findIndex((text, idx) => {
            if (newMatched.has(idx)) return false;
            const newNorm = norm(text);
            const newKw   = newNorm.split(/\s+/).filter(w => w.length > 3);
            return newKw.some(w => itemNorm.includes(w)) ||
                   itemKw.some(w => newNorm.includes(w));
        });

        if (matchIdx >= 0) {
            newMatched.add(matchIdx);
            const text        = newArr[matchIdx];
            const textChanged = norm(item.text) !== norm(text);
            const mentioned   = norm(text).split(/\s+/).filter(w => w.length > 3).some(w => exNorm.includes(w));
            result.push({
                id:             item.id,
                text,
                count:          (item.count || 1) + (mentioned ? 1 : 0),
                firstSeen:      item.firstSeen ?? now,
                createdAtMsgId: item.createdAtMsgId ?? aiMsgSeqId,
                embedding:      textChanged ? null : (item.embedding ?? null),
            });
        } else if (!selectedIds) {
            // keep-all / seeding mode: preserve items the LLM didn't explicitly return
            result.push(item);
        }
        // selective mode + not returned → item intentionally dropped by LLM → skip
    }

    // Append new strings that didn't match any existing item
    for (let idx = 0; idx < newArr.length; idx++) {
        if (newMatched.has(idx)) continue;
        const text      = newArr[idx];
        const mentioned = norm(text).split(/\s+/).filter(w => w.length > 3).some(w => exNorm.includes(w));
        result.push({
            id:             crypto.randomUUID(),
            text,
            count:          mentioned ? 2 : 1,
            firstSeen:      now,
            createdAtMsgId: aiMsgSeqId,
            embedding:      null,
        });
    }

    return result;
}

function toStr(arr) {
    return (Array.isArray(arr) ? arr : [])
        .map(i => (typeof i === 'string' ? i : i?.text))
        .filter(Boolean);
}

function parseMemoryResponse(raw) {
    const u = raw.user ?? {};
    const c = raw.character ?? {};

    const profile     = toStr(raw.profile ?? u.profile);
    const charProfile = toStr(raw.charProfile ?? c.charProfile);

    return {
        profile:     profile.length     ? profile     : toStr(raw.facts ?? u.facts)
            .concat(toStr(raw.preferences ?? u.preferences), toStr(raw.relationships ?? u.relationships)),
        goals:       toStr(raw.goals       ?? u.goals),
        memories:    toStr(raw.memories    ?? u.memories),
        charProfile: charProfile.length   ? charProfile : toStr(raw.charFacts ?? c.charFacts)
            .concat(toStr(raw.charPreferences ?? c.charPreferences), toStr(raw.charPersonality ?? c.charPersonality)),
        charGoals:   toStr(raw.charGoals   ?? c.charGoals),
        charMemories: toStr(raw.charMemories ?? c.charMemories),
    };
}

// ============ INTERNAL API CALL ============
async function callMemoryModel(prompt, maxOutputTokens = 4096, cfg, priority = 'normal') {
    return callMemoryAPI(cfg, { prompt, maxOutputTokens, priority });
}

async function persistWithEmbeddings(mem, embedCfg) {
    const withEmb = embedCfg ? await ensureEmbeddings(mem, embedCfg) : mem;
    await saveMemory(withEmb);
    return withEmb;
}

// ============ UPDATE MEMORY AFTER EXCHANGE ============
export async function updateMemoryFromExchange(chatId, userMsg, aiMsg, cfg, character, recentMessages = [], maxOutputTokens = 8192, aiMsgSeqId = null, embedCfg = null) {
    const existing     = normalizeMemory(await getMemoryForChat(chatId));
    const exchangeText = userMsg + ' ' + aiMsg;

    // Select which items to show in the update prompt (semantic search on existing embeddings)
    const { promptMemory, selectedIds } = await selectForUpdatePrompt(existing, exchangeText, embedCfg);
    const prompt = providerBuildMemoryUpdatePrompt(cfg, promptMemory, character, recentMessages, userMsg, aiMsg);

    try {
        const raw  = await callMemoryModel(prompt, maxOutputTokens, cfg, 'normal');
        const flat = parseMemoryResponse(raw);

        console.log('[Memory] Parsed:', JSON.stringify({
            profile: flat.profile?.length, goals: flat.goals?.length,
            charProfile: flat.charProfile?.length,
        }));

        const mi = (key, ex) => mergeItems(ex || [], flat[key] || [], exchangeText, aiMsgSeqId, selectedIds);
        const updated = {
            ...existing,
            profile:      mi('profile',      existing.profile),
            goals:        mi('goals',        existing.goals),
            memories:     mi('memories',     existing.memories),
            charProfile:  mi('charProfile',  existing.charProfile),
            charGoals:    mi('charGoals',    existing.charGoals),
            charMemories: mi('charMemories', existing.charMemories),
        };
        return await persistWithEmbeddings(updated, embedCfg || cfg);
    } catch (e) {
        console.warn('[Memory] Update failed:', e.message);
        return existing;
    }
}

// ============ SEED / REFRESH FROM CHARACTER DEFINITION ============
export async function seedMemoryFromCharacter(chatId, character, cfg, existingMemory, maxOutputTokens = 8192, embedCfg = null) {
    const hasContent = character.characterDetails || character.scenario || character.prompt;
    if (!hasContent) return;

    const existing = normalizeMemory(existingMemory || await getMemoryForChat(chatId));
    const prompt   = providerBuildMemorySeedPrompt(cfg, character);

    try {
        const raw  = await callMemoryModel(prompt, maxOutputTokens, cfg, 'batch');
        const flat = parseMemoryResponse(raw);
        const et   = [character.prompt, character.scenario,
                      character.characterDetails, character.dialogueExamples].filter(Boolean).join(' ');
        const mi   = (key, ex) => mergeItems(ex || [], flat[key], et);

        const seeded = {
            chatId,
            profile:      existing.profile      || [],
            goals:        existing.goals        || [],
            memories:     existing.memories     || [],
            charProfile:  mi('charProfile',  existing.charProfile),
            charGoals:    mi('charGoals',    existing.charGoals),
            charMemories: mi('charMemories', existing.charMemories),
        };
        return await persistWithEmbeddings(seeded, embedCfg || cfg);
    } catch (e) {
        console.warn('[Memory] Seed failed:', e.message);
    }
}
