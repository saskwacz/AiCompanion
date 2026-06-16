/**
 * Mistral provider for AiComp companion.
 *
 * API: https://api.mistral.ai/v1  (OpenAI-compatible)
 * Auth: Authorization: Bearer {key}
 *
 * Model routing (defaults):
 *   CHAT    — mistral-large-latest  (fallback: mistral-small-latest)
 *   MEMORY  — mistral-small-latest  (fallback: open-mistral-7b)
 *   SUMMARY — mistral-small-latest
 *   EMBED   — mistral-embed
 *
 * All public functions mirror the Gemini provider interface exactly.
 */

import {
    buildChatSystemPrompt,
    selectChatMessages,
} from './mistral-prompts.js';

import { MISTRAL_MODELS } from './mistral-models.js';
export { MISTRAL_MODELS };

const API_BASE = 'https://api.mistral.ai/v1';

// ─── Error helpers ─────────────────────────────────────────────────────────────

export class MistralRateLimitError extends Error {
    constructor(model) {
        super(`Limit API Mistral (429) dla modelu "${model}"`);
        this.name  = 'MistralRateLimitError';
        this.model = model;
    }
}

export class MistralAllKeysExhaustedError extends Error {
    constructor(models) {
        super(`Limit API Mistral wyczerpany — wszystkie klucze zablokowane dla modelu(i): ${models.join(', ')}`);
        this.name   = 'MistralAllKeysExhaustedError';
        this.models = models;
    }
}

/** Returns true when the error looks like a content-policy block. */
function isProhibited(err) {
    return /PROHIBITED|blocked|SAFETY|content_policy|moderation/i.test(err?.message ?? '');
}

// ─── Key rotation ──────────────────────────────────────────────────────────────

function keyItems(apiKey) {
    const items = Array.isArray(apiKey) ? [...apiKey] : [apiKey];
    if (!items.length) throw new Error('No Mistral API key provided');
    // Shuffle (Fisher-Yates) so each call starts from a different position
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
}

function keyLabel(item) {
    if (typeof item === 'string') return `…${item.slice(-6)}`;
    return item.label || `…${String(item.key).slice(-6)}`;
}

function plainKey(item) {
    return typeof item === 'string' ? item : item.key;
}

// ─── Low-level transport ───────────────────────────────────────────────────────

async function mistralFetch(endpoint, key, payload) {
    const r = await fetch(`${API_BASE}${endpoint}`, {
        method:  'POST',
        headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify(payload),
    });

    if (!r.ok) {
        if (r.status === 429) throw new MistralRateLimitError(payload.model ?? '?');
        const err = await r.json().catch(() => ({}));
        const msg = err.message || err.error?.message || `Mistral API Error ${r.status}`;
        throw new Error(msg);
    }
    return r.json();
}

/**
 * Try fn(plainKey) for each key in the pool; rotate on rate-limit, stop on
 * other errors (content policy errors are propagated immediately).
 */
async function withKeyFallback(apiKey, purpose, fn) {
    const items   = keyItems(apiKey);
    let lastErr   = null;

    for (let i = 0; i < items.length; i++) {
        const key   = plainKey(items[i]);
        const label = keyLabel(items[i]);
        console.log(`[Mistral] ${purpose} → key: "${label}"`);
        try {
            return await fn(key);
        } catch (e) {
            lastErr = e;
            if (e instanceof MistralRateLimitError) {
                console.warn(`[Mistral] "${label}" 429 — rotating key…`);
                continue;
            }
            if (isProhibited(e)) {
                console.warn(`[Mistral] "${label}" content policy block — not retrying.`);
                throw e;
            }
            console.warn(`[Mistral] "${label}" failed (${purpose}):`, e.message);
            if (i < items.length - 1) {
                await new Promise(r => setTimeout(r, 3000));
            }
        }
    }
    throw lastErr ?? new Error('No Mistral API keys available');
}

/**
 * Try primary model, then fallback model on rate-limit exhaustion.
 */
async function withModelFallback({ apiKey, purpose, primaryModel, fallbackModel, fn }) {
    const candidates = [primaryModel];
    if (fallbackModel && fallbackModel !== primaryModel) candidates.push(fallbackModel);

    let lastErr;
    for (const model of candidates) {
        try {
            return await withKeyFallback(apiKey, `${purpose} [${model}]`, key => fn(key, model));
        } catch (e) {
            lastErr = e;
            if (e instanceof MistralRateLimitError) {
                console.warn(`[Mistral] ${purpose}: all keys exhausted for "${model}", trying next model…`);
                continue;
            }
            throw e;
        }
    }
    throw new MistralAllKeysExhaustedError(candidates);
}

function extractText(data) {
    const text = data.choices?.[0]?.message?.content;
    if (!text) {
        const reason = data.choices?.[0]?.finish_reason ?? 'no choices';
        throw new Error(`Empty response from Mistral (${reason})`);
    }
    return text;
}

// ─── Memory JSON repair (mirrors Gemini implementation) ───────────────────────

