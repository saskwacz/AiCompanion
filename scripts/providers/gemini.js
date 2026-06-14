/**
 * Dedicated Gemini provider for the AiComp companion.
 *
 * Model routing:
 *   CHAT    — gemini-3.5-flash (primary) → gemini-3.1-flash-lite (on failure)
 *   MEMORY  — gemini-3-flash-preview (primary) → gemini-3.1-flash-lite (fallback)
 *             gemini-3.1-flash-lite (batch / low priority)
 *   SUMMARY — gemini-3.1-flash-lite (always)
 *   EMBED   — gemini-embedding-2
 */

import {
    buildChatContents,
    buildChatSystemPrompt,
    selectChatMessages,
} from './gemini-prompts.js';

import { GEMINI_MODELS } from './gemini-models.js';
export { GEMINI_MODELS };

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const KEY_RETRY_DELAY_MS = 5000;

// ─── Rate-limit tracking (429) — per (key fingerprint, model) ──────────────
const RL_KEY = 'aicomp_gemini_rl';
const RL_TTL = 24 * 60 * 60 * 1000; // 24 h

/** Stable short identifier for a key (last 12 chars). Never exposed in UI. */
function keyFp(keyValue) { return String(keyValue).slice(-12); }
/** Composite storage key for a (key, model) pair. */
function rlStoreKey(keyValue, model) { return `${keyFp(keyValue)}|${model}`; }

function rlLoad() {
    try { return JSON.parse(localStorage.getItem(RL_KEY) || '{}'); }
    catch { return {}; }
}
function rlSave(map) {
    try { localStorage.setItem(RL_KEY, JSON.stringify(map)); } catch {}
}

/** Mark a specific (key, model) pair as rate-limited for 24 h. */
export function rlMarkBlocked(keyValue, model) {
    const map = rlLoad();
    map[rlStoreKey(keyValue, model)] = Date.now() + RL_TTL;
    rlSave(map);
    console.warn(`[Gemini] Key "…${keyFp(keyValue)}" + model "${model}" zablokowane na 24 h (429).`);
}

/** Returns true if this specific (key, model) pair is currently rate-limited. */
export function rlIsBlockedForKey(keyValue, model) {
    const map = rlLoad();
    const sk  = rlStoreKey(keyValue, model);
    const exp = map[sk];
    if (!exp) return false;
    if (Date.now() >= exp) { delete map[sk]; rlSave(map); return false; }
    return true;
}

/** Returns all active blocks for a specific key: [{model, until}] */
export function rlGetStatusForKey(keyValue) {
    const fp  = keyFp(keyValue);
    const map = rlLoad();
    const now = Date.now();
    const out = [];
    for (const [sk, exp] of Object.entries(map)) {
        if (exp <= now) continue;
        const sep = sk.indexOf('|');
        if (sep < 0) continue;
        if (sk.slice(0, sep) === fp) out.push({ model: sk.slice(sep + 1), until: new Date(exp) });
    }
    return out;
}

/** Returns all active blocks across all keys: [{keyFp, model, until}] */
export function rlGetStatus() {
    const map = rlLoad();
    const now = Date.now();
    const alive = {};
    let changed = false;
    for (const [sk, exp] of Object.entries(map)) {
        if (exp > now) alive[sk] = exp;
        else changed = true;
    }
    if (changed) rlSave(alive);
    return Object.entries(alive).map(([sk, exp]) => {
        const sep = sk.indexOf('|');
        return { keyFp: sk.slice(0, sep), model: sk.slice(sep + 1), until: new Date(exp) };
    });
}

/**
 * Clear rate-limit blocks.
 * - rlClear()                  → clears everything
 * - rlClear(keyValue)          → clears all models for this key
 * - rlClear(keyValue, model)   → clears this specific (key, model) pair
 */
export function rlClear(keyValue, model) {
    const map = rlLoad();
    if (!keyValue) {
        for (const k of Object.keys(map)) delete map[k];
    } else {
        const fp = keyFp(keyValue);
        for (const sk of Object.keys(map)) {
            const sep = sk.indexOf('|');
            const skFp = sk.slice(0, sep);
            const skModel = sk.slice(sep + 1);
            if (skFp === fp && (!model || skModel === model)) delete map[sk];
        }
    }
    rlSave(map);
}

// ─── Rate-limit error classes ────────────────────────────────────────────────

