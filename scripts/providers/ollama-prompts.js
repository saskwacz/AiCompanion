/**
 * Prompt builders for the Ollama provider.
 *
 * Key differences from gemini-prompts.js:
 *
 * CHAT (llama3.1:8b)
 *   - System prompt kept tight — no redundant boilerplate.
 *   - Memory injected as a compact bullet block, not a verbose header.
 *   - Conversation history trimmed more aggressively (smaller context window).
 *
 * MEMORY (qwen3:8b)
 *   - Thinking tags stripped by parseMemoryJson before parsing.
 *   - Prompt written in English — qwen3 follows English instructions more
 *     reliably than Polish, but output values are still requested in Polish.
 *   - JSON schema repeated twice (before and after examples) for reliability.
 *   - No "thinkingBudget" option (not an Ollama param); thinking is natural.
 *
 * SUMMARY (phi3:mini)
 *   - Very short instruction — phi3-mini has a 4 K context window.
 *   - Previous summary folded in as a single compact paragraph.
 *   - Output requested in bullet form so the small model stays on-task.
 *
 * SHARED
 *   - selectChatMessages and trimMessagesByTokens are identical to the
 *     Gemini provider so the rest of the app can call either without changes.
 */

const TOKENS_PER_WORD = 1.3;

// ─── Shared utilities (also exported for re-use in gemini-prompts callers) ─────

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

export function selectChatMessages(messages, chatSummary, contextTokens) {
    let recent = chatSummary?.upToMessageCount != null
        ? messages.slice(chatSummary.upToMessageCount)
        : trimMessagesByTokens(messages, contextTokens);

    // Ensure history starts with a user turn (required by most chat models)
    while (recent.length > 0 && recent[0].role !== 'user') {
        recent = recent.slice(1);
    }
    return recent;
}

// ─── CHAT ──────────────────────────────────────────────────────────────────────

/**
 * Build the system prompt for a chat turn.
 * Appends the rolling summary as a compact block when present.
 */
export function buildOllamaChatSystemPrompt(systemPrompt, chatSummary) {
    if (!chatSummary?.text) return systemPrompt;
    return (
        systemPrompt +
        '\n\n[EARLIER CONVERSATION — use as background context]\n' +
        chatSummary.text
    );
}

/**
 * Convert app message array → Ollama /api/chat messages array.
 * Collapses consecutive same-role messages to avoid API errors.
 */
export function buildOllamaChatMessages(recentMessages) {
    const out = [];
    for (const m of recentMessages) {
        const role    = m.role === 'user' ? 'user' : 'assistant';
        const content = String(m.content);
        // Merge consecutive same-role turns (some models reject them)
        if (out.length > 0 && out[out.length - 1].role === role) {
            out[out.length - 1].content += '\n' + content;
        } else {
            out.push({ role, content });
        }
    }
    if (out.length === 0) {
        out.push({ role: 'user', content: '(continue the conversation)' });
    }
    return out;
}

/**
 * Build the full character system prompt.
 * Kept deliberately short — llama3.1:8b benefits from a clean, focused system.
 */
export function buildSystemPrompt(character, memCtx = '') {
    const parts = [];

    // Character prompt (core personality) always comes first
    if (character.prompt) parts.push(character.prompt);

    // Memory block — compact format for small context windows
    if (memCtx) {
        parts.push(
            '--- MEMORY ---\n' +
            memCtx
                .split('\n')
                .filter(l => l.trim())
                .join('\n') +
            '\n--- END MEMORY ---'
        );
    }

    if (character.scenario) {
        parts.push(`[Scene] ${character.scenario}`);
    }

    if (character.dialogueExamples) {
        parts.push(`[Example dialogue]\n${character.dialogueExamples}`);
    }

    return parts.join('\n\n').trim();
}

// ─── MEMORY ────────────────────────────────────────────────────────────────────

