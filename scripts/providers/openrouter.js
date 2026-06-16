/**
 * OpenRouter provider for AiComp companion.
 *
 * API: https://openrouter.ai/api/v1  (OpenAI-compatible)
 * Auth: Authorization: Bearer {key}
 * Docs: https://openrouter.ai/docs
 *
 * ⚠️  OpenRouter does NOT support embeddings.
 *     The embed task must use another provider (Gemini or Ollama).
 *
 * Model routing (defaults):
 *   CHAT    — anthropic/claude-sonnet-4-5  (fallback: meta-llama/llama-3.3-70b-instruct)
 *   MEMORY  — meta-llama/llama-3.1-8b-instruct  (fallback: google/gemini-flash-1.5)
 *   SUMMARY — meta-llama/llama-3.1-8b-instruct
 */

import {
    buildChatSystemPrompt,
    selectChatMessages,
} from './openrouter-prompts.js';

import { OPENROUTER_MODELS } from './openrouter-models.js';
export { OPENROUTER_MODELS };

const API_BASE   = 'https://openrouter.ai/api/v1';
const APP_TITLE  = 'AiComp';
const APP_REFERER = typeof window !== 'undefined' ? window.location.origin : 'https://aicomp.app';

// ─── Error helpers ─────────────────────────────────────────────────────────────

export class OpenRouterRateLimitError extends Error {
    constructor(model) {
        super(`Limit API OpenRouter (429) dla modelu "${model}"`);
        this.name  = 'OpenRouterRateLimitError';
        this.model = model;
    }
}

export class OpenRouterAllKeysExhaustedError extends Error {
    constructor(models) {
        super(`Limit API OpenRouter wyczerpany — wszystkie klucze zablokowane dla: ${models.join(', ')}`);
        this.name   = 'OpenRouterAllKeysExhaustedError';
        this.models = models;
    }
}

function isProhibited(err) {
    return /content_policy|content_filter|moderation|blocked|SAFETY/i.test(err?.message ?? '');
}

// ─── Key rotation ──────────────────────────────────────────────────────────────

