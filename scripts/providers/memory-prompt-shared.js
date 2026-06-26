/**
 * memory-prompt-shared.js
 *
 * Compact, token-efficient memory prompts shared by Gemini and Mistral.
 * Mistral uses `ultra: true` for an even tighter variant.
 */

const KEY_MAP = {
    profile:      'p',
    goals:        'g',
    memories:     'm',
    charProfile:  'cp',
    charGoals:    'cg',
    charMemories: 'cm',
};

const REVERSE_KEY = Object.fromEntries(Object.entries(KEY_MAP).map(([k, v]) => [v, k]));

/** Compact one-line JSON of existing memory (short keys, no whitespace). */
export function compactMemoryJson(existing) {
    const texts = arr => (arr || []).map(i => i.text || i).filter(Boolean);
    const out = {};
    for (const [full, short] of Object.entries(KEY_MAP)) {
        const items = texts(existing[full]);
        if (items.length) out[short] = items;
    }
    return Object.keys(out).length ? JSON.stringify(out) : '{}';
}

function trunc(s, max = 400) {
    if (!s || s.length <= max) return s || '';
    return s.slice(0, max) + '…';
}

function truncExchange(userMsg, aiMsg, maxEach = 1200) {
    return `U: ${trunc(userMsg, maxEach)}\nA: ${trunc(aiMsg, maxEach)}`;
}

const COPY = {
    pl: {
        langNote:     'Wartości po polsku.',
        memLegend:    'p=profil user, g=cele user, m=wspomnienia, cp/cg/cm=postać',
        charLabel:    'Postać',
        seedIntro:    'Wypełnij 3 klucze JSON z definicji postaci. Tylko JSON.',
        updateIntro:  'Ekstrakcja pamięci. Tylko JSON, bez markdown.',
        exchange:     'Wymiana',
        firstMeet:    ' (pierwsze spotkanie)',
        rules: (maxW, maxN, ultra) => ultra ? [
            `Nowe/zmienione wpisy: max ${maxW} słów, styl telegraficzny.`,
            `Zwróć TYLKO nowe/zmienione wpisy w tablicach — nie powtarzaj niezmienionych z MEM.`,
            `Usuń sprzeczność przez "remove": {"p":["dokładny tekst"],...}.`,
            `goals/charGoals: tylko nowe/zmienione cele.`,
            `Max ${maxN} wpisów/sekcję w bazie; bez duplikatów semantycznych.`,
            'Klucze: profile,goals,memories,charProfile,charGoals,charMemories,remove.',
        ] : [
            `Wpisy: max ${maxW} słów, telegraficznie, po polsku.`,
            `Tablice: TYLKO nowe lub zmienione wpisy — nie kopiuj niezmienionych z MEM.`,
            `Pole "remove": obiekt z tablicami tekstów do usunięcia (np. {"p":["stary fakt"]}).`,
            `goals i charGoals: zwróć tylko nowe/zaktualizowane.`,
            `Limit ${maxN} wpisów na sekcję; łącz podobne fakty.`,
            'JSON: profile,goals,memories,charProfile,charGoals,charMemories,remove.',
        ],
    },
    en: {
        langNote:     'Values in English.',
        memLegend:    'p=user profile, g=goals, m=memories, cp/cg/cm=character',
        charLabel:    'Character',
        seedIntro:    'Fill 3 JSON keys from character definition. JSON only.',
        updateIntro:  'Memory extraction. JSON only, no markdown.',
        exchange:     'Exchange',
        firstMeet:    ' (first meeting)',
        rules: (maxW, maxN, ultra) => ultra ? [
            `New/changed items: max ${maxW} words, telegraphic.`,
            `Return ONLY new/changed items — do not repeat unchanged MEM entries.`,
            `Contradictions → "remove": {"p":["exact text"],...}.`,
            `goals/charGoals: new/updated only.`,
            `Max ${maxN} items/section; no semantic duplicates.`,
            'Keys: profile,goals,memories,charProfile,charGoals,charMemories,remove.',
        ] : [
            `Items: max ${maxW} words, telegraphic, English.`,
            `Arrays: ONLY new or changed items — skip unchanged MEM entries.`,
            `"remove" object with text arrays to delete (e.g. {"p":["old fact"]}).`,
            `goals & charGoals: new/updated only.`,
            `Limit ${maxN} items per section; merge similar facts.`,
            'JSON: profile,goals,memories,charProfile,charGoals,charMemories,remove.',
        ],
    },
};

export function buildMemoryUpdatePrompt(lang, existing, character, recentMessages, userMsg, aiMsg, { ultra = false } = {}) {
    const L         = COPY[lang] || COPY.pl;
    const maxWords  = ultra ? 8 : 12;
    const maxItems  = ultra ? 12 : 15;
    const name      = character?.name || 'AI';
    const memJson   = compactMemoryJson(existing);
    const allMsgs   = recentMessages || [];
    const isFirst   = allMsgs.filter(m => m.role === 'user').length <= 1;

    const welcome   = character?.welcomeMessage;
    const exchange  = (isFirst && welcome)
        ? `${name}: ${trunc(welcome, 300)}\n${truncExchange(userMsg, aiMsg, ultra ? 800 : 1200)}`
        : truncExchange(userMsg, aiMsg, ultra ? 800 : 1200);

    const charLine  = character
        ? `${L.charLabel}: ${name}${character.scenario ? ` | ${trunc(character.scenario, ultra ? 120 : 200)}` : ''}`
        : '';

    const rules = L.rules(maxWords, maxItems, ultra).map((r, i) => `${i + 1}. ${r}`).join('\n');

    return `${L.updateIntro} ${L.langNote}
${charLine}
MEM (${L.memLegend}): ${memJson}
${L.exchange}${isFirst ? L.firstMeet : ''}:
${exchange}

${rules}`;
}

export function buildMemorySeedPrompt(lang, character, { ultra = false } = {}) {
    const L        = COPY[lang] || COPY.pl;
    const maxW     = ultra ? 8 : 12;
    const maxProf  = ultra ? 8 : 12;
    const maxOther = ultra ? 5 : 8;
    const isPl     = lang === 'pl';

    return `${L.seedIntro} ${L.langNote}
${L.charLabel}: ${character.name}
${isPl ? 'Scenariusz' : 'Scenario'}: ${trunc(character.scenario || '-', 300)}
${isPl ? 'Detale' : 'Details'}: ${trunc(character.characterDetails || '-', ultra ? 400 : 600)}

charProfile: max ${maxProf} ${isPl ? 'wpisów' : 'items'}, ${maxW} ${isPl ? 'słów' : 'words'} | charGoals/charMemories: max ${maxOther}
${isPl ? 'Tylko JSON' : 'JSON only'}: {"charProfile":[],"charGoals":[],"charMemories":[]}`;
}

/** Expand short keys from LLM remove object to full MEMORY_KEYS. */
export function expandRemoveKeys(remove) {
    if (!remove || typeof remove !== 'object') return {};
    const out = {};
    for (const [k, v] of Object.entries(remove)) {
        const full = REVERSE_KEY[k] || k;
        if (Array.isArray(v)) out[full] = v;
    }
    return out;
}