/** Returns true when the error is a Gemini PROHIBITED / SAFETY / RECITATION block. */
function isProhibited(err) {
    return /PROHIBITED|blocked by Gemini|SAFETY|RECITATION/i.test(err?.message ?? '');
}

export class RateLimitError extends Error {
    constructor(model) {
        super(`Limit API Gemini (429) dla modelu "${model}"`);
        this.name  = 'RateLimitError';
        this.model = model;
    }
}

export class AllModelsRateLimitedError extends Error {
    constructor(models) {
        // Find the earliest unblock time across all active blocks
        const all    = rlGetStatus();
        const minExp = all.length
            ? Math.min(...all.map(s => s.until.getTime()))
            : Date.now() + RL_TTL;
        const hrs = Math.ceil((minExp - Date.now()) / 3_600_000);
        super(
            `Limit API Gemini wyczerpany (429) — wszystkie klucze zablokowane dla modelu(i).\n` +
            `Odblokowanie za ~${hrs} h (${new Date(minExp).toLocaleTimeString()}).`
        );
        this.name      = 'AllModelsRateLimitedError';
        this.models    = models;
        this.unblockAt = new Date(minExp);
    }
}

// ─── Helper: single-model call (no model fallback) ──────────────────────────
/** Wraps withKeyFallback, converts RateLimitError → AllModelsRateLimitedError. */
async function singleModelCall(model, apiKey, fn, shuffle = false) {
    try {
        return await withKeyFallback(apiKey, model, fn, model, shuffle);
    } catch (e) {
        if (e instanceof RateLimitError) throw new AllModelsRateLimitedError([model]);
        throw e;
    }
}

