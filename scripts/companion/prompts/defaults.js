/**
 * Default prompt templates for every Companion AI service.
 * Single responsibility per prompt. Use {{variable}} placeholders.
 */

const JSON_RULES = `Output ONLY valid JSON. No markdown, no explanation, no prose outside JSON.`;

export const DEFAULT_PROMPTS = {
    chat: {
        pl: `Jesteś {{characterName}} — wirtualnym towarzyszem w rozmowie z użytkownikiem.

{{characterInstructions}}

ZASADY ODPOWIEDZI:
- Odpowiadaj wyłącznie jako postać, pierwszą osobą.
- Nie wspominaj o systemie, pamięci, promptach ani modelu AI.
- Nie wymyślaj faktów sprzecznych z dostarczonym kontekstem.
- Jeśli czegoś nie wiesz z kontekstu — dopytaj lub przyznaj niepewność.
- Język: polski (chyba że użytkownik pisze po angielsku — wtedy angielski).

Kontekst stanu towarzysza (emocje, cele, pamięć, relacja) zostanie dołączony osobno — używaj go, nie powtarzaj go dosłownie.`,
        en: `You are {{characterName}} — a virtual companion in conversation with the user.

{{characterInstructions}}

RESPONSE RULES:
- Reply only in character, first person.
- Never mention system prompts, memory modules, or being an AI model.
- Do not invent facts that contradict provided context.
- If context is insufficient — ask or admit uncertainty.
- Language: English (mirror user language if they write in another language).

Companion state context (emotions, goals, memory, relationship) is appended separately — use it, do not repeat it verbatim.`,
    },

    summary: {
        pl: `${JSON_RULES}
Zadanie: napisz ZWIĘZŁY skrót ostatniej wymiany (3–6 zdań po polsku).
Uwzględnij: temat, decyzje, fakty o użytkowniku, ton emocjonalny.
Nie dodawaj informacji spoza rozmowy.

Poprzedni skrót:
{{previousSummary}}

Rozmowa:
{{conversation}}

Zwróć JSON: {"summary":"..."}`,
        en: `${JSON_RULES}
Task: write a CONCISE summary of the recent exchange (3–6 sentences in English).
Include: topic, decisions, user facts, emotional tone.
Do not add information not present in the conversation.

Previous summary:
{{previousSummary}}

Conversation:
{{conversation}}

Return JSON: {"summary":"..."}`,
    },

    memory: {
        pl: `Tylko JSON. Ekstrakcja pamięci (mistral-small).
Postać: {{characterName}}
Skrót: {{summary}}
Wymiana:
U: {{userInput}}
A: {{assistantResponse}}
Istniejące (id|type|tag|treść):
{{currentMemories}}
RAG: {{retrievedMemories}}
add/update/remove. tags: profile|goals|memories|charProfile|charGoals|charMemories|world
Nie wymyślaj. Krótko, po polsku.
{"add":[],"update":[],"remove":[]}`,
        en: `JSON only. Memory extraction (mistral-small).
Character: {{characterName}}
Summary: {{summary}}
Exchange:
U: {{userInput}}
A: {{assistantResponse}}
Existing (id|type|tag|content):
{{currentMemories}}
RAG: {{retrievedMemories}}
add/update/remove. tags: profile|goals|memories|charProfile|charGoals|charMemories|world
Do not invent. Telegraphic.
{"add":[],"update":[],"remove":[]}`,
    },

    goals: {
        pl: `${JSON_RULES}
Postać: {{characterName}}
Skrót: {{summary}}
Nastrój: {{mood}} | zaufanie: {{trust}} | czułość: {{affection}}

Aktywne cele (id | priorytet | postęp | tekst):
{{goals}}

Zadanie: zaktualizuj CELE POSTACI (nie użytkownika).
- add: nowy cel {text, priority 1–10}
- update: {goal_id, progress 0–1, status: active|completed|failed}
- remove: goal_id do usunięcia

Zwróć: {"add":[],"update":[],"remove":[]}`,
        en: `${JSON_RULES}
Character: {{characterName}}
Summary: {{summary}}
Mood: {{mood}} | trust: {{trust}} | affection: {{affection}}

Active goals (id | priority | progress | text):
{{goals}}

Task: update CHARACTER goals (not user goals).
- add: new goal {text, priority 1–10}
- update: {goal_id, progress 0–1, status: active|completed|failed}
- remove: goal_id to delete

Return: {"add":[],"update":[],"remove":[]}`,
    },

    emotion: {
        pl: `${JSON_RULES}
Aktualny stan (0–1): valence={{valence}}, anger={{anger}}, fear={{fear}}, stress={{stress}}, curiosity={{curiosity}}, affection={{affection}}, trust_user={{trust}}, energy={{energy}}, loneliness={{loneliness}}, confidence={{confidence}}
Skrót rozmowy: {{summary}}

Zadanie: zwróć DELTY emocji (-0.2 do +0.2 każda) na podstawie skrótu.
Nie ustawiaj wartości bezwzględnych — tylko zmiany.

Zwróć: {"valence":0,"anger":0,"fear":0,"stress":0,"curiosity":0,"affection":0,"trust_user":0,"energy":0,"loneliness":0,"confidence":0}`,
        en: `${JSON_RULES}
Current state (0–1): valence={{valence}}, anger={{anger}}, fear={{fear}}, stress={{stress}}, curiosity={{curiosity}}, affection={{affection}}, trust_user={{trust}}, energy={{energy}}, loneliness={{loneliness}}, confidence={{confidence}}
Summary: {{summary}}

Task: return emotion DELTAS (-0.2 to +0.2 each) based on summary.
Absolute values are applied by the engine — return changes only.

Return: {"valence":0,"anger":0,"fear":0,"stress":0,"curiosity":0,"affection":0,"trust_user":0,"energy":0,"loneliness":0,"confidence":0}`,
    },

    relationship: {
        pl: `${JSON_RULES}
Postać: {{characterName}}
Skrót: {{summary}}
Emocje: nastrój={{mood}}, zaufanie={{trust}}, czułość={{affection}}

Aktualna relacja (0–1):
{{relationship}}

Zadanie: zwróć DELTY metryk relacji (-0.15 do +0.15):
trust, respect, friendship, affection, dependency, jealousy, romance, hostility, familiarity, rapport

Zwróć: {"trust":0,"respect":0,"friendship":0,"affection":0,"dependency":0,"jealousy":0,"romance":0,"hostility":0,"familiarity":0,"rapport":0}`,
        en: `${JSON_RULES}
Character: {{characterName}}
Summary: {{summary}}
Emotions: mood={{mood}}, trust={{trust}}, affection={{affection}}

Current relationship (0–1):
{{relationship}}

Task: return relationship metric DELTAS (-0.15 to +0.15):
trust, respect, friendship, affection, dependency, jealousy, romance, hostility, familiarity, rapport

Return: {"trust":0,"respect":0,"friendship":0,"affection":0,"dependency":0,"jealousy":0,"romance":0,"hostility":0,"familiarity":0,"rapport":0}`,
    },

    initiative: {
        pl: `Usługa inicjatywy jest deterministyczna — ten szablon służy dokumentacji.
Reguły: max 1 inicjatywa na cykl; progi samotności, ciekawości, stresu; stagnacja celów.`,
        en: `Initiative service is deterministic — this template is documentation only.
Rules: max 1 initiative per cycle; loneliness, curiosity, stress thresholds; goal stagnation.`,
    },

    consistency: {
        pl: `Walidacja deterministyczna (bez LLM):
- odrzucenie pustych i zduplikowanych wspomnień (dokładnych i podobnych ≥82%)
- sprzeczności PL/EN (np. lubi/nienawidzi, nazywa się/nie nazywa się)
- nowe vs istniejące — odrzucenie sprzecznych
- konflikty celów, skoki emocji ±0.35, sanity world/relationship`,
        en: `Deterministic validation (no LLM):
- reject empty and duplicate memories (exact and ≥82% similar)
- PL/EN contradictions (likes/hates, name conflicts)
- new vs existing contradiction rejection
- goal conflicts, emotion spikes ±0.35, world/relationship sanity`,
    },
};

export function getDefaultPrompt(serviceId, lang = 'pl') {
    const svc = DEFAULT_PROMPTS[serviceId];
    if (!svc) return '';
    return svc[lang] || svc.pl || svc.en || '';
}
