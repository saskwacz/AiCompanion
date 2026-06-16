/**
 * Claude (Anthropic) provider for AiComp companion.
 *
 * API: https://api.anthropic.com/v1/messages
 * Auth: x-api-key header
 * Docs: https://docs.anthropic.com/en/api/messages
 *
 * ⚠️  Claude does NOT support embeddings.
 */

import {
    buildChatSystemPrompt,
    selectChatMessages,
} from './claude-prompts.js';

import { CLAUDE_MODELS } from './claude-models.js';
export { CLAUDE_MODELS };

const API_BASE       = 'https://api.anthropic.com/v1';
const ANTHROPIC_VER  = '2023-06-01';

export class ClaudeRateLimitError extends Error {
    constructor(model) {
        super(`Limit API Claude (429) dla modelu "${model}"`);
        this.name  = 'ClaudeRateLimitError';
        this.model = model;
    }
}

export class ClaudeAllKeysExhaustedError extends Error {
    constructor(models) {
        super(`Limit API Claude wyczerpany — wszystkie klucze zablokowane dla: ${models.join(', ')}`);
        this.name   = 'ClaudeAllKeysExhaustedError';
        this.models = models;
    }
}

function isProhibited(err) {
    return /content_policy|content_filter|moderation|blocked|safety|refus/i.test(err?.message ?? '');
}

function keyItems(apiKey) {
    const items = Array.isArray(apiKey) ? [...apiKey] : [apiKey];
    if (!items.length) throw new Error('No Claude API key provided');
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

async function claudeFetch(endpoint, key, payload) {
    const r = await fetch(`${API_BASE}${endpoint}`, {
        method:  'POST',
        headers: {
            'Content-Type':      'application/json',
            'x-api-key':         key,
            'anthropic-version': ANTHROPIC_VER,
        },
        body: JSON.stringify(payload),
    });

    if (!r.ok) {
        if (r.status === 429) throw new ClaudeRateLimitError(payload.model ?? '?');
        const err = await r.json().catch(() => ({}));
        const msg = err.error?.message || err.message || `Claude API Error ${r.status}`;
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
        console.log(`[Claude] ${purpose} → key: "${label}"`);
        try {
            return await fn(key);
        } catch (e) {
            lastErr = e;
            if (e instanceof ClaudeRateLimitError) {
                console.warn(`[Claude] "${label}" 429 — rotating key…`);
                continue;
            }
            if (isProhibited(e)) {
                console.warn(`[Claude] "${label}" content policy block — not retrying.`);
                throw e;
            }
            console.warn(`[Claude] "${label}" failed (${purpose}):`, e.message);
            if (i < items.length - 1) {
                await new Promise(r => setTimeout(r, 3000));
            }
        }
    }
    throw lastErr ?? new Error('No Claude API keys available');
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
            if (e instanceof ClaudeRateLimitError) {
                console.warn(`[Claude] ${purpose}: all keys exhausted for "${model}", trying fallback…`);
                continue;
            }
            throw e;
        }
    }
    throw new ClaudeAllKeysExhaustedError(candidates);
}

/** Convert OpenAI-style messages to Anthropic format (alternating user/assistant). */
function toAnthropicMessages(messages) {
    const mapped = messages.map(m => ({
        role:    m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
    }));

    if (mapped.length && mapped[0].role === 'assistant') {
        mapped.unshift({ role: 'user', content: '(continue)' });
    }

    const merged = [];
    for (const m of mapped) {
        const last = merged[merged.length - 1];
        if (last && last.role === m.role) {
            last.content += '\n\n' + m.content;
        } else {
            merged.push({ ...m });
        }
    }
    return merged;
}

function extractText(data) {
    const block = data.content?.find(b => b.type === 'text');
    const text  = block?.text;
    if (!text) {
        const reason = data.stop_reason ?? 'no content';
        throw new Error(`Empty response from Claude (${reason})`);
    }
    return text;
}

export function parseMemoryJson(text) {
    const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
    const match    = stripped.match(/\{[\s\S]*\}/);
    if (!match) { console.warn('[Claude/Memory] No JSON in response.'); return {}; }
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
        catch { console.warn('[Claude/Memory] JSON repair failed.'); return {}; }
    }
}

