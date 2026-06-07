import { dbGet, dbPut } from './db.js';
import { callGroqForMemory } from './groq.js';

const MEMORY_MODEL_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent';

// ============ EMPTY TEMPLATE ============
// Each item shape: { text: string, count: number }
// Memory has two namespaces:
//   user.*      - what the companion knows about the USER
//   character.* - what the companion knows about ITSELF (evolves during chat)
export function emptyMemory(chatId) {
    return {
        chatId,
        // --- USER knowledge ---
        facts:         [],
        preferences:   [],
        goals:         [],
        relationships: [],
        memories:      [],
        // --- CHARACTER self-knowledge ---
        charFacts:         [],
        charPreferences:   [],
        charGoals:         [],
        charPersonality:   [],
        charMemories:      [],
        updatedAt:     Date.now(),
    };
}

// ============ CRUD ============
export async function getMemoryForChat(chatId) {
    return (await dbGet('memory', chatId)) || emptyMemory(chatId);
}

export async function saveMemory(mem) {
    await dbPut('memory', { ...mem, updatedAt: Date.now() });
}

// ============ HELPERS ============
function norm(s) {
    return String(s).toLowerCase().replace(/[^\w\s]/g, '').trim();
}

/**
 * Merge new plain-string list into existing {text,count} items.
 * - If newStrings is empty the existing list is returned unchanged (LLM had nothing to add).
 * - Matching existing items carry their count over and get +1 if the topic appears in exchangeText.
 * - Brand-new items start at count 1.
 * - Items missing from newStrings are dropped (LLM pruned them) — only when LLM sent a non-empty list.
 */
function mergeItems(existingItems, newStrings, exchangeText = '') {
    if (!newStrings.length) return existingItems; // preserve when LLM has no updates for this field
    const exNorm = norm(exchangeText);
    const now    = Date.now();
    return newStrings.map(text => {
        const keywords = norm(text).split(/\s+/).filter(w => w.length > 3);
        const match    = existingItems.find(item => {
            const eNorm = norm(item.text || item);
            return keywords.some(w => eNorm.includes(w));
        });
        const base      = match ? (match.count || 1) : 0;
        const mentioned = keywords.some(w => exNorm.includes(w));
        const firstSeen = match?.firstSeen ?? now; // preserve original timestamp
        return { text, count: base + (mentioned ? 1 : 1), firstSeen };
    });
}

// ============ CONTEXT STRING FOR SYSTEM PROMPT ============
export function memoryToContext(mem) {
    const fmt = items =>
        [...items]
            .sort((a, b) => (b.count || 1) - (a.count || 1))
            .map(i => {
                const t = i.text || i;
                const c = i.count || 1;
                const fs = i.firstSeen ? ` [since: ${i.firstSeen}]` : '';
                return c > 1 ? `${t} [x${c}]${fs}` : `${t}${fs}`;
            })
            .join(' | ');

    const parts = [];

    // Character self-knowledge (shown first — highest priority)
    const charParts = [];
    if (mem.charFacts?.length)       charParts.push(`Self-facts: ${fmt(mem.charFacts)}`);
    if (mem.charPreferences?.length) charParts.push(`Own preferences: ${fmt(mem.charPreferences)}`);
    if (mem.charGoals?.length)       charParts.push(`Own goals: ${fmt(mem.charGoals)}`);
    if (mem.charPersonality?.length) charParts.push(`Personality traits revealed: ${fmt(mem.charPersonality)}`);
    if (mem.charMemories?.length)    charParts.push(`Own memories/experiences: ${fmt(mem.charMemories)}`);
    if (charParts.length) parts.push(`[ABOUT YOURSELF]\n${charParts.join('\n')}`);

    // User knowledge
    const userParts = [];
    if (mem.facts?.length)         userParts.push(`Facts: ${fmt(mem.facts)}`);
    if (mem.preferences?.length)   userParts.push(`Preferences: ${fmt(mem.preferences)}`);
    if (mem.goals?.length)         userParts.push(`Goals: ${fmt(mem.goals)}`);
    if (mem.relationships?.length) userParts.push(`Relationship w/ User: ${fmt(mem.relationships)}`);
    if (mem.memories?.length)      userParts.push(`Memories: ${fmt(mem.memories)}`);
    if (userParts.length) parts.push(`[ABOUT THE USER]\n${userParts.join('\n')}`);

    const ctx = parts.length ? `[COMPANION MEMORY]\n${parts.join('\n\n')}` : '';
    
    // Add note about firstSeen for better chronological understanding
    const note = parts.length ? '\n\n[NOTE] Memory items may include timestamps like [since: {miliseconds since 1970-01-01}] to help you understand when facts were first learned. Use this to build accurate timeline of events and relationships.' : '';
    
    return ctx + note;
}

