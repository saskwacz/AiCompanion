/**

 * Deterministic consistency validation before IndexedDB writes.

 * NO narrative generation — pure rule-based checks only.

 */

import { isSectionHeader } from '../providers/memory-prompt-shared.js';



function norm(s) {

    return (s || '').toLowerCase().trim().replace(/\s+/g, ' ');

}



function clamp01(n) {

    return Math.max(0, Math.min(1, Number(n) || 0));

}



function jaccard(a, b) {

    const wa = new Set(a.split(/\s+/).filter(w => w.length > 2));

    const wb = new Set(b.split(/\s+/).filter(w => w.length > 2));

    if (!wa.size || !wb.size) return 0;

    let inter = 0;

    for (const w of wa) if (wb.has(w)) inter++;

    const union = wa.size + wb.size - inter;

    return union === 0 ? 0 : inter / union;

}



function isNearDuplicate(a, b, threshold = 0.82) {

    const na = norm(a);

    const nb = norm(b);

    if (!na || !nb) return false;

    if (na === nb) return true;

    if (na.includes(nb) || nb.includes(na)) return true;

    return jaccard(na, nb) >= threshold;

}



/**

 * @param {{

 *   memories?: import('./types.js').MemoryRecord[],

 *   existingMemories?: import('./types.js').MemoryRecord[],

 *   emotion?: import('./types.js').EmotionState,

 *   previousEmotion?: import('./types.js').EmotionState,

 *   goals?: import('./types.js').GoalRecord[],

 *   world?: import('./types.js').WorldState,

 *   relationship?: import('./types.js').RelationshipState,

 * }} input

 * @returns {import('./types.js').ConsistencyResult}

 */

export function validateBeforeWrite(input) {

    const conflicts = [];

    const fixes = [];

    const rejected = [];

    const merged = [];



    const pending = [...(input.memories || [])];

    const existing = input.existingMemories || [];

    const accepted = [];



    const existingNorms = new Set(existing.map(m => norm(m.content)));



    for (const mem of pending) {

        const n = norm(mem.content);

        if (!n) {

            rejected.push(mem.memory_id);

            conflicts.push(`Empty memory rejected: ${mem.memory_id}`);

            continue;

        }



        if (isSectionHeader(mem.content)) {

            rejected.push(mem.memory_id);

            conflicts.push(`Section header rejected: ${mem.content.slice(0, 60)}`);

            continue;

        }



        const exactDup = existing.find(e => norm(e.content) === n);

        if (exactDup) {

            rejected.push(mem.memory_id);

            merged.push(exactDup.memory_id);

            conflicts.push(`Duplicate of existing: ${mem.content.slice(0, 60)}`);

            continue;

        }



        const nearExisting = existing.find(e => isNearDuplicate(e.content, mem.content));

        if (nearExisting) {

            rejected.push(mem.memory_id);

            merged.push(nearExisting.memory_id);

            conflicts.push(`Near-duplicate of existing: ${mem.content.slice(0, 60)}`);

            continue;

        }



        const nearAccepted = accepted.find(a => isNearDuplicate(a.content, mem.content));

        if (nearAccepted) {

            rejected.push(mem.memory_id);

            merged.push(nearAccepted.memory_id);

            if ((mem.importance ?? 0) > (nearAccepted.importance ?? 0)) {

                nearAccepted.importance = mem.importance;

                nearAccepted.confidence = Math.max(nearAccepted.confidence ?? 0, mem.confidence ?? 0);

                fixes.push(`Merged batch duplicate; kept higher importance: ${nearAccepted.content.slice(0, 50)}`);

            }

            continue;

        }



        if (existingNorms.has(n)) {

            rejected.push(mem.memory_id);

            continue;

        }



        existingNorms.add(n);

        accepted.push(sanitizeMemory(mem));

    }



    for (let i = 0; i < accepted.length; i++) {

        for (let j = i + 1; j < accepted.length; j++) {

            if (!isContradictory(accepted[i].content, accepted[j].content)) continue;

            conflicts.push(`Contradiction: "${accepted[i].content.slice(0, 40)}" vs "${accepted[j].content.slice(0, 40)}"`);

            const keep = (accepted[i].confidence ?? 0) >= (accepted[j].confidence ?? 0) ? accepted[i] : accepted[j];

            const drop = keep === accepted[i] ? accepted[j] : accepted[i];

            rejected.push(drop.memory_id);

            fixes.push(`Rejected lower-confidence contradictory memory: ${drop.memory_id}`);

            accepted.splice(accepted.indexOf(drop), 1);

            j--;

        }

    }



    // Check new memories against existing for contradictions

    for (const mem of accepted) {

        for (const ex of existing) {

            if (!isContradictory(mem.content, ex.content)) continue;

            conflicts.push(`Contradicts existing: "${mem.content.slice(0, 40)}" vs "${ex.content.slice(0, 40)}"`);

            rejected.push(mem.memory_id);

            fixes.push(`Rejected new memory contradicting ${ex.memory_id}`);

            const idx = accepted.indexOf(mem);

            if (idx >= 0) accepted.splice(idx, 1);

            break;

        }

    }



    if (input.emotion) {

        const e = sanitizeEmotion(input.emotion);

        for (const key of ['anger', 'fear', 'stress', 'affection', 'trust_user']) {

            const prev = input.previousEmotion?.[key];

            if (prev !== undefined && Math.abs(e[key] - prev) > 0.35) {

                conflicts.push(`Emotional spike on ${key}: ${prev.toFixed(2)} → ${e[key].toFixed(2)}`);

                e[key] = clamp01(prev + Math.sign(e[key] - prev) * 0.35);

                fixes.push(`Capped ${key} delta to ±0.35 per cycle`);

            }

        }

        input.emotion = e;

    }



    if (input.goals?.length) {

        const active = input.goals.filter(g => g.status === 'active');

        for (let i = 0; i < active.length; i++) {

            for (let j = i + 1; j < active.length; j++) {

                if (isOpposingGoals(active[i].text, active[j].text)) {

                    conflicts.push(`Goal conflict: "${active[i].text.slice(0, 40)}" vs "${active[j].text.slice(0, 40)}"`);

                    const loser = active[i].priority >= active[j].priority ? active[j] : active[i];

                    loser.status = 'failed';

                    fixes.push(`Auto-failed lower-priority conflicting goal: ${loser.goal_id}`);

                }

            }

        }

    }



    if (input.world) {

        if (typeof input.world.location !== 'string') {

            input.world.location = 'unknown';

            fixes.push('Reset invalid world.location to "unknown"');

        }

        if (!Array.isArray(input.world.entities)) {

            input.world.entities = [];

            fixes.push('Reset world.entities to empty array');

        }

        if (!Array.isArray(input.world.inventory)) {

            input.world.inventory = [];

            fixes.push('Reset world.inventory to empty array');

        }

    }



    let acceptedRelationship = input.relationship ?? null;

    if (acceptedRelationship) {

        acceptedRelationship = sanitizeRelationship(acceptedRelationship);

        const keys = ['trust', 'respect', 'friendship', 'affection', 'dependency',

            'jealousy', 'romance', 'hostility', 'familiarity', 'rapport'];

        for (const key of keys) {

            if (acceptedRelationship[key] !== undefined) {

                acceptedRelationship[key] = clamp01(acceptedRelationship[key]);

            }

        }

    }



    return {

        conflicts,

        fixes,

        rejected,

        merged,

        acceptedMemories: accepted,

        acceptedEmotion: input.emotion ?? null,

        acceptedGoals: input.goals ?? [],

        acceptedWorld: input.world ?? null,

        acceptedRelationship,

    };

}



