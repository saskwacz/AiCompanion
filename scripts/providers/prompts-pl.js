/**
 * gemini-prompts-pl.js
 *
 * Prompt builders for Gemini ΓÇö Polish communication mode.
 * Memory and summary are extracted/written in Polish.
 * Chat system prompt instructs the AI to respond in Polish.
 */

import {
    buildMemoryUpdatePrompt as sharedMemoryUpdate,
    buildMemorySeedPrompt   as sharedMemorySeed,
} from './memory-prompt-shared.js';

// ΓöÇΓöÇΓöÇ CHAT ΓÇö system prompt ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

/**
 * Full character system prompt: personality ΓåÆ memory ΓåÆ scenario ΓåÆ dialogue.
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
        instruction.push('[INSTRUKCJA] Fakty z pami─Öci oznaczone [since: {milisekundy od 1970-01-01}] wskazuj─à kolejno┼¢─ç chronologiczn─à. U┼╝ywaj tych informacji ┼╝eby odpowiada─ç zgodnie z tym, co by┼éo wiadome w danym momencie.');
    }
    instruction.push('[J─ÿZYK] Komunikuj si─Ö wy┼é─àcznie w j─Özyku polskim, chyba ┼╝e u┼╝ytkownik sam pisze po angielsku ΓÇö wtedy odpisuj w tym samym j─Özyku.');

    parts.push(instruction.join('\n'));
    return parts.filter(Boolean).join('\n\n').trim();
}

// ΓöÇΓöÇΓöÇ MEMORY ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

export function buildMemoryUpdatePrompt(existing, character, recentMessages, userMsg, aiMsg) {
    return sharedMemoryUpdate('pl', existing, character, recentMessages, userMsg, aiMsg);
}

export function buildMemorySeedPrompt(character) {
    return sharedMemorySeed('pl', character, { seed: true });
}

// ΓöÇΓöÇΓöÇ SUMMARY ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

export function buildSummaryPrompt({ convText, charName, previousSummaryText, type = 'rolling', fromMsg, toMsg }) {
    const skipNote = 'WA┼╗NE: Je┼¢li fragment rozmowy zawiera tre┼¢ci kt├│rych nie mo┼╝esz przetworzy─ç, pomi┼ä ten fragment i podsumuj reszt─Ö. Nie odmawiaj ca┼éej odpowiedzi.\n\n';
    switch (type) {

        case 'rolling': {
            const prev = previousSummaryText
                ? `POPRZEDNI SKR├ôT (dla kontekstu):\n${previousSummaryText}\n\n---\n\n`
                : '';
            return `${skipNote}${prev}Napisz ZWI─ÿZ┼üY skr├│t poni┼╝szego fragmentu rozmowy (ostatnie ~${50} wiadomo┼¢ci).
Cel: szybka orientacja co si─Ö ostatnio dzia┼éo ΓÇö 3ΓÇô6 zda┼ä.
Pisz w j─Özyku polskim. Nie pomijaj wa┼╝nych fakt├│w, decyzji ani emocji.

ROZMOWA:
${convText}`;
        }

        case 'chunk': {
            const loc = (fromMsg != null && toMsg != null) ? ` (wiadomo┼¢ci ${fromMsg}ΓÇô${toMsg})` : '';
            return `${skipNote}Napisz SZCZEG├ô┼üOWE podsumowanie poni┼╝szego okna rozmowy${loc}.
To podsumowanie b─Ödzie przechowywane jako historyczny zapis. Uwzgl─Ödnij WSZYSTKO co istotne:
- Tematy, decyzje, fakty o u┼╝ytkowniku i postaci
- Wa┼╝ne momenty, emocje, dynamik─Ö relacji
- Obietnice, ┼╝arty wewn─Ötrzne, powtarzaj─àce si─Ö w─àtki
Pisz w j─Özyku polskim. B─àd┼║ konkretny.

ROZMOWA:
${convText}`;
        }

        case 'medium': {
            const loc = (fromMsg != null && toMsg != null) ? ` (wiad. ${fromMsg}ΓÇô${toMsg})` : '';
            return `${skipNote}Poni┼╝ej znajduje si─Ö ${charName ? `${20} szczeg├│┼éowych podsumowa┼ä` : 'kilka podsumowa┼ä'} kolejnych okien rozmowy${loc}.
Napisz OG├ôLNE PODSUMOWANIE, kt├│re syntetyzuje ca┼éy ten okres (ok. 1000 wiadomo┼¢ci).
Skup si─Ö na: g┼é├│wnych w─àtkach relacji, wa┼╝nych faktach o u┼╝ytkowniku i postaci, kluczowych zdarzeniach.
Pisz w j─Özyku polskim. B─àd┼║ zwi─Öz┼éy ΓÇö to jest podsumowanie wy┼╝szego poziomu.

PODSUMOWANIA OKIEN:
${convText}`;
        }

        case 'global': {
            return `${skipNote}Poni┼╝ej znajduj─à si─Ö podsumowania po┼¢rednie ca┼éej rozmowy z ${charName || 'postaci─à AI'}.
Napisz GLOBALNY PRZEGL─äD ca┼éej historii tej relacji.
Uwzgl─Ödnij: ewolucj─Ö relacji, najwa┼╝niejsze fakty, kluczowe momenty, sta┼ée w─àtki.
Pisz w j─Özyku polskim. B─àd┼║ syntetyczny ΓÇö to nadrz─Ödny kontekst dla ca┼éej historii.

PODSUMOWANIA PO┼ÜREDNIE:
${convText}`;
        }

        default: {
            const prevSection = previousSummaryText
                ? `POPRZEDNIE PODSUMOWANIE (uwzgl─Ödnij poni┼╝sze):\n${previousSummaryText}\n\n---\n\n`
                : '';
            return `${prevSection}Napisz kompleksowe, szczeg├│┼éowe podsumowanie poni┼╝szej rozmowy.
To podsumowanie ZAST─äPI pe┼én─à histori─Ö w przysz┼éych wywo┼éaniach API, wi─Öc uwzgl─Ödnij wszystko, co wa┼╝ne.

Obejmij:
- Wszystkie omawiane tematy i podj─Öte decyzje
- Wa┼╝ne fakty o u┼╝ytkowniku (imi─Ö, wiek, praca, hobby, relacje itp.)
- Kluczowe momenty i pami─Ötne fragmenty rozmowy
- Nastr├│j emocjonalny i dynamik─Ö relacji mi─Ödzy u┼╝ytkownikiem a ${charName}
- Wszelkie powtarzaj─àce si─Ö tematy, obietnice, wewn─Ötrzne ┼╝arty
- Wszystko, do czego mo┼╝e odwo┼éywa─ç si─Ö przysz┼éa rozmowa

B─àd┼║ dok┼éadny i konkretny ΓÇö nie pomijaj nic istotnego.
Pisz w j─Özyku polskim.

ROZMOWA:
${convText}`;
        }
    }
}
