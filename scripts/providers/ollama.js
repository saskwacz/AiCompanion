/**
 * Ollama provider for AiComp companion.
 *
 * Model routing (defaults — override via OLLAMA_MODELS in settings):
 *   CHAT    — llama3.1:8b
 *   MEMORY  — qwen3:8b
 *   SUMMARY — phi3:mini
 *   EMBED   — jeffh/intfloat-multilingual-e5-small:q8_0
 *
 * All public functions mirror the Gemini provider interface exactly so
 * callers (memory.js, summary.js, main.js) can swap providers without
 * any changes to call sites.
 */

import {
    buildOllamaChatMessages,
    buildOllamaChatSystemPrompt,
    selectChatMessages,
} from './ollama-prompts.js';

import { OLLAMA_MODELS } from './ollama-models.js';
export { OLLAMA_MODELS };

// Re-export prompt helpers shared with the rest of the app
export { selectChatMessages };

// ─── Low-level transport ───────────────────────────────────────────────────────

/**
 * Resolve the Ollama base URL.
 * Priority: explicit baseUrl arg → window.OLLAMA_BASE_URL → default localhost.
 */
function resolveBase(baseUrl) {
    return (baseUrl || window.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '');
}

/**
 * Core fetch wrapper for all Ollama endpoints.
 * Throws a descriptive Error on non-2xx or network failure.
 */
