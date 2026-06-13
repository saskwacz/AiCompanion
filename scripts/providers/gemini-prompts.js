/**
 * Prompt builders for Gemini API calls (chat, memory, summary).
 */

const TOKENS_PER_WORD = 1.3;

// ============ CHAT ============

export function trimMessagesByTokens(messages, maxContextTokens) {
    let count = 0;
    const result = [];
    for (let i = messages.length - 1; i >= 0; i--) {
        const tokens = Math.ceil(messages[i].content.split(/\s+/).length * TOKENS_PER_WORD);
        if (count + tokens <= maxContextTokens) { result.unshift(messages[i]); count += tokens; }
        else break;
    }
    return result;
}

export function buildChatSystemPrompt(systemPrompt, chatSummary) {
    if (!chatSummary?.text) return systemPrompt;
    return systemPrompt +
        `\n\n[PREVIOUS CONVERSATION SUMMARY]\n` +
        `The following is a summary of everything that happened before the recent messages shown below. ` +
        `Use it as full context for the ongoing conversation:\n\n${chatSummary.text}`;
}

export function selectChatMessages(messages, chatSummary, contextTokens) {
    let recentMessages = chatSummary?.upToMessageCount != null
        ? messages.slice(chatSummary.upToMessageCount)
        : trimMessagesByTokens(messages, contextTokens);

    while (recentMessages.length > 0 && recentMessages[0].role !== 'user') {
        recentMessages = recentMessages.slice(1);
    }
    return recentMessages;
}

/** Maps app messages to Gemini `contents` array. */
export function buildChatContents(recentMessages) {
    const contents = recentMessages.map(m => ({
        role:  m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }],
    }));

    if (contents.length === 0) {
        contents.push({ role: 'user', parts: [{ text: '(continue the conversation)' }] });
    }
    return contents;
}

// ============ SYSTEM (character chat) ============

/** Assembles the system prompt including optional memory context.
 *  Memory (structured character + user knowledge) is placed FIRST.
 *  Raw 'prompt' and 'characterDetails' fields are NOT repeated here —
 *  their content is already distilled into structured memory. */
export function buildSystemPrompt(character, memCtx = '') {
    let prompt = '';
    if (memCtx) prompt += `${memCtx}\n\n`;
    if (character.scenario)         prompt += `Scenario: ${character.scenario}\n\n`;
    if (character.dialogueExamples) prompt += `Dialogue Examples:\n${character.dialogueExamples}`;

    if (memCtx && memCtx.includes('[since:')) {
        prompt += '\n\n[INSTRUCTION] Memory facts with [since: {miliseconds since 1970-01-01}] timestamps help you understand the chronological order of events and how relationships/knowledge developed over time. Use this information to provide contextually accurate responses that reflect what was known when.';
    }

    return prompt.trim();
}

// ============ MEMORY ============

export function buildMemoryUpdatePrompt(existing, character, recentMessages, userMsg, aiMsg) {
    const fmtPlain = arr => (arr || []).map(i => i.text || i).filter(Boolean);
    const existingStr = JSON.stringify({
        user: {
            profile:  fmtPlain(existing.profile),
            goals:    fmtPlain(existing.goals),
            memories: fmtPlain(existing.memories),
        },
        character: {
            charProfile:  fmtPlain(existing.charProfile),
            charGoals:    fmtPlain(existing.charGoals),
            charMemories: fmtPlain(existing.charMemories),
        },
    }, null, 2);

    const companionName = character?.name || 'Companion';

    const allMessages     = recentMessages || [];
    const isFirstExchange = allMessages.filter(m => m.role === 'user').length <= 1;

    const contextMsgs = isFirstExchange
        ? []
        : allMessages.slice(-8, -2);

    const recentStr = contextMsgs
        .map(m => `${m.role === 'user' ? 'Użytkownik' : companionName}: ${m.content}`)
        .join('\n');

    const welcomeMsg  = character?.welcomeMessage;
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
- "profile"  = PEŁNA lista: fakty, preferencje, cechy osobowości i relacje użytkownika (imię, wiek, praca, hobby, upodobania, charakter, rodzina itp.)
- "goals"    = PEŁNA lista celów, planów, życzeń użytkownika
- "memories" = PEŁNA lista ważnych momentów i wydarzeń

--- DZIAŁ 2: character (co ${companionName} wie o SOBIE) ---
- "charProfile"  = PEŁNA lista: fakty o sobie, preferencje i cechy osobowości
- "charGoals"    = PEŁNA lista własnych celów i motywacji
- "charMemories" = PEŁNA lista własnych wspomnień

Zasady:
- Każda lista maksymalnie 20 elementów — jeśli więcej, usuń najmniej istotne.
- Każdy element to jedno krótkie, jasne zdanie po polsku.
- CHRONOLOGIA: Każdy wpis może mieć własność "firstSeen" (format: milisekundy od 1970-01-01).
  Jeśli wprowadzasz NOWY wpis — oznacz go aktualną datą.
  Jeśli aktualizujesz istniejący wpis — ZACHOWAJ jego oryginalny "firstSeen".
- WAŻNE: Zwróć TYLKO jeden prawidłowy obiekt JSON z dokładnie tymi 6 kluczami:
  profile, goals, memories, charProfile, charGoals, charMemories
- Każda wartość to tablica zwykłych ciągów znaków (lub opcjonalnie obiektów z "text" i "firstSeen").`;
}

export function buildMemorySeedPrompt(character) {
    return `Jesteś asystentem ekstrakcji wiedzy własnej postaci AI.
Analiza poniższej definicji postaci — wypełnij dokładnie 3 klucze JSON.
ODPOWIADAJ WYŁĄCZNIE PO POLSKU — wszystkie wartości w tablicach muszą być w języku polskim.

IMIĘ POSTACI: ${character.name}
PROMPT OSOBOWOŚCI: ${character.prompt || 'brak'}
SCENARIUSZ: ${character.scenario || 'brak'}
SZCZEGÓŁY POSTACI: ${character.characterDetails || 'brak'}
PRZYKŁADY DIALOGÓW:
${character.dialogueExamples || 'brak'}

Wyodrębnij TYLKO z powyższej definicji postaci:
- "charProfile"  : fakty o sobie, preferencje i cechy osobowości (wygląd, przeszłość, hobby, charakter) — maks. 15 krótkich zdań
- "charGoals"    : motywacje, cele, pragnienia — maks. 10 krótkich zdań
- "charMemories" : wydarzenia z przeszłości, formujące doświadczenia — maks. 10 krótkich zdań

Zasady:
- Każdy element to jedno krótkie zdanie w języku polskim (bez symboli listy).
- Zwróć TYLKO prawidłowy obiekt JSON z dokładnie tymi 3 kluczami. Żadnego innego tekstu.`;
}

// ============ SUMMARY ============

export function buildSummaryPrompt({ convText, charName, previousSummaryText }) {
    const prevSection = previousSummaryText
        ? `PREVIOUS SUMMARY (incorporate this):\n${previousSummaryText}\n\n---\n\n`
        : '';

    return `${prevSection}Write a comprehensive, detailed summary of the conversation below.
This summary will REPLACE the full history in future API calls, so include everything important.

Cover:
- All topics discussed and decisions made
- Important facts revealed about the user (name, age, job, hobbies, relationships, etc.)
- Key moments and memorable exchanges
- Emotional tone and relationship dynamic between user and ${charName}
- Any running themes, promises, inside jokes, or ongoing topics
- Anything that might be referenced in future messages

Be thorough and specific — omit nothing significant.

CONVERSATION:
${convText}`;
}
