const GROQ_API_URL    = 'https://api.groq.com/openai/v1/chat/completions';
const TOKENS_PER_WORD = 1.3;

// ============ KEY FALLBACK ============
async function withGroqKeyFallback(apiKey, purpose, fn) {
    const items = Array.isArray(apiKey) ? apiKey : [apiKey];
    if (!items.length) throw new Error('No Groq API key provided');
    let lastErr;
    for (let i = 0; i < items.length; i++) {
        const item  = items[i];
        const key   = typeof item === 'string' ? item : item.key;
        const label = typeof item === 'string' ? `…${key.slice(-6)}` : (item.label || `…${key.slice(-6)}`);
        console.log(`[Groq] ${purpose} → key: "${label}"`);
        try { return await fn(key); }
        catch (e) {
            lastErr = e;
            console.warn(`[Groq] "${label}" failed (${purpose}):`, e.message);
            if (i < items.length - 1) {
                console.log('[Groq] Waiting 5 s before trying next key…');
                await new Promise(r => setTimeout(r, 5000));
            }
        }
    }
    throw lastErr;
}

// ============ HELPERS ============
function trimByTokens(messages, maxContextTokens) {
    let count = 0;
    const result = [];
    for (let i = messages.length - 1; i >= 0; i--) {
        const tokens = Math.ceil(messages[i].content.split(/\s+/).length * TOKENS_PER_WORD);
        if (count + tokens <= maxContextTokens) { result.unshift(messages[i]); count += tokens; }
        else break;
    }
    return result;
}

async function groqFetch(key, payload) {
    const r = await fetch(GROQ_API_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body:    JSON.stringify(payload),
    });
    if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error?.message || `Groq API Error ${r.status}`);
    }
    return r.json();
}

// ============ CHAT ============
export async function callGroqAPI({ apiKey, messages, systemPrompt, chatSummary, temperature, maxTokens, contextTokens, model = 'llama-3.3-70b-versatile' }) {
    return withGroqKeyFallback(apiKey, 'Chat response', async (key) => {
        let fullSystemPrompt = systemPrompt;
        if (chatSummary?.text) {
            fullSystemPrompt +=
                `\n\n[PREVIOUS CONVERSATION SUMMARY]\n` +
                `The following is a summary of everything that happened before the recent messages shown below. ` +
                `Use it as full context for the ongoing conversation:\n\n${chatSummary.text}`;
        }

        let recentMessages = chatSummary?.upToMessageCount != null
            ? messages.slice(chatSummary.upToMessageCount)
            : trimByTokens(messages, contextTokens);

        while (recentMessages.length > 0 && recentMessages[0].role !== 'user') {
            recentMessages = recentMessages.slice(1);
        }

        const groqMessages = [
            { role: 'system', content: fullSystemPrompt },
            ...recentMessages.map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content })),
        ];
        if (groqMessages.length === 1) {
            groqMessages.push({ role: 'user', content: '(continue the conversation)' });
        }

        if (window.DEBUG_PROMPTS) {
            console.groupCollapsed('[Prompt] Chat response (Groq)');
            console.log('System:', fullSystemPrompt);
            console.log('Messages (%d):', groqMessages.length - 1, recentMessages.map(m => `${m.role}: ${m.content.substring(0, 80)}`));
            console.groupEnd();
        }

        const data = await groqFetch(key, { model, messages: groqMessages, temperature, max_tokens: maxTokens, top_p: 0.95 });

        const text = data.choices?.[0]?.message?.content;
        if (!text) throw new Error('Empty response from Groq');
        return text;
    });
}

// ============ MEMORY (returns parsed JSON) ============
export async function callGroqForMemory({ prompt, apiKey, maxOutputTokens = 8192, model = 'llama-3.3-70b-versatile' }) {
    return withGroqKeyFallback(apiKey, 'Memory extraction', async (key) => {
        if (window.DEBUG_PROMPTS) {
            console.groupCollapsed('[Prompt] Memory extraction (Groq)');
            console.log(prompt);
            console.groupEnd();
        }

        const data = await groqFetch(key, {
            model,
            messages:        [{ role: 'user', content: prompt }],
            temperature:     0.1,
            max_tokens:      maxOutputTokens,
            response_format: { type: 'json_object' },
        });

        const text = data.choices?.[0]?.message?.content;
        if (!text) throw new Error('Empty Groq memory response');

        if (data.choices?.[0]?.finish_reason === 'length') {
            console.warn('[Memory/Groq] Response hit token limit — JSON may be truncated. Attempting repair.');
        }

        // Same JSON repair as Gemini path
        const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
        const match    = stripped.match(/\{[\s\S]*\}/);
        if (!match) { console.warn('[Memory/Groq] No JSON in response.'); return {}; }
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
            catch { console.warn('[Memory/Groq] JSON repair failed.'); return {}; }
        }
    });
}

// ============ SUMMARY ============
export async function callGroqForSummary({ apiKey, prompt, maxOutputTokens = 8192, model = 'llama-3.3-70b-versatile' }) {
    return withGroqKeyFallback(apiKey, 'Summary', async (key) => {
        if (window.DEBUG_PROMPTS) {
            console.groupCollapsed('[Prompt] Summary (Groq)');
            console.log(prompt);
            console.groupEnd();
        }

        const data = await groqFetch(key, {
            model,
            messages:    [{ role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens:  maxOutputTokens,
        });

        const text = data.choices?.[0]?.message?.content;
        if (!text) throw new Error('Empty Groq summary response');
        return text;
    });
}