// ============ INTERNAL API CALL ============
// providerConfig: null = Gemini (default), or { provider:'groq', keys, model }
async function callMemoryModel(prompt, apiKey, maxOutputTokens = 4096, providerConfig = null) {
    if (providerConfig?.provider === 'groq') {
        return callGroqForMemory({
            prompt,
            apiKey:          providerConfig.keys,
            maxOutputTokens,
            model:           providerConfig.model,
        });
    }
    const items = Array.isArray(apiKey) ? apiKey : [apiKey];
    let lastErr;
    for (const item of items) {
        const key   = typeof item === 'string' ? item : item.key;
        const label = typeof item === 'string' ? `…${key.slice(-6)}` : (item.label || `…${key.slice(-6)}`);
        console.log(`[API] Memory extraction → key: "${label}"`);
        if (window.DEBUG_PROMPTS) {
            console.groupCollapsed('[Prompt] Memory extraction');
            console.log(prompt);
            console.groupEnd();
        }
        try {
            const r = await fetch(`${MEMORY_MODEL_URL}?key=${key}`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents:         [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature:      0.1,
                        maxOutputTokens,
                        responseMimeType: 'application/json',
                        thinkingConfig:   { thinkingBudget: 0 }, // disable thinking — pure JSON extraction
                    },
                }),
            });
            if (!r.ok) {
                const err = await r.json().catch(() => ({}));
                throw new Error(`Memory model error ${r.status}: ${err.error?.message || ''}`);
            }
            const d          = await r.json();
            if (d.promptFeedback?.blockReason) {
                throw new Error(`Memory prompt blocked: ${d.promptFeedback.blockReason}`);
            }
            const candidate  = d.candidates?.[0];
            const text       = candidate?.content?.parts?.[0]?.text;
            if (!text) throw new Error('Empty memory model response');

            // Log a warning if the response was cut off by token limit
            if (candidate.finishReason === 'MAX_TOKENS') {
                console.warn('[Memory] Response hit MAX_TOKENS — JSON may be truncated. Attempting repair.');
            }

            // responseMimeType forces clean JSON — strip any accidental fences just in case
            const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
            const match    = stripped.match(/\{[\s\S]*\}/);
            if (!match) {
                console.warn('[Memory] No JSON in response, using empty result. Raw:', text.substring(0, 200));
                return {};
            }
            try {
                return JSON.parse(match[0]);
            } catch {
                // Truncated JSON repair:
                // 1. Remove any trailing incomplete string (open quote without close)
                // 2. Remove trailing comma
                // 3. Close open arrays and objects
                let s = match[0];
                // Remove incomplete last string value: ,"incomplete or ,"incomplete
                s = s.replace(/,?\s*"[^"]*$/, '');
                // Remove trailing comma
                s = s.replace(/,\s*$/, '');
                // Count unclosed brackets
                const opens = (s.match(/\[/g) || []).length - (s.match(/\]/g) || []).length;
                const objs  = (s.match(/\{/g) || []).length - (s.match(/\}/g) || []).length;
                for (let i = 0; i < opens; i++) s += ']';
                for (let i = 0; i < objs;  i++) s += '}';
                try {
                    return JSON.parse(s);
                } catch {
                    console.warn('[Memory] JSON repair failed, using empty result.');
                    return {};
                }
            }
        } catch (e) {
            lastErr = e;
            console.warn(`[Memory] "${label}" failed:`, e.message);
            if (items.indexOf(item) < items.length - 1) {
                console.log('[Memory] Waiting 5 s before trying next key…');
                await new Promise(r => setTimeout(r, 5000));
            }
        }
    }
    throw lastErr;
}

