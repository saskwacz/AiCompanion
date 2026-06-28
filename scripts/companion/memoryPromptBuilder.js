/**
 * Compact memory-extraction prompts optimized for mistral-small.
 * No IndexedDB — receives pre-processed context only.
 */

function trunc(s, max) {
    const t = String(s || '').trim();
    if (!t) return '';
    return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function formatMemoriesCompact(memories, maxItems = 24, contentMax = 100) {
    return (memories || []).slice(0, maxItems).map(m => {
        const tag = (m.tags || [])[0] || m.type || '?';
        return `${m.memory_id}|${m.type}|${tag}|${trunc(m.content, contentMax)}`;
    }).join('\n') || '(empty)';
}

function formatRetrievedCompact(retrieved, maxItems = 5, contentMax = 80) {
    return (retrieved || []).slice(0, maxItems).map(m =>
        `- [${(m.tags || [])[0] || m.type}] ${trunc(m.content, contentMax)}`,
    ).join('\n') || '(none)';
}

const RULES = {
    pl: [
        'Tylko JSON. Bez markdown.',
        'Źródło: ostatnia wymiana + skrót — NIE wymyślaj faktów.',
        'add: nowe wpisy {type, content, importance, confidence, tags}',
        'update: {memory_id, content?, importance?, confidence?}',
        'remove: [memory_id, ...]',
        'type: fact|event|preference|relationship|rule',
        'tags: profile|goals|memories|charProfile|charGoals|charMemories|world',
        'char* = fakty postaci, profile/memories = użytkownik, world = świat',
        'charProfile = cechy/preferencje; charMemories = przeszłość/wydarzenia — NIE mieszaj.',
        'Nie zapisuj nagłówków sekcji opisu (### TYTUŁ:, ALL CAPS) — tylko treść faktów.',
        'Krótko (≤12 słów), po polsku. Puste tablice OK.',
    ],
    en: [
        'JSON only. No markdown.',
        'Source: last exchange + summary — do not invent facts.',
        'add: {type, content, importance, confidence, tags}',
        'update: {memory_id, content?, importance?, confidence?}',
        'remove: [memory_id, ...]',
        'type: fact|event|preference|relationship|rule',
        'tags: profile|goals|memories|charProfile|charGoals|charMemories|world',
        'char* = character, profile/memories = user, world = world',
        'charProfile = traits/preferences; charMemories = past/events — do not mix.',
        'Do not store bio section headers (### TITLE:, ALL CAPS) — facts only.',
        'Telegraphic (≤12 words). Empty arrays OK.',
    ],
};

/**
 * @param {object} ctx
 * @param {string} [lang]
 * @returns {string}
 */
export function buildMemoryExtractionPrompt(ctx, lang = 'pl') {
    const pl = lang !== 'en';
    const name = ctx.character?.name || 'Companion';
    const rules = (RULES[pl ? 'pl' : 'en']).map((r, i) => `${i + 1}. ${r}`).join('\n');

    const exchange = [
        ctx.userInput ? `U: ${trunc(ctx.userInput, 500)}` : '',
        ctx.assistantResponse ? `A: ${trunc(ctx.assistantResponse, 500)}` : '',
    ].filter(Boolean).join('\n') || (pl ? '(brak)' : '(none)');

    return `${pl ? 'Ekstrakcja pamięci' : 'Memory extraction'}. ${pl ? 'Tylko JSON.' : 'JSON only.'}

${pl ? 'Postać' : 'Character'}: ${name}
${pl ? 'Skrót' : 'Summary'}: ${trunc(ctx.summary, 600)}

${pl ? 'Wymiana' : 'Exchange'}:
${exchange}

${pl ? 'Istniejące' : 'Existing'} (id|type|tag|content):
${formatMemoriesCompact(ctx.memories)}

RAG:
${formatRetrievedCompact(ctx.retrieved)}

${rules}

{"add":[],"update":[],"remove":[]}`;
}
