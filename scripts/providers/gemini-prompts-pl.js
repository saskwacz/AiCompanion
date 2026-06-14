/**
 * gemini-prompts-pl.js
 *
 * Prompt builders for Gemini — Polish communication mode.
 * Memory and summary are extracted/written in Polish.
 * Chat system prompt instructs the AI to respond in Polish.
 */

// ─── CHAT — system prompt ─────────────────────────────────────────────────────

/**
 * Full character system prompt: personality → memory → scenario → dialogue.
 * Includes Polish language instruction.
 */
export function buildSystemPrompt(character, memCtx = '') {
    const parts = [];

    // Primary instructions (formerly dialogue examples)
    if (character.promptInstructions)
        parts.push(character.promptInstructions);

    // Injected memory context
    if (memCtx) parts.push(memCtx);

    const instruction = [];
    if (memCtx && memCtx.includes('[since:')) {
        instruction.push('[INSTRUKCJA] Fakty z pamięci oznaczone [since: {milisekundy od 1970-01-01}] wskazują kolejność chronologiczną. Używaj tych informacji żeby odpowiadać zgodnie z tym, co było wiadome w danym momencie.');
    }
    instruction.push('[JĘZYK] Komunikuj się wyłącznie w języku polskim, chyba że użytkownik sam pisze po angielsku — wtedy odpisuj w tym samym języku.');

    parts.push(instruction.join('\n'));
    return parts.filter(Boolean).join('\n\n').trim();
}

// ─── MEMORY ───────────────────────────────────────────────────────────────────

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

    const companionName   = character?.name || 'Companion';
    const allMessages     = recentMessages || [];
    const isFirstExchange = allMessages.filter(m => m.role === 'user').length <= 1;

    const contextMsgs = isFirstExchange ? [] : allMessages.slice(-8, -2);
    const recentStr   = contextMsgs
        .map(m => `${m.role === 'user' ? 'Użytkownik' : companionName}: ${m.content}`)
        .join('\n');

    const welcomeMsg  = character?.welcomeMessage;
    const exchangeStr = (isFirstExchange && welcomeMsg)
        ? `${companionName}: ${welcomeMsg}\nUżytkownik: ${userMsg}\n${companionName}: ${aiMsg}`
        : `Użytkownik: ${userMsg}\n${companionName}: ${aiMsg}`;

    const charCtx = character ? [
        `IMIĘ POSTACI: ${character.name}`,
        character.scenario           ? `SCENARIUSZ: ${character.scenario}`                         : '',
        character.promptInstructions ? `INSTRUKCJE POSTACI:\n${character.promptInstructions}`      : '',
    ].filter(Boolean).join('\n') : '';

    return `Jesteś asystentem ekstrakcji pamięci dla postaci AI o imieniu ${companionName}.
Odpowiadaj WYŁĄCZNIE po polsku — wszystkie wartości w tablicach muszą być w języku polskim.

${charCtx ? `KONTEKST POSTACI:\n${charCtx}\n` : ''}AKTUALNA PAMIĘĆ (zachowaj WSZYSTKIE istniejące wpisy, dodaj nowe):
${existingStr}
${recentStr ? `\nOSTATNIE WIADOMOŚCI Z ROZMOWY (kontekst):\n${recentStr}\n` : ''}WYMIANA DO PRZEANALIZOWANIA${isFirstExchange ? ' (pierwsze spotkanie — analizuj całość)' : ''}:
${exchangeStr}

Zadanie:
1. Weź WSZYSTKIE istniejące wpisy z pamięci powyżej.
2. Dodaj NOWE fakty/preferencje/cele wynikające z tej wymiany.
3. Usuń wpis TYLKO jeśli jest bezpośrednio zaprzeczony w tej wymianie.
4. Zwróć KOMPLETNE, zaktualizowane listy — nie tylko nowe elementy.

--- DZIAŁ 1: user (co ${companionName} wie o UŻYTKOWNIKU) ---
- "profile"  = PEŁNA lista: fakty, preferencje, cechy osobowości i relacje użytkownika
- "goals"    = PEŁNA lista celów, planów, życzeń użytkownika
- "memories" = PEŁNA lista ważnych momentów i wydarzeń

--- DZIAŁ 2: character (co ${companionName} wie o SOBIE) ---
- "charProfile"  = PEŁNA lista: fakty o sobie, preferencje i cechy osobowości
- "charGoals"    = PEŁNA lista własnych celów i motywacji
- "charMemories" = PEŁNA lista własnych wspomnień

Zasady:
- Każda lista maksymalnie 20 elementów — jeśli więcej, usuń najmniej istotne.
- Każdy element to jedno krótkie, jasne zdanie po polsku.
- CHRONOLOGIA: Każdy wpis może mieć własność "firstSeen" (milisekundy od 1970-01-01).
  Nowy wpis — oznacz aktualną datą. Aktualizacja — ZACHOWAJ oryginalny "firstSeen".
- Zwróć TYLKO jeden prawidłowy obiekt JSON z dokładnie tymi 6 kluczami:
  profile, goals, memories, charProfile, charGoals, charMemories
- Każda wartość to tablica ciągów znaków (lub obiektów z "text" i "firstSeen").`;
}