/**
 * Build a memory-update prompt for qwen3:8b.
 *
 * Design choices:
 * - Instructions in English for reliability, output values in Polish.
 * - JSON schema shown twice — once as a definition, once as an empty template
 *   so the model knows exactly what to fill in.
 * - Existing memory shown as compact JSON (same as Gemini version) so the
 *   model can preserve all existing items and add new ones.
 * - "RULES" block kept short to fit in qwen3's effective attention span.
 */
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

    const contextMsgs = isFirstExchange ? [] : allMessages.slice(-6, -2);
    const recentStr   = contextMsgs
        .map(m => `${m.role === 'user' ? 'User' : companionName}: ${m.content}`)
        .join('\n');

    const welcomeMsg  = character?.welcomeMessage;
    const exchangeStr = (isFirstExchange && welcomeMsg)
        ? `${companionName}: ${welcomeMsg}\nUser: ${userMsg}\n${companionName}: ${aiMsg}`
        : `User: ${userMsg}\n${companionName}: ${aiMsg}`;

    const charCtx = character
        ? [
            `CHARACTER NAME: ${character.name}`,
            character.scenario         ? `SCENARIO: ${character.scenario}`           : '',
            character.dialogueExamples ? `DIALOGUE EXAMPLES:\n${character.dialogueExamples}` : '',
          ].filter(Boolean).join('\n')
        : '';

    // JSON output schema (shown once as spec, once as empty template)
    const schema = `{
  "profile":      ["Polish string", ...],
  "goals":        ["Polish string", ...],
  "memories":     ["Polish string", ...],
  "charProfile":  ["Polish string", ...],
  "charGoals":    ["Polish string", ...],
  "charMemories": ["Polish string", ...]
}`;

    return `You are a memory extraction assistant for an AI companion named ${companionName}.
Output ONLY a single valid JSON object — no markdown, no explanation.
ALL string values must be written in POLISH.

OUTPUT SCHEMA:
${schema}

${charCtx ? `CHARACTER CONTEXT:\n${charCtx}\n` : ''}
CURRENT MEMORY (keep ALL existing items, only add / correct):
${existingStr}
${recentStr ? `\nRECENT CONTEXT:\n${recentStr}\n` : ''}
EXCHANGE TO ANALYSE${isFirstExchange ? ' (first meeting — analyse everything)' : ''}:
${exchangeStr}

RULES:
1. Return ALL existing memory items unchanged, then add new ones.
2. Remove an item ONLY if this exchange directly contradicts it.
3. Max 20 items per list — drop the least important when over limit.
4. Each item = one short sentence in Polish.
5. New items may optionally include "firstSeen" (ms since 1970-01-01 epoch).
   Preserve "firstSeen" on updated items.

Section definitions:
- profile      : user facts, preferences, personality, relationships
- goals        : user goals, wishes, plans
- memories     : shared memorable moments / events
- charProfile  : ${companionName}'s own facts, traits, preferences
- charGoals    : ${companionName}'s own goals and motivations
- charMemories : ${companionName}'s own significant memories

Respond with ONLY the JSON object matching the schema above.`;
}

/**
 * Build a memory-seeding prompt for a fresh character definition.
 * Shorter than the update prompt — only character-side sections needed.
 */
export function buildMemorySeedPrompt(character) {
    const schema = `{
  "charProfile":  ["Polish string", ...],
  "charGoals":    ["Polish string", ...],
  "charMemories": ["Polish string", ...]
}`;

    return `You are a knowledge extraction assistant for an AI character.
Output ONLY a single valid JSON object — no markdown, no explanation.
ALL string values must be written in POLISH.

OUTPUT SCHEMA:
${schema}

CHARACTER NAME: ${character.name}
PERSONALITY PROMPT: ${character.prompt || 'none'}
SCENARIO: ${character.scenario || 'none'}
CHARACTER DETAILS: ${character.characterDetails || 'none'}
DIALOGUE EXAMPLES:
${character.dialogueExamples || 'none'}

Extract ONLY from the above definition:
- charProfile  : facts, preferences, personality traits, appearance, backstory — max 15 short sentences
- charGoals    : motivations, goals, desires — max 10 short sentences
- charMemories : past events, formative experiences — max 10 short sentences

Each item = one short Polish sentence (no bullet symbols).
Respond with ONLY the JSON object. No other text.`;
}

// ─── SUMMARY ───────────────────────────────────────────────────────────────────

/**
 * Build a summary prompt for phi3:mini.
 *
 * phi3-mini has a small context window (~4 K tokens) so:
 * - The instruction header is minimal.
 * - Previous summary is folded in as a short "Background" paragraph,
 *   not repeated verbatim, to leave room for the new conversation text.
 * - Output format is requested as numbered bullets so the small model
 *   stays focused and produces a predictable, scannable result.
 */
export function buildSummaryPrompt({ convText, charName, previousSummaryText }) {
    const background = previousSummaryText
        ? `BACKGROUND (from earlier in the conversation):\n${previousSummaryText}\n\n`
        : '';

    return `${background}Summarise the conversation below between a user and ${charName}.
Write clear, factual bullet points. Cover every important topic, fact about the user, key decision, and emotional moment. Be concise but complete — this summary replaces the full history.

CONVERSATION:
${convText}

SUMMARY (bullet points):`;
}
