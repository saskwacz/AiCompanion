/**
 * OpenAI provider for AiComp companion.
 *
 * API: https://api.openai.com/v1  (OpenAI-compatible)
 * Auth: Authorization: Bearer {key}
 */

import {
    buildChatSystemPrompt,
    selectChatMessages,
} from './openai-prompts.js';

import { OPENAI_MODELS } from './openai-models.js';
export { OPENAI_MODELS };

const API_BASE = 'https://api.openai.com/v1';

export class OpenAIRateLimitError extends Error {
    constructor(model) {
        super(`Limit API OpenAI (429) dla modelu "${model}"`);
        this.name  = 'OpenAIRateLimitError';
        this.model = model;
    }
}

export class OpenAIAllKeysExhaustedError extends Error {
    constructor(models) {
        super(`Limit API OpenAI wyczerpany — wszystkie klucze zablokowane dla: ${models.join(', ')}`);
        this.name   = 'OpenAIAllKeysExhaustedError';
        this.models = models;
    }
}

function isProhibited(err) {
    return /content_policy|content_filter|moderation|blocked/i.test(err?.message ?? '');
}

function keyItems(apiKey) {
    const items = Array.isArray(apiKey) ? [...apiKey] : [apiKey];
    if (!items.length) throw new Error('No OpenAI API key provided');
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

async function openaiFetch(endpoint, key, payload) {
    const r = await fetch(`${API_BASE}${endpoint}`, {
        method:  'POST',
        headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify(payload),
    });

    if (!r.ok) {
        if (r.status === 429) throw new OpenAIRateLimitError(payload.model ?? '?');
        const err = await r.json().catch(() => ({}));
        const msg = err.error?.message || err.message || `OpenAI API Error ${r.status}`;
        throw new Error(msg);
    }
    return r.json();
}

async function withKeyFallback(apiKey, purpose, fn) {
    const items = keyItems(apiKey);
    let lastErr = null;

    for (let i = 0; i < items.length; i++) {
        const key   = plainKey(items[i]);
        const label = keyLabel(items[i]);
        console.log(`[OpenAI] ${purpose} → key: "${label}"`);
        try {
            return await fn(key);
        } catch (e) {
            lastErr = e;
            if (e instanceof OpenAIRateLimitError) {
                console.warn(`[OpenAI] "${label}" 429 — rotating key…`);
                continue;
            }
            if (isProhibited(e)) {
                console.warn(`[OpenAI] "${label}" content policy block — not retrying.`);
                throw e;
            }
            console.warn(`[OpenAI] "${label}" failed (${purpose}):`, e.message);
            if (i < items.length - 1) {
                await new Promise(r => setTimeout(r, 3000));
            }
        }
    }
    throw lastErr ?? new Error('No OpenAI API keys available');
}

async function withModelFallback({ apiKey, purpose, primaryModel, fallbackModel, fn }) {
    const candidates = [primaryModel];
    if (fallbackModel && fallbackModel !== primaryModel) candidates.push(fallbackModel);

    let lastErr;
    for (const model of candidates) {
        try {
            return await withKeyFallback(apiKey, `${purpose} [${model}]`, key => fn(key, model));
        } catch (e) {
            lastErr = e;
            if (e instanceof OpenAIRateLimitError) {
                console.warn(`[OpenAI] ${purpose}: all keys exhausted for "${model}", trying fallback…`);
                continue;
            }
            throw e;
        }
    }
    throw new OpenAIAllKeysExhaustedError(candidates);
}

function extractText(data) {
    const text = data.choices?.[0]?.message?.content;
    if (!text) {
        const reason = data.choices?.[0]?.finish_reason ?? 'no choices';
        throw new Error(`Empty response from OpenAI (${reason})`);
    }
    return text;
}

export function parseMemoryJson(text) {
    const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
    const match    = stripped.match(/\{[\s\S]*\}/);
    if (!match) { console.warn('[OpenAI/Memory] No JSON in response.'); return {}; }
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
        catch { console.warn('[OpenAI/Memory] JSON repair failed.'); return {}; }
    }
}

// ============ CHAT ============