// ============ BUILD UPDATE PROMPT ============
function buildUpdatePrompt(existing, character, recentMessages, userMsg, aiMsg) {
    // Send plain strings only — {text,count} objects inflate the prompt needlessly
    const fmtPlain = arr => (arr || []).map(i => i.text || i).filter(Boolean);
    const existingStr = JSON.stringify({
        user: {
            facts:         fmtPlain(existing.facts),
            preferences:   fmtPlain(existing.preferences),
            goals:         fmtPlain(existing.goals),
            relationships: fmtPlain(existing.relationships),
            memories:      fmtPlain(existing.memories),
        },
        character: {
            charFacts:       fmtPlain(existing.charFacts),
            charPreferences: fmtPlain(existing.charPreferences),
            charGoals:       fmtPlain(existing.charGoals),
            charPersonality: fmtPlain(existing.charPersonality),
            charMemories:    fmtPlain(existing.charMemories),
        },
    }, null, 2);

    const companionName = character?.name || 'Companion';

    // Recent context: messages BEFORE the current exchange (exclude last user+AI pair)
    const allMessages    = recentMessages || [];
    const isFirstExchange = allMessages.filter(m => m.role === 'user').length <= 1;

    // For first exchange: welcome msg goes INTO the exchange block (not context)
    // For later exchanges: welcome is just part of history context
    const contextMsgs = isFirstExchange
        ? []   // no separate context on first exchange — welcome is part of exchange below
        : allMessages.slice(-8, -2);

    const recentStr = contextMsgs
        .map(m => `${m.role === 'user' ? 'Użytkownik' : companionName}: ${m.content}`)
        .join('\n');

    // Build the exchange section
    const welcomeMsg = character?.welcomeMessage;
    const exchangeStr = (isFirstExchange && welcomeMsg)
        ? `${companionName}: ${welcomeMsg}\nUżytkownik: ${userMsg}\n${companionName}: ${aiMsg}`
        : `Użytkownik: ${userMsg}\n${companionName}: ${aiMsg}`;

    const charCtx = character ? [
        `IMIĘ POSTACI: ${character.name}`,
        character.scenario         ? `SCENARIUSZ: ${character.scenario}`                     : '',
        character.dialogueExamples ? `PRZYKŁADY DIALOGÓW:\n${character.dialogueExamples}` : '',
    ].filter(Boolean).join('\n') : '';

    return `Jesteś asystentem ekstrakcji pamięci dla postaci AI o imieniu ${companionName}.
Odpowiadaj WYŁĄCZNIE po polsku — wszystkie wartości w tablicach muszą być w języku polskim.

${charCtx ? `KONTEKST POSTACI:\n${charCtx}\n` : ''}
AKTUALNA PAMIĘĆ (zachowaj WSZYSTKIE istniejące wpisy, dodaj nowe):
${existingStr}
${recentStr ? `\nOSTATNIE WIADOMOŚCI Z ROZMOWY (kontekst):\n${recentStr}\n` : ''}
WYMIANA DO PRZEANALIZOWANIA${isFirstExchange ? ' (pierwsze spotkanie — analizuj całość)' : ''}:
${exchangeStr}

Zadanie:
1. Weź WSZYSTKIE istniejące wpisy z pamięci powyżej.
2. Dodaj NOWE fakty/preferencje/cele wynikające z tej wymiany.
3. Usuń wpis TYLKO jeśli jest bezpośrednio zaprzeczony w tej wymianie.
4. Zwróć KOMPLETNE, zaktualizowane listy — nie tylko nowe elementy.

--- DZIAŁ 1: user (co ${companionName} wie o UŻYTKOWNIKU) ---
- "facts"         = PEŁNA lista faktów o użytkowniku (imię, wiek, praca, miejscowość itp.)
- "preferences"   = PEŁNA lista upodobań, niechęci, hobby, zainteresowań użytkownika
- "goals"         = PEŁNA lista celów, planów, życzeń użytkownika
- "relationships" = PEŁNA lista informacji o relacjach użytkownika
- "memories"      = PEŁNA lista ważnych momentów i wydarzeń

--- DZIAŁ 2: character (co ${companionName} wie o SOBIE) ---
- "charFacts"       = PEŁNA lista faktów o sobie
- "charPreferences" = PEŁNA lista własnych preferencji
- "charGoals"       = PEŁNA lista własnych celów i motywacji
- "charPersonality" = PEŁNA lista cech osobowości
- "charMemories"    = PEŁNA lista własnych wspomnień

Zasady:
- Każda lista maksymalnie 15 elementów — jeśli więcej, usuń najmniej istotne.
- Każdy element to jedno krótkie, jasne zdanie po polsku.
- CHRONOLOGIA: Każdy fakt/preferencja/cel może mieć własność "firstSeen" (format: Milisekundy od 1970-01-01}). 
  Jeśli wprowadzasz NOWY wpis z pierwszą wymiany — oznaż go aktualną datą.
  Jeśli aktualizujesz istniejący wpis — ZACHOWAJ jego oryginalny "firstSeen" aby zachować chronologię.
- WAŻNE: Zwróć TYLKO jeden prawidłowy obiekt JSON z dokładnie tymi 10 kluczami:
  facts, preferences, goals, relationships, memories,
  charFacts, charPreferences, charGoals, charPersonality, charMemories
- Każda wartość to tablica zwykłych ciągów znaków (lub opcjonalnie obiektów z "text" i "firstSeen").`;
}

