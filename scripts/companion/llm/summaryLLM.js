import { callSummaryAPI } from '../../providers/index.js';
import { retryOnce } from '../retryOnce.js';
import { buildPrompt } from '../prompts/promptConfigService.js';
import { extractJson } from '../prompts/renderer.js';

/** STEP 7 — Summary LLM. Returns summary text only. No writes. */

function formatConversation(messages) {
    return (messages || []).slice(-10).map(m =>
        `${m.role}: ${(m.content || '').slice(0, 400)}`
    ).join('\n');
}

export async function runSummaryLLM(summaryCfg, summaryTask, { character, messages, previousSummary, lang = 'pl' }) {
    const chatConfig = summaryCfg.chatConfig || {};
    const prompt = buildPrompt(chatConfig, 'summary', {
        previousSummary: previousSummary || '(none)',
        conversation:    formatConversation(messages),
    }, lang);

    const result = await retryOnce(
        () => callSummaryAPI(summaryCfg, {
            prompt,
            maxOutputTokens: summaryTask.maxTokens ?? 1024,
        }),
        { label: 'Summary LLM', fallback: null },
    );

    if (result.ok && result.value) {
        const parsed = extractJson(result.value);
        if (parsed?.summary) return parsed.summary;
        if (typeof result.value === 'string') return result.value.trim();
    }

    const recent = (messages || []).slice(-4);
    return recent.map(m => `${m.role}: ${m.content.slice(0, 120)}`).join(' | ')
        || previousSummary
        || '';
}
