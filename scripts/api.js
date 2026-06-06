//const API_URL       = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';
const API_URL       = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent';
const TOKENS_PER_WORD = 1.3;

/** Try fn(plainKey) for each {label,key} item; log purpose+label; throw last error only if all fail.
 *  Waits 5 s between key attempts so rate-limit errors can recover. */
async function withKeyFallback(apiKey, purpose, fn) {
    const items = Array.isArray(apiKey) ? apiKey : [apiKey];
    if (!items.length) throw new Error('No API key provided');
    let lastErr;
    for (let i = 0; i < items.length; i++) {
        const item  = items[i];
        const key   = typeof item === 'string' ? item : item.key;
        const label = typeof item === 'string' ? `…${key.slice(-6)}` : (item.label || `…${key.slice(-6)}`);
        console.log(`[API] ${purpose} → key: "${label}"`);
        try { return await fn(key); }
        catch (e) {
            lastErr = e;
            console.warn(`[API] "${label}" failed (${purpose}):`, e.message);
            if (i < items.length - 1) {
                console.log(`[API] Waiting 5 s before trying next key…`);
                await new Promise(r => setTimeout(r, 5000));
            }
        }
    }
    throw lastErr;
}

// ============ MAIN CHAT ============
/**
 * Builds context from:
 *   1. chatSummary injected into system prompt (covers old history)
 *   2. Recent messages window (last RECENT_WINDOW messages, further trimmed by contextTokens)
 */
export async function callGeminiAPI({ apiKey, messages, systemPrompt, chatSummary, temperature, maxTokens, contextTokens }) {
    return withKeyFallback(apiKey, 'Chat response', async (key) => _callGeminiOnce({ apiKey: key, messages, systemPrompt, chatSummary, temperature, maxTokens, contextTokens }));
}

async function _callGeminiOnce({ apiKey, messages, systemPrompt, chatSummary, temperature, maxTokens, contextTokens }) {
    if (!apiKey) throw new Error('No API key provided');

    // Append rolling summary to system prompt when available
    let fullSystemPrompt = systemPrompt;
    if (chatSummary?.text) {
        fullSystemPrompt +=
            `\n\n[PREVIOUS CONVERSATION SUMMARY]\n` +
            `The following is a summary of everything that happened before the recent messages shown below. ` +
            `Use it as full context for the ongoing conversation:\n\n${chatSummary.text}`;
    }

    // Determine which messages to send verbatim
    // If a summary exists, only send messages after the summary's cutoff point;
    // otherwise fall back to token-based trimming.
    let recentMessages;
    if (chatSummary?.upToMessageCount != null) {
        recentMessages = messages.slice(chatSummary.upToMessageCount);
    } else {
        recentMessages = trimByTokens(messages, contextTokens);
    }

    // Gemini requires the first content entry to have role "user"
    while (recentMessages.length > 0 && recentMessages[0].role !== 'user') {
        recentMessages = recentMessages.slice(1);
    }

    const contents = recentMessages.map(m => ({
        role:  m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }],
    }));

    // Edge-case: no messages at all (e.g., summary covers everything) — send placeholder
    if (contents.length === 0) {
        contents.push({ role: 'user', parts: [{ text: '(continue the conversation)' }] });
    }

    const payload = {
        contents,
        systemInstruction: { parts: [{ text: fullSystemPrompt }] },
        generationConfig:  { temperature, maxOutputTokens: maxTokens, topP: 0.95, topK: 40 },
        safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
    };

    if (window.DEBUG_PROMPTS) {
        console.groupCollapsed('[Prompt] Chat response');
        console.log('System:', fullSystemPrompt);
        console.log('Messages (%d):', contents.length, contents.map(m => `${m.role}: ${m.parts[0].text.substring(0,80)}`));
        console.groupEnd();
    }

    const r = await fetch(`${API_URL}?key=${apiKey}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
    });

    if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error?.message || `API Error ${r.status}`);
    }

    const data = await r.json();
    if (data.promptFeedback?.blockReason) {
        // Content blocked — returning a visible note instead of crashing/retrying other keys
        return `_(Gemini zablokowała wiadomość — ${data.promptFeedback.blockReason})_`;
    }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty response from API');
    return text;
}

// ============ SUMMARY (manual, full-history) ============
export async function callGeminiForSummary({ apiKey, messages }) {
    return withKeyFallback(apiKey, 'Manual summary', async (key) => _callGeminiForSummaryOnce({ apiKey: key, messages }));
}

async function _callGeminiForSummaryOnce({ apiKey, messages }) {
    if (!apiKey) throw new Error('No API key provided');

    const conversation = messages
        .map(m => `${m.role === 'user' ? 'User' : 'Companion'}: ${m.content}`)
        .join('\n\n');

    const prompt = `Provide a detailed summary of this conversation (up to 20 000 tokens). Include:
1. Main topics discussed
2. Key decisions and outcomes
3. Companion personality traits revealed
4. User's needs and interests
5. Any unresolved questions or next steps

Conversation:
${conversation}`;

    const payload = {
        contents:         [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 20000, topP: 0.95 },
    };

    if (window.DEBUG_PROMPTS) {
        console.groupCollapsed('[Prompt] Manual summary');
        console.log(prompt);
        console.groupEnd();
    }

    const r = await fetch(`${API_URL}?key=${apiKey}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
    });

    if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error?.message || `API Error ${r.status}`);
    }

    const data = await r.json();
    if (data.promptFeedback?.blockReason) {
        throw new Error(`Summary prompt blocked by Gemini: ${data.promptFeedback.blockReason}`);
    }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty summary response');
    return text;
}

// ============ HELPERS ============
function trimByTokens(messages, maxContextTokens) {
    let count  = 0;
    const result = [];
    for (let i = messages.length - 1; i >= 0; i--) {
        const tokens = Math.ceil(messages[i].content.split(/\s+/).length * TOKENS_PER_WORD);
        if (count + tokens <= maxContextTokens) {
            result.unshift(messages[i]);
            count += tokens;
        } else break;
    }
    return result;
}