function isContradictory(a, b) {

    const na = norm(a);

    const nb = norm(b);

    const pairs = [

        ['user\'s name is', 'user\'s name is not'],

        ['imię użytkownika', 'nie nazywa się'],

        ['nazywa się', 'nie nazywa się'],

        ['likes', 'hates'],

        ['lubi', 'nienawidzi'],

        ['is alive', 'is dead'],

        ['żyje', 'nie żyje'],

        ['married', 'single'],

        ['żonaty', 'kawaler'],

        ['ma ', ' nie ma '],

    ];

    for (const [p, q] of pairs) {

        if ((na.includes(p) && nb.includes(q)) || (na.includes(q) && nb.includes(p))) return true;

    }

    if (na.includes(' not ') && nb.replace(' not ', ' ') === na.replace(' not ', ' ')) return true;

    if (na.includes(' nie ') && nb.replace(' nie ', ' ') === na.replace(' nie ', ' ')) return true;

    return false;

}



function isOpposingGoals(a, b) {

    const na = norm(a);

    const nb = norm(b);

    return (na.includes('trust') && nb.includes('distance')) ||

           (na.includes('ufaj') && nb.includes(' dystans')) ||

           (na.includes('open') && nb.includes('secret')) ||

           (na.includes('otwórz') && nb.includes('tajemn'));

}



function sanitizeMemory(mem) {

    return {

        ...mem,

        importance: clamp01(mem.importance ?? 0.5),

        confidence: clamp01(mem.confidence ?? 0.8),

        entities: Array.isArray(mem.entities) ? mem.entities : [],

        tags: Array.isArray(mem.tags) ? mem.tags : [],

    };

}



function sanitizeRelationship(r) {

    return { ...r };

}



function sanitizeEmotion(e) {

    const out = { ...e };

    for (const key of ['valence', 'energy', 'stress', 'trust_user', 'affection', 'fear', 'anger', 'curiosity', 'loneliness', 'confidence']) {

        out[key] = clamp01(out[key]);

    }

    return out;

}