// ============ CHAT ============

export async function callClaudeAPI({
    apiKey, messages, systemPrompt, chatSummary,
    temperature, maxTokens, contextTokens,
    chatModel, chatModelFallback,
}) {
    return withModelFallback({
        apiKey,
        purpose:       'Chat',
        primaryModel:  chatModel  || CLAUDE_MODELS.CHAT_PRIMARY,
        fallbackModel: chatModelFallback ?? (chatModel ? null : CLAUDE_MODELS.CHAT_FALLBACK),
        fn: (key, model) => _callClaudeChatOnce({
            key, model, messages, systemPrompt, chatSummary,
            temperature, maxTokens, contextTokens,
        }),
    });
}

async function _callClaudeChatOnce({ key, model, messages, systemPrompt, chatSummary, temperature, maxTokens, contextTokens }) {
    const fullSystem = buildChatSystemPrompt(systemPrompt, chatSummary);
    const recent     = selectChatMessages(messages, chatSummary, contextTokens);
    const msgs       = toAnthropicMessages(recent);

    if (window.DEBUG_PROMPTS) {
        console.groupCollapsed(`[Prompt] Claude Chat [${model}]`);
        console.log('System:', fullSystem.substring(0, 300));
        console.log('Messages (%d):', msgs.length);
        console.groupEnd();
    }

    const data = await claudeFetch('/messages', key, {
        model,
        system:      fullSystem,
        messages:    msgs,
        temperature: temperature ?? 0.7,
        max_tokens:  maxTokens   ?? 8192,
    });

    return extractText(data);
}

// ============ MEMORY ============

export async function callClaudeForMemory({ prompt, apiKey, maxOutputTokens = 8192, priority = 'normal', memoryModel, memoryModelFallback }) {
    const run = async (key, model) => {
        if (window.DEBUG_PROMPTS) {
            console.groupCollapsed(`[Prompt] Claude Memory [${model}]`);
            console.log(prompt);
            console.groupEnd();
        }
        const data = await claudeFetch('/messages', key, {
            model,
            messages:    [{ role: 'user', content: prompt }],
            temperature: 0.1,
            max_tokens:  maxOutputTokens,
        });
        return parseMemoryJson(extractText(data));
    };

    if (priority === 'batch') {
        const model = memoryModel || CLAUDE_MODELS.MEMORY_PRIMARY;
        return withKeyFallback(apiKey, `Memory batch [${model}]`, key => run(key, model));
    }

    return withModelFallback({
        apiKey,
        purpose:       'Memory',
        primaryModel:  memoryModel || CLAUDE_MODELS.MEMORY_PRIMARY,
        fallbackModel: memoryModelFallback ?? (memoryModel ? null : CLAUDE_MODELS.MEMORY_FALLBACK),
        fn: run,
    });
}

// ============ SUMMARY ============

export async function callClaudeForSummary({ apiKey, prompt, maxOutputTokens = 8192, summaryModel, summaryModelFallback }) {
    const run = (key, model) => {
        if (window.DEBUG_PROMPTS) {
            console.groupCollapsed(`[Prompt] Claude Summary [${model}]`);
            console.log(prompt);
            console.groupEnd();
        }
        return claudeFetch('/messages', key, {
            model,
            messages:    [{ role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens:  maxOutputTokens,
        }).then(extractText);
    };

    return withModelFallback({
        apiKey,
        purpose:       'Summary',
        primaryModel:  summaryModel || CLAUDE_MODELS.SUMMARY,
        fallbackModel: summaryModelFallback ?? null,
        fn: run,
    });
}

// ============ EMBEDDINGS — NOT SUPPORTED ============

export function embedText() {
    return Promise.reject(new Error('Claude nie obsługuje embeddings. Zmień dostawcę dla zadania Embed na Gemini, OpenAI, Mistral lub Ollama.'));
}

export function embedContents() {
    return Promise.reject(new Error('Claude nie obsługuje embeddings. Zmień dostawcę dla zadania Embed na Gemini, OpenAI, Mistral lub Ollama.'));
}
