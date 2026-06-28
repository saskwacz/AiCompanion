import { readContextBundle, readInitiativeMeta } from './readService.js';
import { commitIdleUpdates, buildSummaryRecord, recordUserActivity } from './persistenceService.js';
import { applyDecay } from './emotionService.js';
import { applyRelationshipDecay } from './relationshipService.js';
import { evaluateInitiative } from './initiativeService.js';
import { detectStagnantGoals } from './goalService.js';
import { IDLE_INTERVAL_MS } from './types.js';

/**
 * STEP 17 — Idle events (optional background tick).
 * Runs when no user interaction for configurable time.
 */

let _idleTimer = null;
let _lastChatId = null;

export function startIdleWatcher(chatId, onInitiative = null) {
    stopIdleWatcher();
    _lastChatId = chatId;
    _idleTimer = setInterval(() => runIdleCycle(chatId, onInitiative), IDLE_INTERVAL_MS);
}

export function stopIdleWatcher() {
    if (_idleTimer) {
        clearInterval(_idleTimer);
        _idleTimer = null;
    }
}

async function runIdleCycle(chatId, onInitiative) {
    const meta = await readInitiativeMeta(chatId);
    const idleMs = Date.now() - (meta.last_user_message_at || Date.now());
    if (idleMs < IDLE_INTERVAL_MS) return;

    const snapshot = await readContextBundle(chatId);
    const emotion = applyDecay(snapshot.emotions);
    const relationship = applyRelationshipDecay(snapshot.relationship);

    const stagnant = detectStagnantGoals(snapshot.goals);
    if (stagnant.length) {
        stagnant[0].updated_at = Date.now();
    }

    await commitIdleUpdates({
        emotion: { ...emotion, last_updated: Date.now() },
        relationship,
        goalsPut: snapshot.goals,
        summary: snapshot.summary ?? buildSummaryRecord(chatId, '', []),
        memoriesPut: snapshot.memories,
        world: snapshot.world,
    });

    const initiative = evaluateInitiative(chatId, {
        emotion,
        goals: snapshot.goals,
        memories: snapshot.memories,
        meta,
    });

    if (initiative && onInitiative) onInitiative(initiative);
}

export { recordUserActivity };