export function parseMemoryJson(text) {
    const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
    const match    = stripped.match(/\{[\s\S]*\}/);
    if (!match) { console.warn('[Mistral/Memory] No JSON in response.'); return {}; }
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
        catch { console.warn('[Mistral/Memory] JSON repair failed.'); return {}; }
    }
}

// ============ CHAT ============

export async function callMistralAPI({
    apiKey, messages, systemPrompt, chatSummary,
    temperature, maxTokens, contextTokens,
    chatModel, chatModelFallback,
}) {
    return withModelFallback({
        apiKey,
        purpose:       'Chat',
        primaryModel:  chatModel  || MISTRAL_MODELS.CHAT_PRIMARY,
        fallbackModel: chatModelFallback ?? (chatModel ? null : MISTRAL_MODELS.CHAT_FALLBACK),
        fn: (key, model) => _callMistralChatOnce({
            key, model, messages, systemPrompt, chatSummary,
            temperature, maxTokens, contextTokens,
        }),
    });
}

async function _callMistralChatOnce({ key, model, messages, systemPrompt, chatSummary, temperature, maxTokens, contextTokens }) {
    const fullSystem = buildChatSystemPrompt(systemPrompt, chatSummary);
    const recent     = selectChatMessages(messages, chatSummary, contextTokens);

    // OpenAI-style messages array
    const msgs = [
        { role: 'system', content: fullSystem },
        ...recent.map(m => ({ role: m.role, content: m.content })),
    ];

    if (window.DEBUG_PROMPTS) {
        console.groupCollapsed(`[Prompt] Mistral Chat [${model}]`);
        console.log('System:', fullSystem.substring(0, 300));
        console.log('Messages (%d):', recent.length);
        console.groupEnd();
    }

    const data = await mistralFetch('/chat/completions', key, {
        model,
        messages:    msgs,
        temperature: temperature ?? 0.7,
        max_tokens:  maxTokens   ?? 8192,
        safe_prompt: false,
    });

    return extractText(data);
}

// ============ MEMORY ============

export async function callMistralForMemory({ prompt, apiKey, maxOutputTokens = 8192, priority = 'normal', memoryModel, memoryModelFallback }) {
    const run = async (key, model) => {
        if (window.DEBUG_PROMPTS) {
            console.groupCollapsed(`[Prompt] Mistral Memory [${model}]`);
            console.log(prompt);
            console.groupEnd();
        }
        const data = await mistralFetch('/chat/completions', key, {
            model,
            messages:        [{ role: 'user', content: prompt }],
            temperature:     0.1,
            max_tokens:      maxOutputTokens,
            response_format: { type: 'json_object' },
            safe_prompt:     false,
        });
        return parseMemoryJson(extractText(data));
    };

    if (priority === 'batch') {
        const model = memoryModel || MISTRAL_MODELS.MEMORY_PRIMARY;
        return withKeyFallback(apiKey, `Memory batch [${model}]`, key => run(key, model));
    }

    return withModelFallback({
        apiKey,
        purpose:       'Memory',
        primaryModel:  memoryModel || MISTRAL_MODELS.MEMORY_PRIMARY,
        fallbackModel: memoryModelFallback ?? (memoryModel ? null : MISTRAL_MODELS.MEMORY_FALLBACK),
        fn: run,
    });
}

// ============ SUMMARY ============

export async function callMistralForSummary({ apiKey, prompt, maxOutputTokens = 8192, summaryModel, summaryModelFallback }) {
    const run = (key, model) => {
        if (window.DEBUG_PROMPTS) {
            console.groupCollapsed(`[Prompt] Mistral Summary [${model}]`);
            console.log(prompt);
            console.groupEnd();
        }
        return mistralFetch('/chat/completions', key, {
            model,
            messages:    [{ role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens:  maxOutputTokens,
            safe_prompt: false,
        }).then(extractText);
    };

    return withModelFallback({
        apiKey,
        purpose:       'Summary',
        primaryModel:  summaryModel || MISTRAL_MODELS.SUMMARY,
        fallbackModel: summaryModelFallback ?? null,
        fn: run,
    });
}

// ============ EMBEDDINGS ============

export async function embedText({ apiKey, text, embedModel }) {
    const model = embedModel || MISTRAL_MODELS.EMBEDDING;
    return withKeyFallback(apiKey, `Embed [${model}]`, async key => {
        const data = await mistralFetch('/embeddings', key, {
            model,
            input: [text],
        });
        const values = data.data?.[0]?.embedding;
        if (!values?.length) throw new Error('Empty embedding response from Mistral');
        return values;
    });
}

export async function embedContents({ apiKey, texts, embedModel }) {
    if (!texts?.length) return [];
    const model = embedModel || MISTRAL_MODELS.EMBEDDING;
    return withKeyFallback(apiKey, `BatchEmbed [${model}]`, async key => {
        const data = await mistralFetch('/embeddings', key, {
            model,
            input: texts,
        });
        const embeddings = data.data;
        if (!embeddings?.length) throw new Error('Empty embedding response from Mistral');
        return embeddings.map(e => e.embedding);
    });
}