// ============ UPDATE MEMORY AFTER EXCHANGE ============
export async function updateMemoryFromExchange(chatId, userMsg, aiMsg, apiKey, character, recentMessages = [], maxOutputTokens = 8192, providerConfig = null) {
    const existing     = await getMemoryForChat(chatId);
    const exchangeText = userMsg + ' ' + aiMsg;
    const prompt       = buildUpdatePrompt(existing, character, recentMessages, userMsg, aiMsg);

    try {
        const raw = await callMemoryModel(prompt, apiKey, maxOutputTokens, providerConfig);

        // Normalize: model may return { user:{facts,..}, character:{charFacts,..} }
        // OR a flat object { facts, preferences, ..., charFacts, ... }
        // Also items may be plain strings OR {text,count} objects — extract text.
        const flat = {
            facts:           raw.facts           ?? raw.user?.facts           ?? [],
            preferences:     raw.preferences     ?? raw.user?.preferences     ?? [],
            goals:           raw.goals           ?? raw.user?.goals           ?? [],
            relationships:   raw.relationships   ?? raw.user?.relationships   ?? [],
            memories:        raw.memories        ?? raw.user?.memories        ?? [],
            charFacts:       raw.charFacts       ?? raw.character?.charFacts       ?? [],
            charPreferences: raw.charPreferences ?? raw.character?.charPreferences ?? [],
            charGoals:       raw.charGoals       ?? raw.character?.charGoals       ?? [],
            charPersonality: raw.charPersonality ?? raw.character?.charPersonality ?? [],
            charMemories:    raw.charMemories    ?? raw.character?.charMemories    ?? [],
        };
        // Extract plain strings (handle both "string" and {text,count} items)
        const toStr = arr => (Array.isArray(arr) ? arr : []).map(i => (typeof i === 'string' ? i : i?.text)).filter(Boolean);

        console.log('[Memory] Parsed (flat):', JSON.stringify({
            facts: flat.facts?.length, preferences: flat.preferences?.length,
            goals: flat.goals?.length, charFacts: flat.charFacts?.length,
        }));

        const mi = (key, ex) => mergeItems(ex || [], toStr(flat[key]), exchangeText);
        const updated = {
            ...existing,
            facts:           mi('facts',           existing.facts),
            preferences:     mi('preferences',     existing.preferences),
            goals:           mi('goals',           existing.goals),
            relationships:   mi('relationships',   existing.relationships),
            memories:        mi('memories',        existing.memories),
            charFacts:       mi('charFacts',       existing.charFacts),
            charPreferences: mi('charPreferences', existing.charPreferences),
            charGoals:       mi('charGoals',       existing.charGoals),
            charPersonality: mi('charPersonality', existing.charPersonality),
            charMemories:    mi('charMemories',    existing.charMemories),
        };
        await saveMemory(updated);
        return updated;
    } catch (e) {
        console.warn('[Memory] Update failed:', e.message);
        return existing;
    }
}