export async function callOpenAIAPI({
    apiKey, messages, systemPrompt, chatSummary,
    temperature, maxTokens, contextTokens,
    chatModel, chatModelFallback,
}) {
    return withModelFallback({
        apiKey,
        purpose:       'Chat',
        primaryModel:  chatModel  || OPENAI_MODELS.CHAT_PRIMARY,
        fallbackModel: chatModelFallback ?? (chatModel ? null : OPENAI_MODELS.CHAT_FALLBACK),
        fn: (key, model) => _callOpenAIChatOnce({
            key, model, messages, systemPrompt, chatSummary,
            temperature, maxTokens, contextTokens,
        }),
    });
}

async function _callOpenAIChatOnce({ key, model, messages, systemPrompt, chatSummary, temperature, maxTokens, contextTokens }) {
    const fullSystem = buildChatSystemPrompt(systemPrompt, chatSummary);
    const recent     = selectChatMessages(messages, chatSummary, contextTokens);

    const msgs = [
        { role: 'system', content: fullSystem },
        ...recent.map(m => ({ role: m.role, content: m.content })),
    ];

    if (window.DEBUG_PROMPTS) {
        console.groupCollapsed(`[Prompt] OpenAI Chat [${model}]`);
        console.log('System:', fullSystem.substring(0, 300));
        console.log('Messages (%d):', recent.length);
        console.groupEnd();
    }

    const data = await openaiFetch('/chat/completions', key, {
        model,
        messages:    msgs,
        temperature: temperature ?? 0.7,
        max_tokens:  maxTokens   ?? 8192,
    });

    return extractText(data);
}

// ============ MEMORY ============

export async function callOpenAIForMemory({ prompt, apiKey, maxOutputTokens = 8192, priority = 'normal', memoryModel, memoryModelFallback }) {
    const run = async (key, model) => {
        if (window.DEBUG_PROMPTS) {
            console.groupCollapsed(`[Prompt] OpenAI Memory [${model}]`);
            console.log(prompt);
            console.groupEnd();
        }
        const data = await openaiFetch('/chat/completions', key, {
            model,
            messages:        [{ role: 'user', content: prompt }],
            temperature:     0.1,
            max_tokens:      maxOutputTokens,
            response_format: { type: 'json_object' },
        });
        return parseMemoryJson(extractText(data));
    };

    if (priority === 'batch') {
        const model = memoryModel || OPENAI_MODELS.MEMORY_PRIMARY;
        return withKeyFallback(apiKey, `Memory batch [${model}]`, key => run(key, model));
    }

    return withModelFallback({
        apiKey,
        purpose:       'Memory',
        primaryModel:  memoryModel || OPENAI_MODELS.MEMORY_PRIMARY,
        fallbackModel: memoryModelFallback ?? (memoryModel ? null : OPENAI_MODELS.MEMORY_FALLBACK),
        fn: run,
    });
}

// ============ SUMMARY ============

export async function callOpenAIForSummary({ apiKey, prompt, maxOutputTokens = 8192, summaryModel, summaryModelFallback }) {
    const run = (key, model) => {
        if (window.DEBUG_PROMPTS) {
            console.groupCollapsed(`[Prompt] OpenAI Summary [${model}]`);
            console.log(prompt);
            console.groupEnd();
        }
        return openaiFetch('/chat/completions', key, {
            model,
            messages:    [{ role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens:  maxOutputTokens,
        }).then(extractText);
    };

    return withModelFallback({
        apiKey,
        purpose:       'Summary',
        primaryModel:  summaryModel || OPENAI_MODELS.SUMMARY,
        fallbackModel: summaryModelFallback ?? null,
        fn: run,
    });
}

// ============ EMBEDDINGS ============

export async function embedText({ apiKey, text, embedModel }) {
    const model = embedModel || OPENAI_MODELS.EMBEDDING;
    return withKeyFallback(apiKey, `Embed [${model}]`, async key => {
        const data = await openaiFetch('/embeddings', key, {
            model,
            input: text,
        });
        const values = data.data?.[0]?.embedding;
        if (!values?.length) throw new Error('Empty embedding response from OpenAI');
        return values;
    });
}

export async function embedContents({ apiKey, texts, embedModel }) {
    if (!texts?.length) return [];
    const model = embedModel || OPENAI_MODELS.EMBEDDING;
    return withKeyFallback(apiKey, `BatchEmbed [${model}]`, async key => {
        const data = await openaiFetch('/embeddings', key, {
            model,
            input: texts,
        });
        const embeddings = data.data;
        if (!embeddings?.length) throw new Error('Empty embedding response from OpenAI');
        return embeddings.map(e => e.embedding);
    });
}
