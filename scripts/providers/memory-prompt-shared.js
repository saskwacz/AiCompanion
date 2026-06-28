/**
 * memory-prompt-shared.js
 *
 * Compact, token-efficient memory prompts shared across providers.
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

const CONTEXT_LABEL_RE = /\b(lubi|nie lubi|nienawidzi|preferuje|ma|mie|jest|bywa|chce|posiada|uwielbia|lubię|likes|dislikes|hates|prefers|enjoys|loves|has|have|is|are|was|wants|needs)\b/i;

/** Label like "Postać lubi:" — context for following list items, not a section header. */
export function isContextLabel(text) {
    const t = String(text || '').trim();
    if (!/:\s*$/.test(t)) return false;
    if (/^#{1,6}\s/.test(t)) return false;

    const body = t.replace(/:+\s*$/, '').trim();
    if (!body) return false;

    if (/^[A-ZĄĆĘŁŃÓŚŹŻ0-9][A-ZĄĆĘŁŃÓŚŹŻ0-9\s\-–—]{2,55}$/.test(body) && !CONTEXT_LABEL_RE.test(body)) {
        return false;
    }

    if (CONTEXT_LABEL_RE.test(body)) return true;
    if (/\b(postać|postaci|postac|character|bohater|bohaterka|bohaterowi|osoba)\b/i.test(body)) return true;
    return false;
}

function combineContextWithItem(prefix, item) {
    const p = String(prefix || '').trim();
    const i = String(item || '').trim();
    if (!p) return i;
    if (!i) return p;
    return `${p} ${i.charAt(0).toLowerCase() + i.slice(1)}`;
}

function splitListItems(text) {
    return String(text || '')
        .split(/\s*[,;]\s*|\s+(?:oraz|and|&)\s+/iu)
        .map(s => s.trim())
        .filter(Boolean);
}

/** True when line is a structural section header, not a memory fact. */
export function isSectionHeader(text) {
    const t = String(text || '').trim();
    if (!t || t.length < 3) return false;
    if (isContextLabel(t)) return false;

    if (/^#{1,6}\s*\S/.test(t)) {
        const body = t.replace(/^#{1,6}\s*/, '').replace(/:+\s*$/, '').trim();
        if (!body) return true;
        return body.length < 120 && !/[.!?;]/.test(body);
    }

    if (/^[A-ZĄĆĘŁŃÓŚŹŻ0-9][A-ZĄĆĘŁŃÓŚŹŻ0-9\s\-–—]{2,55}:?\s*$/.test(t) && !/[.!?;,]/.test(t)) {
        return true;
    }

    if (/^[A-ZĄĆĘŁŃÓŚŹŻ][^\n.!?;]{2,55}:\s*$/.test(t) && t.split(/\s+/).length <= 8) {
        return true;
    }

    return false;
}

/** Split header lines into content; drop bare headers. */
export function expandBioLine(line) {
    const t = String(line || '').trim();
    if (!t) return [];

    const inline = t.match(/^#{1,6}\s*[^:\n]{2,80}:\s+(.+)/s);
    if (inline?.[1]?.trim()) return [inline[1].trim()];

    if (isSectionHeader(t)) return [];

    return [t];
}

/** Filter fact strings — drop section headers. */
export function filterFactStrings(items) {
    return (items || []).filter(s => {
        const t = String(s || '').trim();
        return t && !isSectionHeader(t);
    });
}

function normFactKey(s) {
    return String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

const BIO_MEMORIES_RE = /\b(wspomnien|wspomnienia|pamięć|pamięci|pamięta|przeszłość|przeszlosc|historia|historii|dzieciństw|backstory|past|memories|memory|wydarzenia|traum|drugie życie|drugie zycie|second life|młodość|mlodosc|youth)\b/i;
const BIO_GOALS_RE = /\b(cel(e|ów|u|ami)?|cele|motywacj|aspiracj|goals|motivation|ambicj|plany|plans)\b/i;
const BIO_PROFILE_RE = /\b(wygląd|wyglad|osobowość|osobowosc|cechy|charakter|profil|appearance|personality|traits|relacje|relationships|zawód|zawod|hobby|ulubion|tożsamość|tozsamosc|identit)\b/i;

/** Map bio section header to memory bucket; null = keep current/default. */
export function bioSectionBucket(headerText) {
    const body = String(headerText || '')
        .replace(/^#{1,6}\s*/, '')
        .replace(/:+\s*$/, '')
        .trim();
    if (!body) return null;
    if (BIO_MEMORIES_RE.test(body)) return 'charMemories';
    if (BIO_GOALS_RE.test(body)) return 'charGoals';
    if (BIO_PROFILE_RE.test(body)) return 'charProfile';
    return null;
}

function finalizeBioFact(text) {
    return String(text || '').replace(/^[\s\-•*]+/, '').trim();
}

const MIN_BIO_FACT_LEN = 3;

function pushBioFact(items, text, bucket, fromSection = false) {
    const fact = finalizeBioFact(text);
    if (fact.length >= MIN_BIO_FACT_LEN && !isSectionHeader(fact)) {
        items.push({ text: fact, bucket, fromSection });
    }
}

/** Expand bio into logical lines: blocks, bullets, long sentences. */
function expandBioInputLines(bio) {
    const blocks = String(bio || '').split(/\r?\n\s*\r?\n|\r?\n(?=\s*[\-*•]\s)|\r?\n(?=\s*\d+[\.)]\s)/u);
    return blocks
        .flatMap(block => block.split(/\r?\n/))
        .map(line => line.replace(/^[\s\-•*\d]+[\.)]?\s*/, '').trim())
        .filter(Boolean)
        .flatMap(line => {
            if (line.length <= 280) return [line];
            return line.split(/(?<=[.!?;])\s+(?=[A-ZĄĆĘŁŃÓŚŹŻ0-9"«(])/u).map(s => s.trim()).filter(Boolean);
        });
}

function factFromHeaderValue(labelPart, rest) {
    const label = String(labelPart || '').trim();
    const value = String(rest || '').trim();
    if (!value) return '';
    if (value.length >= 12) return value;
    return label ? `${label}: ${value}` : value;
}

/**
 * Parse bio into categorized facts with list context preserved.
 * @returns {{ text: string, bucket: 'charProfile'|'charGoals'|'charMemories', fromSection: boolean }[]}
 */
export function parseBioStructuredFacts(bio) {
    const blocks = String(bio || '').split(/\r?\n\s*\r?\n|\r?\n(?=\s*[\-*•]\s)|\r?\n(?=\s*\d+[\.)]\s)/u);
    const items = [];
    for (const block of blocks) {
        items.push(...parseBioBlock(block));
    }
    return items;
}

function parseBioBlock(block) {
    const items = [];
    let contextPrefix = null;
    let sectionBucket = 'charProfile';
    let sectionExplicit = false;

    for (const trimmed of expandBioInputLines(block)) {
        const mdExpanded = expandBioLine(trimmed);
        if (mdExpanded.length === 1 && mdExpanded[0] !== trimmed) {
            contextPrefix = null;
            pushBioFact(items, mdExpanded[0], sectionBucket, sectionExplicit);
            continue;
        }

        const colonSplit = trimmed.match(/^(.+?):\s*(.+)$/s);
        if (colonSplit) {
            const labelPart = colonSplit[1].trim();
            const rest = colonSplit[2].trim();
            const labelWithColon = `${labelPart}:`;

            if (isContextLabel(labelWithColon)) {
                contextPrefix = labelPart;
                if (rest) {
                    for (const item of splitListItems(rest)) {
                        pushBioFact(items, combineContextWithItem(contextPrefix, item), sectionBucket, sectionExplicit);
                    }
                }
                continue;
            }

            if (isSectionHeader(labelWithColon)) {
                contextPrefix = null;
                const bucket = bioSectionBucket(labelWithColon);
                if (bucket) {
                    sectionBucket = bucket;
                    sectionExplicit = true;
                } else {
                    sectionExplicit = false;
                }
                if (rest) pushBioFact(items, factFromHeaderValue(labelPart, rest), sectionBucket, sectionExplicit);
                continue;
            }

            pushBioFact(items, trimmed, sectionBucket, sectionExplicit);
            continue;
        }

        if (isContextLabel(trimmed)) {
            contextPrefix = trimmed.replace(/:+\s*$/, '').trim();
            continue;
        }

        if (isSectionHeader(trimmed)) {
            contextPrefix = null;
            const bucket = bioSectionBucket(trimmed);
            if (bucket) {
                sectionBucket = bucket;
                sectionExplicit = true;
            } else {
                sectionExplicit = false;
            }
            continue;
        }

        if (contextPrefix) {
            pushBioFact(items, combineContextWithItem(contextPrefix, trimmed), sectionBucket, sectionExplicit);
            continue;
        }

        pushBioFact(items, trimmed, sectionBucket, sectionExplicit);
    }

    return items;
}

/**
 * Parse bio text into facts, preserving list context (e.g. "Postać lubi:" + "Spać" → "Postać lubi spać").
 * @returns {string[]}
 */
export function parseBioStructuredLines(bio) {
    return parseBioStructuredFacts(bio).map(i => i.text);
}

/** Drop bare list items when a longer contextual fact already covers them. */
export function dropBareSubFacts(facts) {
    const items = filterFactStrings(facts);
    return items.filter(f => {
        const fn = normFactKey(f);
        if (!fn) return false;
        return !items.some(other => {
            if (other === f) return false;
            const on = normFactKey(other);
            if (on.length <= fn.length + 4) return false;
            return on.includes(fn);
        });
    });
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
        seedIntroFull:'Wyekstrahuj ze szczegółowego opisu postaci wyłącznie fakty, cele i wspomnienia wyraźnie obecne w tekście poniżej.',
        seedRules: [
            'Źródło: tylko Szczegółowy opis postaci — NIE scenariusz, NIE instrukcje prompta.',
            'charProfile — cechy, relacje, preferencje, wygląd, zawód itp. wyraźnie opisane w bio.',
            'charGoals — tylko cele/motywacje wprost podane w bio (pusta tablica, jeśli brak).',
            'charMemories — wyłącznie wydarzenia/przeszłość/backstory z bio (np. sekcje WSPOMNIENIA, PRZESZŁOŚĆ, DRUGIE ŻYCIE). NIE mieszaj z charProfile.',
            'Każdy odrębny fakt z tekstu = osobny wpis. Nie łącz niepowiązanych informacji.',
            'Wyekstrahuj WSZYSTKIE fakty z bio — nie pomijaj wpisów. Pusta tablica tylko gdy kategoria naprawdę nie występuje.',
            'NIE traktuj nagłówków sekcji jako faktów (np. ### DRUGIE ŻYCIE:, WYGLĄD:, linie ALL CAPS z dwukropkiem). Pomiń sam nagłówek; treść po nagłówku wyciągnij osobno.',
            'Przy etykiecie + liście (np. "Postać lubi:" potem "Spać", "Jeść") każdy wpis musi zachować kontekst etykiety — np. "Postać lubi spać", NIE samo "Spać".',
            'Pusta tablica jest poprawna, gdy w bio nie ma nic dla danej kategorii.',
        ],
        updateIntro:  'Ekstrakcja pamięci. Tylko JSON, bez markdown.',
        exchange:     'Wymiana',
        firstMeet:    ' (pierwsze spotkanie)',
        rules: (maxW, ultra) => ultra ? [
            `Nowe wpisy: max ${maxW} słów, telegraficznie.`,
            `Tylko nowe/zmienione — nie powtarzaj MEM.`,
            `Sprzeczność → remove: {"p":["tekst"],...}.`,
            `goals/charGoals: tylko nowe/zmienione.`,
            'Nie wymyślaj faktów spoza wymiany. Bez duplikatów.',
            'JSON: profile,goals,memories,charProfile,charGoals,charMemories,remove.',
        ] : [
            `Wpisy: max ${maxW} słów, telegraficznie, po polsku.`,
            `Tablice: TYLKO nowe lub zmienione wpisy — nie kopiuj niezmienionych z MEM.`,
            `Pole "remove": obiekt z tablicami tekstów do usunięcia (np. {"p":["stary fakt"]}).`,
            `goals i charGoals: zwróć tylko nowe/zaktualizowane.`,
            'Bez duplikatów semantycznych. Nie wymyślaj faktów spoza wymiany.',
            'Nie zapisuj nagłówków sekcji (### TYTUŁ:, ALL CAPS) — tylko fakty.',
            'JSON: profile,goals,memories,charProfile,charGoals,charMemories,remove.',
        ],
    },
    en: {
        langNote:     'Values in English.',
        memLegend:    'p=user profile, g=goals, m=memories, cp/cg/cm=character',
        charLabel:    'Character',
        seedIntro:    'Fill 3 JSON keys from character definition. JSON only.',
        seedIntroFull:'Extract from character details only — facts, goals, and memories explicitly present in the text below.',
        seedRules: [
            'Source: Character details only — NOT scenario, NOT prompt instructions.',
            'charProfile — traits, relationships, preferences, appearance, job, etc. explicitly described in the bio.',
            'charGoals — only goals/motivations stated directly in the bio (empty array if none).',
            'charMemories — only past events/backstory from bio (e.g. MEMORIES, PAST, SECOND LIFE sections). Do NOT mix with charProfile.',
            'One distinct fact from the text = one item. Do not merge unrelated information.',
            'Extract ALL facts from the bio — do not skip entries. Empty array only when category truly absent.',
            'Do NOT treat section headers as facts (e.g. ### SECOND LIFE:, APPEARANCE:, ALL CAPS labels with colon). Skip bare headers; extract content after headers separately.',
            'For label + list (e.g. "Character likes:" then "Sleep", "Food") each item must keep label context — e.g. "Character likes sleep", NOT bare "Sleep".',
            'An empty array is correct when the bio has nothing for that category.',
        ],
        updateIntro:  'Memory extraction. JSON only, no markdown.',
        exchange:     'Exchange',
        firstMeet:    ' (first meeting)',
        rules: (maxW, ultra) => ultra ? [
            `New/changed items: max ${maxW} words, telegraphic.`,
            `Return ONLY new/changed items — do not repeat unchanged MEM entries.`,
            `Contradictions → "remove": {"p":["exact text"],...}.`,
            `goals/charGoals: new/updated only.`,
            'No semantic duplicates. Do not invent facts beyond the exchange.',
            'Keys: profile,goals,memories,charProfile,charGoals,charMemories,remove.',
        ] : [
            `Items: max ${maxW} words, telegraphic, English.`,
            `Arrays: ONLY new or changed items — skip unchanged MEM entries.`,
            `"remove" object with text arrays to delete (e.g. {"p":["old fact"]}).`,
            `goals & charGoals: new/updated only.`,
            'No semantic duplicates. Do not invent facts beyond the exchange.',
            'Do not store section headers (### TITLE:, ALL CAPS) — facts only.',
            'JSON: profile,goals,memories,charProfile,charGoals,charMemories,remove.',
        ],
    },
};

export function buildMemoryUpdatePrompt(lang, existing, character, recentMessages, userMsg, aiMsg, { ultra = false } = {}) {
    const L         = COPY[lang] || COPY.pl;
    const maxWords  = ultra ? 8 : 12;
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

    const rules = L.rules(maxWords, ultra).map((r, i) => `${i + 1}. ${r}`).join('\n');

    return `${L.updateIntro} ${L.langNote}
${charLine}
MEM (${L.memLegend}): ${memJson}
${L.exchange}${isFirst ? L.firstMeet : ''}:
${exchange}

${rules}`;
}

export function buildMemorySeedPrompt(lang, character, { ultra = false, seed = false } = {}) {
    const L           = COPY[lang] || COPY.pl;
    const detailsMax  = seed ? 14000 : (ultra ? 400 : 600);
    const isPl        = lang === 'pl';
    const intro       = seed ? (L.seedIntroFull || L.seedIntro) : L.seedIntro;
    const rules       = (seed ? L.seedRules : null) || [
        isPl
            ? 'Wyciągnij tylko to, co jest w opisie postaci. Nie wymyślaj. Pusta tablica OK.'
            : 'Extract only what is in character details. Do not invent. Empty arrays OK.',
    ];

    return `${intro} ${L.langNote}
${L.charLabel}: ${character.name}
${isPl ? 'Szczegółowy opis postaci' : 'Character details'}: ${trunc(character.characterDetails || '-', detailsMax)}

${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}
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