const SAFETY_NONE = [
    { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
];

function modelUrl(model, action = 'generateContent') {
    return `${API_BASE}/${model}:${action}`;
}

function keyItems(apiKey, shuffle = false) {
    const items = Array.isArray(apiKey) ? [...apiKey] : [apiKey];
    if (!items.length) throw new Error('No Gemini API key provided');
    if (shuffle && items.length > 1) {
        // Fisher-Yates shuffle
        for (let i = items.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [items[i], items[j]] = [items[j], items[i]];
        }
    }
    return items;
}

function keyLabel(item) {
    if (typeof item === 'string') return `…${item.slice(-6)}`;
    const key = item.key;
    return item.label || `…${key.slice(-6)}`;
}

function plainKey(item) {
    return typeof item === 'string' ? item : item.key;
}

/** Try fn(plainKey) for each key; wait between attempts on failure.
 * @param {*}        apiKey  - single key or array of key objects
 * @param {string}   purpose - label for logging
 * @param {function} fn      - (key) => Promise
 * @param {string|null} model - model being called; used for per-key rate-limit tracking
 */
async function withKeyFallback(apiKey, purpose, fn, model = null, shuffle = false) {
    const items = keyItems(apiKey, shuffle);
    let lastErr = null;

    for (let i = 0; i < items.length; i++) {
        const key   = plainKey(items[i]);
        const label = keyLabel(items[i]);

        // Skip this key if it is already rate-limited for this specific model
        if (model && rlIsBlockedForKey(key, model)) {
            console.log(`[Gemini] Skipping "${label}" — rate-limited for "${model}"`);
            if (!lastErr) lastErr = new RateLimitError(model);
            continue;
        }

        console.log(`[Gemini] ${purpose} → key: "${label}"`);
        try { return await fn(key); }
        catch (e) {
            lastErr = e;
            if (e instanceof RateLimitError) {
                if (model) rlMarkBlocked(key, model); // mark this key+model as blocked
                console.warn(`[Gemini] "${label}" rate-limited (429) for "${e.model}" — trying next key…`);
                continue; // no delay for 429, try next key immediately
            }
            // PROHIBITED CONTENT — retrying with other keys won't help; fail immediately
            if (isProhibited(e)) {
                console.warn(`[Gemini] "${label}" prohibited content — not retrying other keys.`);
                throw e;
            }
            console.warn(`[Gemini] "${label}" failed (${purpose}):`, e.message);
            if (i < items.length - 1) {
                console.log('[Gemini] Waiting 5 s before trying next key…');
                await new Promise(r => setTimeout(r, KEY_RETRY_DELAY_MS));
            }
        }
    }

    throw lastErr ?? new Error('No API keys available');
}

async function geminiFetch(key, model, payload, action = 'generateContent') {
    const r = await fetch(`${modelUrl(model, action)}?key=${key}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
    });
    if (!r.ok) {
        if (r.status === 429) {
            // Don't block the model here — withKeyFallback decides after all keys are tried
            throw new RateLimitError(model);
        }
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error?.message || `Gemini API Error ${r.status}`);
    }
    return r.json();
}

/**
 * Try models in order, skipping those blocked by rate limit.
 * Converts all RateLimitErrors into AllModelsRateLimitedError when exhausted.
 */
async function withModelFallback({ apiKey, purpose, primaryModel, fallbackModel, fn, shuffle = false }) {
    const candidates = [primaryModel];
    if (fallbackModel && fallbackModel !== primaryModel) candidates.push(fallbackModel);

    let lastErr;
    for (const model of candidates) {
        try {
            return await withKeyFallback(apiKey, `${purpose} [${model}]`, key => fn(key, model), model, shuffle);
        } catch (e) {
            lastErr = e;
            if (e instanceof RateLimitError) {
                console.warn(`[Gemini] ${purpose}: "${model}" — wszystkie klucze wyczerpane, próba kolejnego modelu…`);
                continue;
            }
            throw e;
        }
    }
    throw new AllModelsRateLimitedError(candidates);
}

function extractText(data, { softBlock = false } = {}) {
    const blockReason = data.promptFeedback?.blockReason;
    if (blockReason) {
        if (softBlock) return `_(Gemini zablokowała wiadomość — ${blockReason})_`;
        throw new Error(`Prompt blocked by Gemini: ${blockReason}`);
    }
    const candidate = data.candidates?.[0];
    const text      = candidate?.content?.parts?.[0]?.text;
    if (!text) {
        const reason = candidate?.finishReason ?? 'no candidates';
        throw new Error(`Empty response from Gemini (${reason})`);
    }
    return text;
}

/** Repair truncated JSON from memory extraction responses. */
export function parseMemoryJson(text) {
    const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
    const match    = stripped.match(/\{[\s\S]*\}/);
    if (!match) {
        console.warn('[Gemini/Memory] No JSON in response.');
        return {};
    }
    try {
        return JSON.parse(match[0]);
    } catch {
        let s = match[0];
        s = s.replace(/,?\s*"[^"]*$/, '');
        s = s.replace(/,\s*$/, '');
        const opens = (s.match(/\[/g) || []).length - (s.match(/\]/g) || []).length;
        const objs  = (s.match(/\{/g) || []).length - (s.match(/\}/g) || []).length;
        for (let i = 0; i < opens; i++) s += ']';
        for (let i = 0; i < objs;  i++) s += '}';
        try { return JSON.parse(s); }
        catch {
            console.warn('[Gemini/Memory] JSON repair failed.');
            return {};
        }
    }
}

// ============ CHAT ============

export async function callGeminiAPI({
    apiKey, messages, systemPrompt, chatSummary,
    temperature, maxTokens, contextTokens,
    chatModel, chatModelFallback,
}) {
    return withModelFallback({
        apiKey,
        purpose:      'Chat response',
        primaryModel:  chatModel || GEMINI_MODELS.CHAT_PRIMARY,
        fallbackModel: chatModelFallback ?? (chatModel ? null : GEMINI_MODELS.CHAT_FALLBACK),
        fn: (key, model) => _callGeminiChatOnce({
            apiKey: key, model, messages, systemPrompt, chatSummary,
            temperature, maxTokens, contextTokens,
        }),
    });
}

async function _callGeminiChatOnce({ apiKey, model, messages, systemPrompt, chatSummary, temperature, maxTokens, contextTokens }) {
    const fullSystemPrompt = buildChatSystemPrompt(systemPrompt, chatSummary);
    const recentMessages   = selectChatMessages(messages, chatSummary, contextTokens);
    const contents         = buildChatContents(recentMessages);

    const payload = {
        contents,
        systemInstruction: { parts: [{ text: fullSystemPrompt }] },
        generationConfig:  { temperature, maxOutputTokens: maxTokens, topP: 0.95, topK: 40 },
        safetySettings:    SAFETY_NONE,
    };

    if (window.DEBUG_PROMPTS) {
        console.groupCollapsed(`[Prompt] Chat response [${model}]`);
        console.log('System:', fullSystemPrompt);
        console.log('Messages (%d):', contents.length, contents.map(m => `${m.role}: ${m.parts[0].text.substring(0, 80)}`));
        console.groupEnd();
    }

    const data = await geminiFetch(apiKey, model, payload);
    return extractText(data, { softBlock: true });
}

// ============ MEMORY ============

/**
 * @param {'normal'|'batch'} priority
 *   normal — 3 Flash primary, 3.1 Lite on failure
 *   batch  — 3.1 Lite only (low priority / background)
 */
export async function callGeminiForMemory({ prompt, apiKey, maxOutputTokens = 8192, priority = 'normal', memoryModel, memoryModelFallback }) {
    const run = async (key, model) => {
        if (window.DEBUG_PROMPTS) {
            console.groupCollapsed(`[Prompt] Memory extraction [${model}]`);
            console.log(prompt);
            console.groupEnd();
        }

        const data = await geminiFetch(key, model, {
            contents:         [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                temperature:      0.1,
                maxOutputTokens,
                responseMimeType: 'application/json',
                thinkingConfig:   { thinkingBudget: 0 },
            },
        });

        if (data.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
            console.warn(`[Gemini/Memory] Response hit MAX_TOKENS [${model}] — attempting JSON repair.`);
        }

        return parseMemoryJson(extractText(data));
    };

    if (priority === 'batch') {
        const batchModel = memoryModel || GEMINI_MODELS.MEMORY_FALLBACK;
        return singleModelCall(batchModel, apiKey, key => run(key, batchModel));
    }

    return withModelFallback({
        apiKey,
        purpose:       'Memory extraction',
        primaryModel:  memoryModel || GEMINI_MODELS.MEMORY_PRIMARY,
        fallbackModel: memoryModelFallback ?? (memoryModel ? null : GEMINI_MODELS.MEMORY_FALLBACK),
        fn: run,
    });
}

// ============ SUMMARY ============

export async function callGeminiForSummary({ apiKey, prompt, maxOutputTokens = 8192, summaryModel, summaryModelFallback }) {
    const primaryModel  = summaryModel || GEMINI_MODELS.SUMMARY;
    const fallbackModel = summaryModelFallback ?? (summaryModel ? null : GEMINI_MODELS.SUMMARY_FALLBACK);

    const run = (key, model) => {
        if (window.DEBUG_PROMPTS) {
            console.groupCollapsed(`[Prompt] Summary [${model}]`);
            console.log(prompt);
            console.groupEnd();
        }
        return geminiFetch(key, model, {
            contents:         [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens, topP: 0.95 },
            safetySettings:   SAFETY_NONE,
        }).then(data => extractText(data));
    };

    return withModelFallback({
        apiKey,
        purpose:       'Summary',
        primaryModel,
        fallbackModel,
        fn:            run,
        shuffle:       true,
    });
}

// ============ EMBEDDINGS ============

/**
 * Embed a single text string with Gemini Embedding 2.
 * @returns {number[]} embedding vector
 */
export async function embedText({ apiKey, text, outputDimensionality = 768, embedModel }) {
    const model = embedModel || GEMINI_MODELS.EMBEDDING;
    return singleModelCall(model, apiKey, (key) =>
        geminiFetch(key, model, {
            content:              { parts: [{ text }] },
            outputDimensionality: outputDimensionality,
        }, 'embedContent').then(data => {
            const values = data.embedding?.values;
            if (!values?.length) throw new Error('Empty embedding response from Gemini');
            return values;
        })
    );
}

/**
 * Embed multiple texts (one vector per text) via batchEmbedContents.
 * @returns {number[][]}
 */
export async function embedContents({ apiKey, texts, outputDimensionality = 768, embedModel }) {
    if (!texts?.length) return [];
    if (texts.length === 1) {
        return [await embedText({ apiKey, text: texts[0], outputDimensionality, embedModel })];
    }
    const model = embedModel || GEMINI_MODELS.EMBEDDING;
    return singleModelCall(model, apiKey, (key) =>
        geminiFetch(key, model, {
            requests: texts.map(text => ({
                model:                `models/${model}`,
                content:              { parts: [{ text }] },
                outputDimensionality: outputDimensionality,
            })),
        }, 'batchEmbedContents').then(data => {
            const embeddings = data.embeddings;
            if (!embeddings?.length) throw new Error('Empty embedding response from Gemini');
            return embeddings.map(e => e.values);
        })
    );
}
