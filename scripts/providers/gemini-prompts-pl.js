/**
 * gemini-prompts-pl.js
 *
 * Prompt builders for Gemini — Polish communication mode.
 * Memory and summary are extracted/written in Polish.
 * Chat system prompt instructs the AI to respond in Polish.
 */

import {
    buildMemoryUpdatePrompt as sharedMemoryUpdate,
    buildMemorySeedPrompt   as sharedMemorySeed,
} from './memory-prompt-shared.js';

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
    return sharedMemoryUpdate('pl', existing, character, recentMessages, userMsg, aiMsg);
}

export function buildMemorySeedPrompt(character) {
    return sharedMemorySeed('pl', character);
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
