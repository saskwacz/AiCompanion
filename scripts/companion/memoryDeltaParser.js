/**
 * Normalize memory LLM output to { add, update, remove }.
 * Accepts companion delta format and legacy profile/charProfile arrays.
 */

import { extractJson } from './prompts/renderer.js';
import { isSectionHeader } from '../providers/memory-prompt-shared.js';

function toItems(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(x => (typeof x === 'string' ? x : x?.content || x?.text)).filter(Boolean);
}

function inferTags(text, type = 'fact') {
    if (/\b(user|użytkownik|użytkownika|user's| jego | jej )\b/i.test(text)) {
        return type === 'event' ? ['memories'] : ['profile'];
    }
    if (type === 'event') return ['memories'];
    if (type === 'preference') return ['goals'];
    return ['profile'];
}

function normalizeAddItem(item) {
    if (!item?.content && !item?.text) return null;
    const content = String(item.content || item.text).trim();
    if (!content || isSectionHeader(content)) return null;
    const type = item.type || 'fact';
    return {
        type,
        content,
        importance: item.importance ?? 0.6,
        confidence: item.confidence ?? 0.8,
        tags: Array.isArray(item.tags) && item.tags.length ? item.tags : inferTags(content, type),
        validity: item.validity || 'long_term',
    };
}

function normalizeUpdateItem(item) {
    if (!item?.memory_id) return null;
    return {
        memory_id: item.memory_id,
        content:      item.content ?? undefined,
        importance:   item.importance ?? undefined,
        confidence:   item.confidence ?? undefined,
        type:         item.type ?? undefined,
    };
}

/**
 * @param {unknown} raw — parsed JSON or string from LLM
 * @returns {{ add: object[], update: object[], remove: string[] }}
 */
export function parseMemoryDelta(raw) {
    const parsed = typeof raw === 'object' && raw !== null ? raw : extractJson(raw);
    if (!parsed) return { add: [], update: [], remove: [] };

    if (Array.isArray(parsed.add) || Array.isArray(parsed.update) || Array.isArray(parsed.remove)) {
        return {
            add:    (parsed.add || []).map(normalizeAddItem).filter(Boolean),
            update: (parsed.update || []).map(normalizeUpdateItem).filter(Boolean),
            remove: (parsed.remove || []).filter(id => typeof id === 'string' && id.length),
        };
    }

    const legacyMap = [
        { keys: ['profile'], type: 'fact', tags: ['profile'] },
        { keys: ['goals'], type: 'preference', tags: ['goals'] },
        { keys: ['memories'], type: 'event', tags: ['memories'] },
        { keys: ['charProfile'], type: 'fact', tags: ['charProfile'] },
        { keys: ['charGoals'], type: 'preference', tags: ['charGoals'] },
        { keys: ['charMemories'], type: 'event', tags: ['charMemories'] },
    ];

    const add = [];
    for (const { keys, type, tags } of legacyMap) {
        for (const key of keys) {
            for (const text of toItems(parsed[key])) {
                add.push(normalizeAddItem({ type, content: text, tags }));
            }
        }
    }

    const remove = [];
    if (parsed.remove && typeof parsed.remove === 'object') {
        for (const ids of Object.values(parsed.remove)) {
            if (Array.isArray(ids)) remove.push(...ids.filter(x => typeof x === 'string'));
        }
    }

    return { add: add.filter(Boolean), update: [], remove };
}
