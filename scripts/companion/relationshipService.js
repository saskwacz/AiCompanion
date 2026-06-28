import { defaultRelationship } from './readService.js';

/**
 * Relationship state — deterministic updates + delta application.
 */

export const RELATIONSHIP_KEYS = [
    'trust', 'respect', 'friendship', 'affection',
    'dependency', 'jealousy', 'romance', 'hostility',
    'familiarity', 'rapport',
];

function clamp01(n) {
    return Math.max(0, Math.min(1, Number(n) || 0));
}

export function computeRelationshipUpdate(current, summary, emotions) {
    const rel = normalizeRelationship(current);
    const text = (summary || '').toLowerCase();

    if (emotions.affection > 0.6) {
        rel.affection = clamp01(rel.affection + 0.03);
        rel.romance   = clamp01(rel.romance + 0.02);
    }
    if (emotions.trust_user > 0.55) {
        rel.trust      = clamp01(rel.trust + 0.04);
        rel.friendship = clamp01(rel.friendship + 0.02);
    }
    if (emotions.anger > 0.5) {
        rel.hostility = clamp01(rel.hostility + 0.05);
        rel.respect   = clamp01(rel.respect - 0.02);
    }
    if (emotions.valence > 0.6) rel.rapport = clamp01(rel.rapport + 0.03);

    if (/\b(thank|love|trust|dziękuj|kocham|ufam)\b/i.test(text)) {
        rel.trust      = clamp01(rel.trust + 0.05);
        rel.respect    = clamp01(rel.respect + 0.03);
        rel.friendship = clamp01(rel.friendship + 0.03);
    }
    if (/\b(angry|hate|leave|nienawid|wkurz)\b/i.test(text)) {
        rel.hostility = clamp01(rel.hostility + 0.06);
        rel.trust     = clamp01(rel.trust - 0.04);
    }

    rel.familiarity = clamp01(rel.familiarity + 0.01);
    rel.last_updated = Date.now();
    return rel;
}

export function applyRelationshipDelta(current, deltas) {
    const rel = normalizeRelationship(current);
    for (const key of RELATIONSHIP_KEYS) {
        if (deltas[key] !== undefined) {
            rel[key] = clamp01(rel[key] + Number(deltas[key]));
        }
    }
    rel.last_updated = Date.now();
    return rel;
}

export function normalizeRelationship(current) {
    const base = defaultRelationship(current?.chatId);
    const rel = { ...base, ...(current || {}) };
    for (const key of RELATIONSHIP_KEYS) {
        rel[key] = clamp01(rel[key] ?? base[key] ?? 0.3);
    }
    return rel;
}

export function applyRelationshipDecay(relationship) {
    const rel = normalizeRelationship(relationship);
    rel.hostility  = clamp01(rel.hostility * 0.95);
    rel.jealousy   = clamp01(rel.jealousy * 0.97);
    rel.rapport    = clamp01(rel.rapport * 0.998 + 0.5 * 0.002);
    rel.dependency = clamp01(rel.dependency * 0.99);
    rel.last_updated = Date.now();
    return rel;
}

export function relationshipScore(relationship) {
    const r = normalizeRelationship(relationship);
    const positive = r.trust + r.respect + r.friendship + r.affection + r.rapport + r.familiarity;
    const negative = r.hostility + r.jealousy + r.dependency * 0.5;
    return clamp01((positive / 6) - (negative / 3) * 0.3);
}