export function buildMemorySeedPrompt(character) {
    return `Jesteś asystentem ekstrakcji wiedzy własnej postaci AI.
Analiza poniższej definicji postaci — wypełnij dokładnie 3 klucze JSON.
ODPOWIADAJ WYŁĄCZNIE PO POLSKU — wszystkie wartości w tablicach muszą być w języku polskim.

IMIĘ POSTACI: ${character.name}
SCENARIUSZ: ${character.scenario || 'brak'}
SZCZEGÓŁY POSTACI: ${character.characterDetails || 'brak'}

Wyodrębnij TYLKO z powyższej definicji postaci:
- "charProfile"  : fakty o sobie, preferencje i cechy osobowości (wygląd, przeszłość, hobby, charakter) — maks. 15 krótkich zdań
- "charGoals"    : motywacje, cele, pragnienia — maks. 10 krótkich zdań
- "charMemories" : wydarzenia z przeszłości, formujące doświadczenia — maks. 10 krótkich zdań

Zasady:
- Każdy element to jedno krótkie zdanie w języku polskim (bez symboli listy).
- Zwróć TYLKO prawidłowy obiekt JSON z dokładnie tymi 3 kluczami. Żadnego innego tekstu.`;
}

// ─── SUMMARY ─────────────────────────────────────────────────────────────────

export function buildSummaryPrompt({ convText, charName, previousSummaryText, type = 'rolling', fromMsg, toMsg }) {
    const skipNote = 'WAŻNE: Jeśli fragment rozmowy zawiera treści których nie możesz przetworzyć, pomiń ten fragment i podsumuj resztę. Nie odmawiaj całej odpowiedzi.\n\n';
    switch (type) {

        case 'rolling': {
            const prev = previousSummaryText
                ? `POPRZEDNI SKRÓT (dla kontekstu):\n${previousSummaryText}\n\n---\n\n`
                : '';
            return `${skipNote}${prev}Napisz ZWIĘZŁY skrót poniższego fragmentu rozmowy (ostatnie ~${50} wiadomości).
Cel: szybka orientacja co się ostatnio działo — 3–6 zdań.
Pisz w języku polskim. Nie pomijaj ważnych faktów, decyzji ani emocji.

ROZMOWA:
${convText}`;
        }

        case 'chunk': {
            const loc = (fromMsg != null && toMsg != null) ? ` (wiadomości ${fromMsg}–${toMsg})` : '';
            return `${skipNote}Napisz SZCZEGÓŁOWE podsumowanie poniższego okna rozmowy${loc}.
To podsumowanie będzie przechowywane jako historyczny zapis. Uwzględnij WSZYSTKO co istotne:
- Tematy, decyzje, fakty o użytkowniku i postaci
- Ważne momenty, emocje, dynamikę relacji
- Obietnice, żarty wewnętrzne, powtarzające się wątki
Pisz w języku polskim. Bądź konkretny.

ROZMOWA:
${convText}`;
        }

        case 'medium': {
            const loc = (fromMsg != null && toMsg != null) ? ` (wiad. ${fromMsg}–${toMsg})` : '';
            return `${skipNote}Poniżej znajduje się ${charName ? `${20} szczegółowych podsumowań` : 'kilka podsumowań'} kolejnych okien rozmowy${loc}.
Napisz OGÓLNE PODSUMOWANIE, które syntetyzuje cały ten okres (ok. 1000 wiadomości).
Skup się na: głównych wątkach relacji, ważnych faktach o użytkowniku i postaci, kluczowych zdarzeniach.
Pisz w języku polskim. Bądź zwięzły — to jest podsumowanie wyższego poziomu.

PODSUMOWANIA OKIEN:
${convText}`;
        }

        case 'global': {
            return `${skipNote}Poniżej znajdują się podsumowania pośrednie całej rozmowy z ${charName || 'postacią AI'}.
Napisz GLOBALNY PRZEGLĄD całej historii tej relacji.
Uwzględnij: ewolucję relacji, najważniejsze fakty, kluczowe momenty, stałe wątki.
Pisz w języku polskim. Bądź syntetyczny — to nadrzędny kontekst dla całej historii.

PODSUMOWANIA POŚREDNIE:
${convText}`;
        }

        default: {
            const prevSection = previousSummaryText
                ? `POPRZEDNIE PODSUMOWANIE (uwzględnij poniższe):\n${previousSummaryText}\n\n---\n\n`
                : '';
            return `${prevSection}Napisz kompleksowe, szczegółowe podsumowanie poniższej rozmowy.
To podsumowanie ZASTĄPI pełną historię w przyszłych wywołaniach API, więc uwzględnij wszystko, co ważne.

Obejmij:
- Wszystkie omawiane tematy i podjęte decyzje
- Ważne fakty o użytkowniku (imię, wiek, praca, hobby, relacje itp.)
- Kluczowe momenty i pamiętne fragmenty rozmowy
- Nastrój emocjonalny i dynamikę relacji między użytkownikiem a ${charName}
- Wszelkie powtarzające się tematy, obietnice, wewnętrzne żarty
- Wszystko, do czego może odwoływać się przyszła rozmowa

Bądź dokładny i konkretny — nie pomijaj nic istotnego.
Pisz w języku polskim.

ROZMOWA:
${convText}`;
        }
    }
}