function keyItems(apiKey) {
    const items = Array.isArray(apiKey) ? [...apiKey] : [apiKey];
    if (!items.length) throw new Error('No OpenRouter API key provided');
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

async function orFetch(endpoint, key, payload) {
    const r = await fetch(`${API_BASE}${endpoint}`, {
        method:  'POST',
        headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${key}`,
            'HTTP-Referer':  APP_REFERER,
            'X-Title':       APP_TITLE,
        },
        body: JSON.stringify(payload),
    });

    if (!r.ok) {
        if (r.status === 429) throw new OpenRouterRateLimitError(payload.model ?? '?');
        const err = await r.json().catch(() => ({}));
        const msg = err.error?.message || err.message || `OpenRouter API Error ${r.status}`;
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
        console.log(`[OpenRouter] ${purpose} → key: "${label}"`);
        try {
            return await fn(key);
        } catch (e) {
            lastErr = e;
            if (e instanceof OpenRouterRateLimitError) {
                console.warn(`[OpenRouter] "${label}" 429 — rotating key…`);
                continue;
            }
            if (isProhibited(e)) {
                console.warn(`[OpenRouter] "${label}" content policy block — not retrying.`);
                throw e;
            }
            console.warn(`[OpenRouter] "${label}" failed (${purpose}):`, e.message);
            if (i < items.length - 1) {
                await new Promise(r => setTimeout(r, 3000));
            }
        }
    }
    throw lastErr ?? new Error('No OpenRouter API keys available');
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
            if (e instanceof OpenRouterRateLimitError) {
                console.warn(`[OpenRouter] ${purpose}: all keys exhausted for "${model}", trying fallback…`);
                continue;
            }
            throw e;
        }
    }
    throw new OpenRouterAllKeysExhaustedError(candidates);
}

function extractText(data) {
    const text = data.choices?.[0]?.message?.content;
    if (!text) {
        const reason = data.choices?.[0]?.finish_reason ?? 'no choices';
        throw new Error(`Empty response from OpenRouter (${reason})`);
    }
    return text;
}

// ─── Memory JSON repair ────────────────────────────────────────────────────────

export function parseMemoryJson(text) {
    const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
    const match    = stripped.match(/\{[\s\S]*\}/);
    if (!match) { console.warn('[OpenRouter/Memory] No JSON in response.'); return {}; }
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
        catch { console.warn('[OpenRouter/Memory] JSON repair failed.'); return {}; }
    }
}

// ============ CHAT ============

export async function callOpenRouterAPI({
    apiKey, messages, systemPrompt, chatSummary,
    temperature, maxTokens, contextTokens,
    chatModel, chatModelFallback,
}) {
    return withModelFallback({
        apiKey,
        purpose:       'Chat',
        primaryModel:  chatModel  || OPENROUTER_MODELS.CHAT_PRIMARY,
        fallbackModel: chatModelFallback ?? (chatModel ? null : OPENROUTER_MODELS.CHAT_FALLBACK),
        fn: (key, model) => _callOpenRouterChatOnce({
            key, model, messages, systemPrompt, chatSummary,
            temperature, maxTokens, contextTokens,
        }),
    });
}

async function _callOpenRouterChatOnce({ key, model, messages, systemPrompt, chatSummary, temperature, maxTokens, contextTokens }) {
    const fullSystem = buildChatSystemPrompt(systemPrompt, chatSummary);
    const recent     = selectChatMessages(messages, chatSummary, contextTokens);

    const msgs = [
        { role: 'system', content: fullSystem },
        ...recent.map(m => ({ role: m.role, content: m.content })),
    ];

    if (window.DEBUG_PROMPTS) {
        console.groupCollapsed(`[Prompt] OpenRouter Chat [${model}]`);
        console.log('System:', fullSystem.substring(0, 300));
        console.log('Messages (%d):', recent.length);
        console.groupEnd();
    }

    const data = await orFetch('/chat/completions', key, {
        model,
        messages:    msgs,
        temperature: temperature ?? 0.7,
        max_tokens:  maxTokens   ?? 8192,
    });

    return extractText(data);
}

// ============ MEMORY ============

export async function callOpenRouterForMemory({ prompt, apiKey, maxOutputTokens = 8192, priority = 'normal', memoryModel, memoryModelFallback }) {
    const run = async (key, model) => {
        if (window.DEBUG_PROMPTS) {
            console.groupCollapsed(`[Prompt] OpenRouter Memory [${model}]`);
            console.log(prompt);
            console.groupEnd();
        }
        // Not all OpenRouter models support response_format — send as plain text and parse
        const data = await orFetch('/chat/completions', key, {
            model,
            messages:    [{ role: 'user', content: prompt }],
            temperature: 0.1,
            max_tokens:  maxOutputTokens,
        });
        return parseMemoryJson(extractText(data));
    };

    if (priority === 'batch') {
        const model = memoryModel || OPENROUTER_MODELS.MEMORY_PRIMARY;
        return withKeyFallback(apiKey, `Memory batch [${model}]`, key => run(key, model));
    }

    return withModelFallback({
        apiKey,
        purpose:       'Memory',
        primaryModel:  memoryModel || OPENROUTER_MODELS.MEMORY_PRIMARY,
        fallbackModel: memoryModelFallback ?? (memoryModel ? null : OPENROUTER_MODELS.MEMORY_FALLBACK),
        fn: run,
    });
}

// ============ SUMMARY ============

export async function callOpenRouterForSummary({ apiKey, prompt, maxOutputTokens = 8192, summaryModel, summaryModelFallback }) {
    const run = (key, model) => {
        if (window.DEBUG_PROMPTS) {
            console.groupCollapsed(`[Prompt] OpenRouter Summary [${model}]`);
            console.log(prompt);
            console.groupEnd();
        }
        return orFetch('/chat/completions', key, {
            model,
            messages:    [{ role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens:  maxOutputTokens,
        }).then(extractText);
    };

    return withModelFallback({
        apiKey,
        purpose:       'Summary',
        primaryModel:  summaryModel || OPENROUTER_MODELS.SUMMARY,
        fallbackModel: summaryModelFallback ?? null,
        fn: run,
    });
}

// ============ EMBEDDINGS — NOT SUPPORTED ============

export function embedText() {
    return Promise.reject(new Error('OpenRouter nie obsługuje embeddings. Zmień dostawcę dla zadania Embed na Gemini lub Ollama.'));
}

export function embedContents() {
    return Promise.reject(new Error('OpenRouter nie obsługuje embeddings. Zmień dostawcę dla zadania Embed na Gemini lub Ollama.'));
}