async function ollamaFetch(endpoint, payload, baseUrl) {
    const url = `${resolveBase(baseUrl)}${endpoint}`;
    let response;
    try {
        response = await fetch(url, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload),
        });
    } catch (networkErr) {
        throw new Error(`Ollama unreachable at ${resolveBase(baseUrl)} — is it running? (${networkErr.message})`);
    }
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Ollama HTTP ${response.status}: ${body || response.statusText}`);
    }
    return response.json();
}

// ─── Generation wrapper ────────────────────────────────────────────────────────

/**
 * Call /api/chat with the given messages array (OpenAI-style roles).
 * Returns the assistant's reply string.
 *
 * @param {object} opts
 * @param {string}   opts.model
 * @param {object[]} opts.messages   — [{ role, content }]
 * @param {string}  [opts.system]    — injected as a leading system message if provided
 * @param {number}  [opts.temperature]
 * @param {number}  [opts.maxTokens]
 * @param {boolean} [opts.json]      — request JSON output via format:'json'
 * @param {string}  [opts.baseUrl]
 */
async function ollamaChat({ model, messages, system, temperature = 0.7, maxTokens = 4096, json = false, baseUrl }) {
    const allMessages = system
        ? [{ role: 'system', content: system }, ...messages]
        : messages;

    const payload = {
        model,
        messages: allMessages,
        stream:   false,
        options: {
            temperature,
            num_predict: maxTokens,
            top_p:       0.95,
            top_k:       40,
        },
        ...(json ? { format: 'json' } : {}),
    };

    if (window.DEBUG_PROMPTS) {
        console.groupCollapsed(`[Ollama] chat → ${model}`);
        console.log('system:', system?.substring(0, 200));
        console.log('messages:', allMessages.map(m => `${m.role}: ${String(m.content).substring(0, 80)}`));
        console.groupEnd();
    }

    const data = await ollamaFetch('/api/chat', payload, baseUrl);

    const text = data.message?.content;
    if (!text) throw new Error(`Empty response from Ollama model "${model}"`);
    return text;
}

/**
 * Call /api/embeddings and return the embedding vector.
 *
 * @param {string}   model
 * @param {string}   text
 * @param {string}  [baseUrl]
 * @returns {number[]}
 */
async function ollamaEmbed(model, text, baseUrl) {
    const data = await ollamaFetch('/api/embeddings', { model, prompt: text }, baseUrl);
    const vec = data.embedding;
    if (!vec?.length) throw new Error(`Empty embedding from Ollama model "${model}"`);
    return vec;
}

// ─── JSON repair (shared with Gemini provider) ─────────────────────────────────

/**
 * Extract and repair a JSON object from a raw model response string.
 * Models sometimes wrap JSON in markdown fences or truncate it.
 */
export function parseMemoryJson(text) {
    // Strip thinking tags that some models (qwen3) emit
    const noThink = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const stripped = noThink.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
    const match    = stripped.match(/\{[\s\S]*\}/);
    if (!match) {
        console.warn('[Ollama/Memory] No JSON object found in response.');
        return {};
    }
    try {
        return JSON.parse(match[0]);
    } catch {
        // Attempt to close unclosed arrays / objects (truncated output)
        let s = match[0];
        s = s.replace(/,?\s*"[^"]*$/, '');   // remove trailing incomplete key
        s = s.replace(/,\s*$/, '');           // remove trailing comma
        const opens = (s.match(/\[/g) || []).length - (s.match(/\]/g) || []).length;
        const objs  = (s.match(/\{/g) || []).length - (s.match(/\}/g) || []).length;
        for (let i = 0; i < opens; i++) s += ']';
        for (let i = 0; i < objs;  i++) s += '}';
        try { return JSON.parse(s); }
        catch {
            console.warn('[Ollama/Memory] JSON repair failed, returning empty.');
            return {};
        }
    }
}

// ─── Model config helper ───────────────────────────────────────────────────────

/**
 * Merge default OLLAMA_MODELS with any per-call overrides supplied via providerConfig.
 * providerConfig.models may override individual roles, e.g.:
 *   { chat: 'llama3.2:3b', memory: 'qwen3:4b' }
 */
function resolveModels(overrides = {}) {
    return {
        chat:      overrides.chat      || OLLAMA_MODELS.CHAT,
        memory:    overrides.memory    || OLLAMA_MODELS.MEMORY,
        summary:   overrides.summary   || OLLAMA_MODELS.SUMMARY,
        embedding: overrides.embedding || OLLAMA_MODELS.EMBEDDING,
    };
}

// ─── Public API — mirrors Gemini provider interface exactly ────────────────────

/**
 * Generate a chat reply.
 * Signature mirrors callGeminiAPI().
 *
 * @param {object} opts
 * @param {object[]} opts.messages
 * @param {string}   opts.systemPrompt
 * @param {object}  [opts.chatSummary]
 * @param {number}  [opts.temperature]
 * @param {number}  [opts.maxTokens]
 * @param {number}  [opts.contextTokens]
 * @param {string}  [opts.baseUrl]        — Ollama base URL (falls back to window.OLLAMA_BASE_URL)
 * @param {object}  [opts.modelOverrides] — { chat, memory, summary, embedding }
 */
export async function callOllamaAPI({
    messages, systemPrompt, chatSummary,
    temperature = 0.7, maxTokens = 4096, contextTokens = 4000,
    baseUrl, modelOverrides = {},
}) {
    const models       = resolveModels(modelOverrides);
    const system       = buildOllamaChatSystemPrompt(systemPrompt, chatSummary);
    const recentMsgs   = selectChatMessages(messages, chatSummary, contextTokens);
    const chatMessages = buildOllamaChatMessages(recentMsgs);

    return ollamaChat({
        model: models.chat,
        messages: chatMessages,
        system,
        temperature,
        maxTokens,
        baseUrl,
    });
}

/**
 * Extract / update memory from a conversation exchange.
 * Signature mirrors callGeminiForMemory().
 *
 * @param {object} opts
 * @param {string}   opts.prompt
 * @param {number}  [opts.maxOutputTokens]
 * @param {string}  [opts.baseUrl]
 * @param {object}  [opts.modelOverrides]
 */
export async function callOllamaForMemory({
    prompt, maxOutputTokens = 4096, baseUrl, modelOverrides = {},
}) {
    const models = resolveModels(modelOverrides);

    if (window.DEBUG_PROMPTS) {
        console.groupCollapsed(`[Ollama] Memory extraction → ${models.memory}`);
        console.log(prompt);
        console.groupEnd();
    }

    const raw = await ollamaChat({
        model:       models.memory,
        messages:    [{ role: 'user', content: prompt }],
        temperature: 0.1,
        maxTokens:   maxOutputTokens,
        json:        true,      // request JSON mode — supported by qwen3 via format:'json'
        baseUrl,
    });

    return parseMemoryJson(raw);
}

/**
 * Generate a rolling conversation summary.
 * Signature mirrors callGeminiForSummary().
 *
 * @param {object} opts
 * @param {string}   opts.prompt
 * @param {number}  [opts.maxOutputTokens]
 * @param {string}  [opts.baseUrl]
 * @param {object}  [opts.modelOverrides]
 */
export async function callOllamaForSummary({
    prompt, maxOutputTokens = 2048, baseUrl, modelOverrides = {},
}) {
    const models = resolveModels(modelOverrides);

    if (window.DEBUG_PROMPTS) {
        console.groupCollapsed(`[Ollama] Summary → ${models.summary}`);
        console.log(prompt);
        console.groupEnd();
    }

    return ollamaChat({
        model:       models.summary,
        messages:    [{ role: 'user', content: prompt }],
        temperature: 0.3,
        maxTokens:   maxOutputTokens,
        baseUrl,
    });
}

/**
 * Embed a single text.
 * Signature mirrors embedText() from the Gemini provider.
 *
 * @param {object} opts
 * @param {string}   opts.text
 * @param {string}  [opts.baseUrl]
 * @param {object}  [opts.modelOverrides]
 * @returns {number[]}
 */
export async function embedText({ text, baseUrl, modelOverrides = {} }) {
    const models = resolveModels(modelOverrides);
    return ollamaEmbed(models.embedding, text, baseUrl);
}

/**
 * Embed multiple texts sequentially (Ollama has no native batch endpoint).
 * Signature mirrors embedContents() from the Gemini provider.
 *
 * @param {object} opts
 * @param {string[]} opts.texts
 * @param {string}  [opts.baseUrl]
 * @param {object}  [opts.modelOverrides]
 * @returns {number[][]}
 */
export async function embedContents({ texts, baseUrl, modelOverrides = {} }) {
    if (!texts?.length) return [];
    const models = resolveModels(modelOverrides);
    const results = [];
    for (const text of texts) {
        results.push(await ollamaEmbed(models.embedding, text, baseUrl));
    }
    return results;
}
