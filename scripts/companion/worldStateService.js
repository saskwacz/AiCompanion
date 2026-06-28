import { defaultWorldState } from './readService.js';

/**
 * STEP 12 — World State Update.
 * Skips unless simulation / Game Master mode is enabled.
 * No writes.
 */

/** Initialize world state from character scenario text (chat creation). */
export function worldStateFromScenario(chatId, scenario) {
    const base = defaultWorldState(chatId);
    const text = String(scenario || '').trim();
    if (!text) return base;

    const world = {
        ...base,
        active_scene: text.length > 4000 ? `${text.slice(0, 3997)}…` : text,
    };

    const locPatterns = [
        /(?:lokalizacja|miejsce|scena|setting|location)\s*[:\-—]\s*([^\n.]{3,120})/i,
        /(?:^|\n)(?:w|we|na|in|at)\s+([A-ZĄĆĘŁŃÓŚŹŻ][^\n.]{2,100})/u,
    ];
    for (const re of locPatterns) {
        const m = text.match(re);
        if (m?.[1]?.trim()) {
            world.location = m[1].trim().slice(0, 120);
            break;
        }
    }

    if (!world.location || world.location === 'here') {
        const firstLine = text.split(/\r?\n/).find(l => l.trim().length >= 3)?.trim();
        world.location = firstLine && firstLine.length <= 120 ? firstLine : 'scena';
    }

    return world;
}

export function computeWorldStateUpdate(current, summary, character, { assistantResponse } = {}) {
    const world = { ...(current ?? defaultWorldState(current?.chatId)) };

    if (!world.is_simulation && !character?.isGameMaster && !character?.scenario?.includes('[GM]')) {
        world.time = new Date().toLocaleTimeString();
        return { world, skipped: true };
    }

    world.time = new Date().toLocaleTimeString();

    const text = `${summary || ''} ${assistantResponse || ''}`.toLowerCase();

    const locMatch = text.match(/(?:at|in|location:|lokalizacja:)\s*([a-ząćęłńóśźż0-9\s]{3,40})/i);
    if (locMatch) world.location = locMatch[1].trim();

    if (/\b(quest|mission|zadanie)\b/i.test(text)) {
        world.narrative_flags = [...(world.narrative_flags || []), { type: 'quest', at: Date.now() }];
    }

    return { world, skipped: false };
}