// ============ SEED / REFRESH FROM CHARACTER DEFINITION ============
// Runs after save/edit of character to populate its self-knowledge.
export async function seedMemoryFromCharacter(chatId, character, apiKey, existingMemory, maxOutputTokens = 8192, providerConfig = null) {
    const hasContent = character.characterDetails || character.scenario || character.prompt;
    if (!hasContent) return;

    const existing = existingMemory || await getMemoryForChat(chatId);

    // Seed prompt: ONLY character self-knowledge (5 keys).
    // User fields stay empty — they're populated during actual conversation.
    const prompt = `Jesteś asystentem ekstrakcji wiedzy własnej postaci AI.
Analiza poniższej definicji postaci — wypełnij dokładnie 5 kluczy JSON.
ODPOWIADAJ WYŁĄCZNIE PO POLSKU — wszystkie wartości w tablicach muszą być w języku polskim.

IMIĘ POSTACI: ${character.name}
PROMPT OSOBOWOŚCI: ${character.prompt || 'brak'}
SCENARIUSZ: ${character.scenario || 'brak'}
SZCZEGÓŁY POSTACI: ${character.characterDetails || 'brak'}
PRZYKŁADY DIALOGÓW:
${character.dialogueExamples || 'brak'}

Wyodrębnij TYLKO z powyższej definicji postaci:
- "charFacts"       : konkretne fakty (wygląd, przeszłość, zdolności, zawód) — maks. 10 krótkich zdań
- "charPreferences" : upodobania, niechęci, zainteresowania, hobby — maks. 10 krótkich zdań
- "charGoals"       : motywacje, cele, pragnienia — maks. 10 krótkich zdań
- "charPersonality" : cechy osobowości, dziwactwa, wzorce zachowania — maks. 10 krótkich zdań
- "charMemories"    : wydarzenia z przeszłości, formujące doświadczenia — maks. 10 krótkich zdań

Zasady:
- Każdy element to jedno krótkie zdanie w języku polskim (bez symboli listy).
- Zwróć TYLKO prawidłowy obiekt JSON z dokładnie tymi 5 kluczami. Żadnego innego tekstu.`;

    try {
        const raw = await callMemoryModel(prompt, apiKey, maxOutputTokens, providerConfig);
        const et  = [character.prompt, character.scenario,
                      character.characterDetails, character.dialogueExamples].filter(Boolean).join(' ');
        // Normalize nested/flat and plain strings/{text,count} objects
        const flat  = { charFacts: raw.charFacts ?? raw.character?.charFacts ?? [],
                         charPreferences: raw.charPreferences ?? raw.character?.charPreferences ?? [],
                         charGoals: raw.charGoals ?? raw.character?.charGoals ?? [],
                         charPersonality: raw.charPersonality ?? raw.character?.charPersonality ?? [],
                         charMemories: raw.charMemories ?? raw.character?.charMemories ?? [] };
        const toStr = arr => (Array.isArray(arr) ? arr : []).map(i => (typeof i === 'string' ? i : i?.text)).filter(Boolean);
        const mi    = (key, ex) => mergeItems(ex || [], toStr(flat[key]), et);

        const seeded = {
            chatId,
            // user knowledge: preserve whatever was already there (empty on first seed)
            facts:           existing.facts         || [],
            preferences:     existing.preferences   || [],
            goals:           existing.goals         || [],
            relationships:   existing.relationships || [],
            memories:        existing.memories      || [],
            // character self-knowledge extracted from definition
            charFacts:       mi('charFacts',       existing.charFacts),
            charPreferences: mi('charPreferences', existing.charPreferences),
            charGoals:       mi('charGoals',       existing.charGoals),
            charPersonality: mi('charPersonality', existing.charPersonality),
            charMemories:    mi('charMemories',    existing.charMemories),
        };
        await saveMemory(seeded);
        return seeded;
    } catch (e) {
        console.warn('[Memory] Seed failed:', e.message);
    }
}
