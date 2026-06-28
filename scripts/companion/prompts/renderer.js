/**
 * Simple {{variable}} template renderer for prompts.
 */

export function renderPrompt(template, vars = {}) {
    if (!template) return '';
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        const val = vars[key];
        return val === undefined || val === null ? '' : String(val);
    });
}

export function extractJson(text) {
    if (!text) return null;
    if (typeof text === 'object') return text;
    const match = String(text).match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch { return null; }
}
