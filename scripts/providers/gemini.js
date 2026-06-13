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

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const KEY_RETRY_DELAY_MS = 5000;

/** @readonly */
export const GEMINI_MODELS = {
    CHAT_PRIMARY:    'gemini-3.5-flash',
    CHAT_FALLBACK:   'gemini-3.1-flash-lite',
    MEMORY_PRIMARY:  'gemini-3-flash-preview',
    MEMORY_FALLBACK: 'gemini-3.1-flash-lite',
    SUMMARY:         'gemini-3.1-flash-lite',
    EMBEDDING:       'gemini-embedding-2',
};

const SAFETY_NONE = [
    { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
];

function modelUrl(model, action = 'generateContent') {
    return `${API_BASE}/${model}:${action}`;
}

function keyItems(apiKey) {
    const items = Array.isArray(apiKey) ? apiKey : [apiKey];
    if (!items.length) throw new Error('No Gemini API key provided');
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

/** Try fn(plainKey) for each key; wait between attempts on failure. */
async function withKeyFallback(apiKey, purpose, fn) {
    const items = keyItems(apiKey);
    let lastErr;
    for (let i = 0; i < items.length; i++) {
        const key   = plainKey(items[i]);
        const label = keyLabel(items[i]);
        console.log(`[Gemini] ${purpose} → key: "${label}"`);
        try { return await fn(key); }
        catch (e) {
            lastErr = e;
            console.warn(`[Gemini] "${label}" failed (${purpose}):`, e.message);
            if (i < items.length - 1) {
                console.log('[Gemini] Waiting 5 s before trying next key…');
                await new Promise(r => setTimeout(r, KEY_RETRY_DELAY_MS));
            }
        }
    }
    throw lastErr;
}

async function geminiFetch(key, model, payload, action = 'generateContent') {
    const r = await fetch(`${modelUrl(model, action)}?key=${key}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
    });
    if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error?.message || `Gemini API Error ${r.status}`);
    }
    return r.json();
}

/**
 * Try primaryModel across all keys; on total failure try fallbackModel (if provided).
 */
async function withModelFallback({ apiKey, purpose, primaryModel, fallbackModel, fn }) {
    try {
        return await withKeyFallback(apiKey, `${purpose} [${primaryModel}]`, key => fn(key, primaryModel));
    } catch (primaryErr) {
        if (!fallbackModel || fallbackModel === primaryModel) throw primaryErr;
        console.warn(`[Gemini] ${purpose}: ${primaryModel} failed — falling back to ${fallbackModel}`);
        return withKeyFallback(apiKey, `${purpose} [${fallbackModel}]`, key => fn(key, fallbackModel));
    }
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
}) {
    return withModelFallback({
        apiKey,
        purpose:     'Chat response',
        primaryModel:  GEMINI_MODELS.CHAT_PRIMARY,
        fallbackModel: GEMINI_MODELS.CHAT_FALLBACK,
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
export async function callGeminiForMemory({ prompt, apiKey, maxOutputTokens = 8192, priority = 'normal' }) {
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
        return withKeyFallback(apiKey, `Memory extraction [${GEMINI_MODELS.MEMORY_FALLBACK}]`,
            key => run(key, GEMINI_MODELS.MEMORY_FALLBACK));
    }

    return withModelFallback({
        apiKey,
        purpose:       'Memory extraction',
        primaryModel:  GEMINI_MODELS.MEMORY_PRIMARY,
        fallbackModel: GEMINI_MODELS.MEMORY_FALLBACK,
        fn: run,
    });
}

// ============ SUMMARY ============

export async function callGeminiForSummary({ apiKey, prompt, maxOutputTokens = 8192 }) {
    return withKeyFallback(apiKey, `Summary [${GEMINI_MODELS.SUMMARY}]`, async (key) => {
        if (window.DEBUG_PROMPTS) {
            console.groupCollapsed(`[Prompt] Summary [${GEMINI_MODELS.SUMMARY}]`);
            console.log(prompt);
            console.groupEnd();
        }

        const data = await geminiFetch(key, GEMINI_MODELS.SUMMARY, {
            contents:         [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens, topP: 0.95 },
        });

        return extractText(data);
    });
}

// ============ EMBEDDINGS ============

/**
 * Embed a single text string with Gemini Embedding 2.
 * @returns {number[]} embedding vector
 */
export async function embedText({ apiKey, text, outputDimensionality = 768 }) {
    return withKeyFallback(apiKey, `Embedding [${GEMINI_MODELS.EMBEDDING}]`, async (key) => {
        const data = await geminiFetch(key, GEMINI_MODELS.EMBEDDING, {
            content:              { parts: [{ text }] },
            outputDimensionality: outputDimensionality,
        }, 'embedContent');

        const values = data.embedding?.values;
        if (!values?.length) throw new Error('Empty embedding response from Gemini');
        return values;
    });
}

/**
 * Embed multiple texts (one vector per text) via batchEmbedContents.
 * @returns {number[][]}
 */
export async function embedContents({ apiKey, texts, outputDimensionality = 768 }) {
    if (!texts?.length) return [];
    if (texts.length === 1) {
        return [await embedText({ apiKey, text: texts[0], outputDimensionality })];
    }

    return withKeyFallback(apiKey, `Embedding [${GEMINI_MODELS.EMBEDDING}]`, async (key) => {
        const data = await geminiFetch(key, GEMINI_MODELS.EMBEDDING, {
            requests: texts.map(text => ({
                model:                `models/${GEMINI_MODELS.EMBEDDING}`,
                content:              { parts: [{ text }] },
                outputDimensionality: outputDimensionality,
            })),
        }, 'batchEmbedContents');

        const embeddings = data.embeddings;
        if (!embeddings?.length) throw new Error('Empty embedding response from Gemini');

        return embeddings.map(e => e.values);
    });
}