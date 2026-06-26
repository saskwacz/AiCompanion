import { dbGet, dbPut } from './db.js';
import {
    callMemoryAPI, embedText as providerEmbedText, embedContents as providerEmbedContents,
    buildMemoryUpdatePrompt as providerBuildMemoryUpdatePrompt,
    buildMemorySeedPrompt   as providerBuildMemorySeedPrompt,
} from './providers/index.js';
import { expandRemoveKeys } from './providers/memory-prompt-shared.js';

export const MEMORY_SCHEMA_VERSION = 3;

/** @readonly */
export const MEMORY_KEYS = [
    'profile', 'goals', 'memories',
    'charProfile', 'charGoals', 'charMemories',
];

export const MEMORY_TOP_K        = 15;
export const MEMORY_MIN_SCORE    = 0.28;
export const MEMORY_FALLBACK_PER = 6;
export const MEMORY_MAX_ITEMS    = 15;
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
// { id, text, firstSeen, embedding: number[] | null }

export function createMemoryItem(text, existing = null, createdAtMsgId = null) {
    const now = Date.now();
    const sameText = existing && norm(existing.text || existing) === norm(text);
    return {
        id:             existing?.id ?? crypto.randomUUID(),
        text,
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
        out[key] = (m[key] || []).map(({ id, text, firstSeen, createdAtMsgId, embedding }) => ({
            id, text, firstSeen, createdAtMsgId: createdAtMsgId ?? null, embedding: embedding ?? null,
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
            .sort((a, b) => (b.firstSeen || 0) - (a.firstSeen || 0))
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

    const fmtItem = i => {
        const fs = i.firstSeen ? ` [since: ${i.firstSeen}]` : '';
        const sc = i.score > 0 ? ` [rel: ${i.score.toFixed(2)}]` : '';
        return `${i.text}${fs}${sc}`;
    };

    const fmtSection = (sectionKey, sectionItems) => {
        const label = SECTION_LABELS[sectionKey] || sectionKey;
        const lines = sectionItems
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .map(fmtItem)
            .join(' | ');
        return `${label}: ${lines}`;
    };

    const parts = [];

    // ── Character self-knowledge ──
    const charMemoryKeys = ['charProfile', 'charMemories'];
    const charGoalKeys   = ['charGoals'];
    const charMemParts   = charMemoryKeys.filter(k => bySection[k]?.length).map(k => fmtSection(k, bySection[k]));
    const charGoalParts  = charGoalKeys.filter(k => bySection[k]?.length).map(k => fmtSection(k, bySection[k]));
    if (charMemParts.length) parts.push(`[SEMANTIC MEMORY — about yourself]\n${charMemParts.join('\n')}`);
    if (charGoalParts.length) parts.push(`[GOALS — your motivations]\n${charGoalParts.join('\n')}`);

    // ── User knowledge ──
    const userMemoryKeys = ['profile', 'memories'];
    const userGoalKeys   = ['goals'];
    const userMemParts   = userMemoryKeys.filter(k => bySection[k]?.length).map(k => fmtSection(k, bySection[k]));
    const userGoalParts  = userGoalKeys.filter(k => bySection[k]?.length).map(k => fmtSection(k, bySection[k]));
    if (userMemParts.length) parts.push(`[SEMANTIC MEMORY — about the user]\n${userMemParts.join('\n')}`);
    if (userGoalParts.length) parts.push(`[GOALS — user's goals]\n${userGoalParts.join('\n')}`);

    const ctx  = parts.join('\n\n');
    const note = '\n[NOTE] [since:…]=chronology. [rel:…]=relevance.';
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
            .slice(0, 20);

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
 * @param {*}        aiMsgSeqId     - message seq id for new items
 * @param {Set|null} selectedIds    - IDs of items shown to the LLM.
 *   null  → keep-all mode (goals): never delete, only add/update existing.
 *   Set   → selective mode (delta prompt):
 *             • returned + matched  → updated
 *             • not returned        → preserved unchanged
 *             • new string          → added
 *   Deletions use explicit "remove" arrays in the LLM response.
 */
function mergeItems(existingItems, newStrings, aiMsgSeqId = null, selectedIds = null) {
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
            result.push({
                id:             item.id,
                text,
                firstSeen:      item.firstSeen ?? now,
                createdAtMsgId: item.createdAtMsgId ?? aiMsgSeqId,
                embedding:      textChanged ? null : (item.embedding ?? null),
            });
        } else {
            // Not returned by LLM → preserve (delta prompt; delete via "remove" only)
            result.push(item);
        }
    }

    for (let idx = 0; idx < newArr.length; idx++) {
        if (newMatched.has(idx)) continue;
        const text = newArr[idx];
        result.push({
            id:             crypto.randomUUID(),
            text,
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

function applyRemovals(items, removeTexts) {
    if (!removeTexts?.length) return items;
    return items.filter(item => {
        const n = norm(item.text);
        return !removeTexts.some(r => {
            const rn = norm(r);
            return rn && (n === rn || n.includes(rn) || rn.includes(n));
        });
    });
}

function capItems(items, max = MEMORY_MAX_ITEMS) {
    if (items.length <= max) return items;
    return [...items].sort((a, b) => (b.firstSeen || 0) - (a.firstSeen || 0)).slice(0, max);
}

function parseMemoryResponse(raw) {
    const u = raw.user ?? {};
    const c = raw.character ?? {};

    const profile     = toStr(raw.profile ?? u.profile ?? raw.p ?? u.p);
    const charProfile = toStr(raw.charProfile ?? c.charProfile ?? raw.cp ?? c.cp);

    return {
        profile:     profile.length     ? profile     : toStr(raw.facts ?? u.facts)
            .concat(toStr(raw.preferences ?? u.preferences), toStr(raw.relationships ?? u.relationships)),
        goals:       toStr(raw.goals       ?? u.goals       ?? raw.g  ?? u.g),
        memories:    toStr(raw.memories    ?? u.memories    ?? raw.m  ?? u.m),
        charProfile: charProfile.length   ? charProfile   : toStr(raw.charFacts ?? c.charFacts)
            .concat(toStr(raw.charPreferences ?? c.charPreferences), toStr(raw.charPersonality ?? c.charPersonality)),
        charGoals:    toStr(raw.charGoals    ?? c.charGoals    ?? raw.cg ?? c.cg),
        charMemories: toStr(raw.charMemories ?? c.charMemories ?? raw.cm ?? c.cm),
        remove:       expandRemoveKeys(raw.remove),
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

/**
 * Compute the new memory (including embeddings) WITHOUT saving to DB.
 * Throws on any error — caller decides whether to persist.
 * @returns {object} fully-computed memory object ready to be saved
 */
export async function computeMemoryUpdate(chatId, userMsg, aiMsg, cfg, character, recentMessages = [], maxOutputTokens = 8192, aiMsgSeqId = null, embedCfg = null) {
    const existing     = normalizeMemory(await getMemoryForChat(chatId));
    const exchangeText = userMsg + ' ' + aiMsg;

    const { promptMemory, selectedIds } = await selectForUpdatePrompt(existing, exchangeText, embedCfg);
    const prompt = providerBuildMemoryUpdatePrompt(cfg, promptMemory, character, recentMessages, userMsg, aiMsg);

    const raw  = await callMemoryModel(prompt, maxOutputTokens, cfg, 'normal');
    const flat = parseMemoryResponse(raw);

    console.log('[Memory] Parsed:', JSON.stringify({
        profile: flat.profile?.length, goals: flat.goals?.length,
        charProfile: flat.charProfile?.length,
    }));

    // Goals use keep-all mode (null selectedIds): they are only updated or added,
    // never deleted by omission — the LLM may simply not mention them when they're
    // not relevant to the current exchange, but they should persist until explicitly replaced.
    const miSelective = (key, ex) => mergeItems(ex || [], flat[key] || [], aiMsgSeqId, selectedIds);
    const miKeepAll   = (key, ex) => mergeItems(ex || [], flat[key] || [], aiMsgSeqId, null);

    const updated = {
        ...existing,
        profile:      miSelective('profile',      existing.profile),
        goals:        miKeepAll(  'goals',        existing.goals),
        memories:     miSelective('memories',     existing.memories),
        charProfile:  miSelective('charProfile',  existing.charProfile),
        charGoals:    miKeepAll(  'charGoals',    existing.charGoals),
        charMemories: miSelective('charMemories', existing.charMemories),
    };

    for (const key of MEMORY_KEYS) {
        updated[key] = applyRemovals(updated[key], flat.remove?.[key]);
        updated[key] = capItems(updated[key]);
    }

    if (!embedCfg) return updated;
    return await ensureEmbeddings(updated, embedCfg);
}

/** Save a pre-computed memory object to DB. */
export async function persistMemory(mem) {
    await saveMemory(mem);
    return mem;
}

export async function updateMemoryFromExchange(chatId, userMsg, aiMsg, cfg, character, recentMessages = [], maxOutputTokens = 8192, aiMsgSeqId = null, embedCfg = null) {
    try {
        const computed = await computeMemoryUpdate(chatId, userMsg, aiMsg, cfg, character, recentMessages, maxOutputTokens, aiMsgSeqId, embedCfg);
        return await persistMemory(computed);
    } catch (e) {
        console.warn('[Memory] Update failed:', e.message);
        return normalizeMemory(await getMemoryForChat(chatId));
    }
}

// ============ SEED / REFRESH FROM CHARACTER DEFINITION ============
export async function seedMemoryFromCharacter(chatId, character, cfg, existingMemory, maxOutputTokens = 8192, embedCfg = null) {
    const hasContent = character.characterDetails || character.scenario;
    if (!hasContent) return;

    const existing = normalizeMemory(existingMemory || await getMemoryForChat(chatId));
    const prompt   = providerBuildMemorySeedPrompt(cfg, character);

    try {
        const raw  = await callMemoryModel(prompt, maxOutputTokens, cfg, 'batch');
        const flat = parseMemoryResponse(raw);
        const mi   = (key, ex) => mergeItems(ex || [], flat[key]);

        const seeded = {
            chatId,
            profile:      existing.profile      || [],
            goals:        existing.goals        || [],
            memories:     existing.memories     || [],
            charProfile:  mi('charProfile',  existing.charProfile),
            charGoals:    mi('charGoals',    existing.charGoals),
            charMemories: mi('charMemories', existing.charMemories),
        };
        return await persistWithEmbeddings(seeded, embedCfg);
    } catch (e) {
        console.warn('[Memory] Seed failed:', e.message);
    }
}
