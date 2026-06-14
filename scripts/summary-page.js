/**
 * summary-page.js — standalone summary page (summary.html)
 */

import { openDB }                                       from './db.js';
import { getChatById }                                  from './chats.js';
import { getCharacterById }                             from './characters.js';
import { getMessagesForChat }                           from './messages.js';
import { resolveChatConfig }                            from './chat-config.js';
import { getShuffledApiKeys }                           from './settings.js';
import { GEMINI_DEFAULTS }                              from './providers/gemini-models.js';
import {
    getSummaryState, saveSummaryState, deleteSummaryForChat,
    computeMedium, computeGlobal,
    isProhibitedContent, computeRollingFallback, computeChunkFallback,
    CHUNK_SIZE, MEDIUM_FROM_CHUNKS,
} from './summary.js';
import { escapeHtml, showToast }                        from './ui.js';

// ─── State ────────────────────────────────────────────────────────────────────
const params   = new URLSearchParams(window.location.search);
const chatId   = params.get('chatId') ? parseInt(params.get('chatId')) : null;
let chatData   = null;
let charData   = null;
let msgs       = [];
let sumState   = null;
let sumCfg     = null;
let maxTok     = 8192;
let building   = false;

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
    try {
        await openDB();
        if (!chatId) { setContent('<p class="error-text">Brak chatId w URL.</p>'); return; }

        chatData  = await getChatById(chatId);
        if (!chatData) { setContent('<p class="error-text">Czat nie znaleziony.</p>'); return; }

        charData  = await getCharacterById(chatData.characterId);
        msgs      = await getMessagesForChat(chatId);
        sumState  = await getSummaryState(chatId);

        const cfg = resolveChatConfig(chatData);
        sumCfg    = buildProviderCfg(cfg, 'summary');
        maxTok    = cfg.summary?.maxTokens ?? 8192;

        document.getElementById('page-title').textContent =
            `Podsumowanie — ${chatData.name || charData?.name || 'czat'}`;

        const needsBuild = checkNeedsBuild();
        if (needsBuild && msgs.length >= 2) {
            await runBuild();
        } else {
            render();
        }
    } catch (err) {
        console.error('[SummaryPage] Init error:', err);
        setContent(`<p class="error-text">Błąd: ${escapeHtml(err.message)}</p>`);
    }
}

// ─── Provider config builder ─────────────────────────────────────────────────
function buildProviderCfg(cfg, role) {
    const taskCfg = cfg[role] || GEMINI_DEFAULTS[role] || {};
    const provider = taskCfg.provider || 'gemini';
    const model    = provider === 'ollama'
        ? (taskCfg.ollamaModel || null)
        : (taskCfg.geminiModel || null);
    const modelFallback = provider === 'gemini'
        ? (taskCfg.geminiModelFallback || null)
        : null;
    return {
        provider,
        keys:         getShuffledApiKeys(cfg),
        ollamaUrl:    cfg.ollamaBaseUrl || 'http://localhost:11434',
        model,
        modelFallback,
        lang:         cfg.chatLang || 'pl',
    };
}

// ─── Staleness check ──────────────────────────────────────────────────────────
function checkNeedsBuild() {
    const prohibitedIds  = new Set(sumState.prohibitedMsgIds ?? []);
    const filteredMsgs   = msgs.filter(m => !prohibitedIds.has(m.id));
    const expectedChunks = Math.floor(filteredMsgs.length / CHUNK_SIZE);
    const missingChunks  = Math.max(0, expectedChunks - (sumState.chunks?.length ?? 0));

    let staleMediums = 0;
    if (sumState.medium?.length) {
        for (let i = 0; i < sumState.medium.length; i++) {
            const fromIdx = i * MEDIUM_FROM_CHUNKS;
            const toIdx   = Math.min(fromIdx + MEDIUM_FROM_CHUNKS - 1, (expectedChunks || sumState.chunks?.length) - 1);
            if (sumState.medium[i].toChunkAbs !== toIdx) staleMediums++;
        }
    }

    return !sumState.rolling
        || missingChunks > 0
        || staleMediums > 0
        || (Math.ceil((sumState.chunks?.length ?? 0) / MEDIUM_FROM_CHUNKS)) > (sumState.medium?.length ?? 0)
        || (sumState.medium?.length > 0 && !sumState.global);
}

// ─── Build ────────────────────────────────────────────────────────────────────
window.rebuildSummary = async function() {
    if (building) return;
    await runBuild();
};

window.clearSummary = async function() {
    if (!confirm('Wyczyścić całe podsumowanie dla tego czatu?')) return;
    try {
        await deleteSummaryForChat(chatId);
        sumState = await getSummaryState(chatId);
        render();
        showToast('Podsumowanie wyczyszczone', 'info');
    } catch (err) {
        showToast('Błąd: ' + err.message, 'error');
    }
};

async function runBuild() {
    building = true;
    document.getElementById('btn-rebuild').disabled = true;

    const newState = {
        chatId,
        rolling:         sumState.rolling ?? null,
        chunks:          [...(sumState.chunks ?? [])],
        medium:          [...(sumState.medium ?? [])],
        global:          sumState.global ?? null,
        prohibitedMsgIds: [...(sumState.prohibitedMsgIds ?? [])],
    };

    const prohibitedIds = new Set(newState.prohibitedMsgIds);
    const filteredMsgs  = msgs.filter(m => !prohibitedIds.has(m.id));

    try {
        // ── Rolling ──
        setContent(loadingHtml('Obliczam rolling summary…'));
        try {
            const r = await computeRollingFallback(msgs, charData, sumCfg, Math.min(maxTok, 4096));
            if (r) { newState.rolling = r; await saveSummaryState(newState); }
        } catch (e) {
            if (!isProhibitedContent(e)) throw e;
            console.warn('[SummaryPage] Rolling skipped — prohibited');
        }

        // ── L1 chunks ──
        const totalExpected = Math.floor(filteredMsgs.length / CHUNK_SIZE);
        for (let i = newState.chunks.length; i < totalExpected; i++) {
            setContent(loadingHtml(`Okno L1 ${i + 1} / ${totalExpected}…`));
            const slice = filteredMsgs.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
            const { chunks: fc, prohibited: np } =
                await computeChunkFallback(slice, charData, sumCfg, Math.min(maxTok, 4096));
            if (np.length) newState.prohibitedMsgIds = [...newState.prohibitedMsgIds, ...np];
            if (fc.length) { newState.chunks.push(fc[0]); await saveSummaryState(newState); }
        }

        // ── L2 mediums ──
        const totalChunks = newState.chunks.length;
        const neededMeds  = totalChunks > 0 ? Math.ceil(totalChunks / MEDIUM_FROM_CHUNKS) : 0;
        for (let i = 0; i < neededMeds; i++) {
            const fromIdx  = i * MEDIUM_FROM_CHUNKS;
            const toIdx    = Math.min(fromIdx + MEDIUM_FROM_CHUNKS - 1, totalChunks - 1);
            const existing = newState.medium[i];
            if (!existing || existing.toChunkAbs !== toIdx) {
                setContent(loadingHtml(`Podsumowanie L2 ${i + 1} / ${neededMeds}…`));
                try {
                    newState.medium[i] = await computeMedium(
                        newState.chunks.slice(fromIdx, toIdx + 1),
                        charData, sumCfg, Math.min(maxTok, 4096), fromIdx
                    );
                    await saveSummaryState(newState);
                } catch (e) {
                    if (!isProhibitedContent(e)) throw e;
                    console.warn(`[SummaryPage] L2 ${i + 1} skipped — prohibited`);
                }
            }
        }
        if (newState.medium.length > neededMeds) {
            newState.medium.length = neededMeds;
            await saveSummaryState(newState);
        }

        // ── L3 global ──
        if (neededMeds > 0) {
            setContent(loadingHtml('Podsumowanie globalne L3…'));
            try {
                newState.global = await computeGlobal(newState.medium, charData, sumCfg, maxTok);
                await saveSummaryState(newState);
            } catch (e) {
                if (!isProhibitedContent(e)) throw e;
                console.warn('[SummaryPage] L3 skipped — prohibited');
            }
        }

        sumState = newState;
        render();
        showToast('Podsumowanie gotowe', 'ok');
    } catch (err) {
        setContent(`<p class="error-text">Błąd generowania: ${escapeHtml(err.message)}</p>`);
        showToast('Błąd: ' + err.message, 'error');
    } finally {
        building = false;
        document.getElementById('btn-rebuild').disabled = false;
    }
}

// ─── Render ───────────────────────────────────────────────────────────────────
function render() {
    const state = sumState;
    const parts = [];

    if (state.rolling?.text) {
        parts.push(`<section class="sum-section">
            <h4 class="sum-tier-label">Rolling summary <span class="sum-tier-badge">ostatnie ~${CHUNK_SIZE} wiad.</span></h4>
            <pre class="sum-pre">${escapeHtml(state.rolling.text)}</pre>
        </section>`);
    }

    if (state.chunks?.length) {
        const html = state.chunks.map((c, i) =>
            `<details class="sum-chunk-detail">
                <summary class="sum-chunk-label">Okno ${i + 1} <span class="sum-chunk-range">(wiad. ${c.fromMsg ?? '?'}–${c.toMsg ?? '?'})</span></summary>
                <pre class="sum-pre sum-pre--secondary">${escapeHtml(c.text)}</pre>
            </details>`
        ).join('');
        parts.push(`<section class="sum-section">
            <h4 class="sum-tier-label">L1 — szczegółowe okna <span class="sum-tier-badge">${state.chunks.length} × ~${CHUNK_SIZE} wiad.</span></h4>
            ${html}
        </section>`);
    }

    if (state.medium?.length) {
        const html = state.medium.map((m, i) =>
            `<details class="sum-chunk-detail">
                <summary class="sum-chunk-label">Część ${i + 1} <span class="sum-chunk-range">(wiad. ${m.fromMsg ?? '?'}–${m.toMsg ?? '?'})</span></summary>
                <pre class="sum-pre sum-pre--secondary">${escapeHtml(m.text)}</pre>
            </details>`
        ).join('');
        parts.push(`<section class="sum-section">
            <h4 class="sum-tier-label">L2 — podsumowania pośrednie <span class="sum-tier-badge">${state.medium.length} × ~${CHUNK_SIZE * MEDIUM_FROM_CHUNKS} wiad.</span></h4>
            ${html}
        </section>`);
    }

    if (state.global?.text) {
        parts.push(`<section class="sum-section">
            <h4 class="sum-tier-label">L3 — globalna historia <span class="sum-tier-badge">całość</span></h4>
            <pre class="sum-pre">${escapeHtml(state.global.text)}</pre>
        </section>`);
    }

    if (state.prohibitedMsgIds?.length) {
        const prohibitedSet = new Set(state.prohibitedMsgIds);
        const prohibitedMsgs = msgs.filter(m => prohibitedSet.has(m.id));

        const rowsHtml = prohibitedMsgs.length
            ? prohibitedMsgs.map(m => {
                const role    = m.role === 'user' ? 'Użytkownik' : 'AI';
                const preview = m.content ? escapeHtml(m.content.slice(0, 300)) + (m.content.length > 300 ? '…' : '') : '<em>brak treści</em>';
                const time    = m.timestamp ? new Date(m.timestamp).toLocaleString() : '';
                return `<div class="prohibited-msg-row">
                    <div class="prohibited-msg-meta">
                        <span class="prohibited-msg-role ${m.role === 'user' ? 'role-user' : 'role-ai'}">${role}</span>
                        <span class="prohibited-msg-seq">#${m.seqId ?? m.id}</span>
                        <span class="prohibited-msg-time">${time}</span>
                    </div>
                    <div class="prohibited-msg-content">${preview}</div>
                </div>`;
            }).join('')
            : `<p class="field-hint" style="padding:8px 0">Identyfikatory: ${state.prohibitedMsgIds.join(', ')}</p>`;

        parts.push(`<section class="sum-section">
            <h4 class="sum-tier-label sum-tier-label--warn">&#9888; Wiadomości wykluczone z podsumowania <span class="sum-tier-badge">${state.prohibitedMsgIds.length}</span></h4>
            <p class="field-hint" style="margin-bottom:10px">Te wiadomości spowodowały błąd <em>prohibited content</em> i są pomijane przy obliczaniu L1.</p>
            <div class="prohibited-msg-list">${rowsHtml}</div>
        </section>`);
    }

    if (!parts.length) {
        parts.push(`<p style="color:var(--text-secondary);font-style:italic;padding:2rem">
            Brak podsumowania. Kliknij "Uzupełnij" aby wygenerować, lub poczekaj na kolejną wiadomość w czacie.
        </p>`);
    }

    // Info footer
    const infoEl = document.getElementById('summary-info');
    if (infoEl) {
        const ts = state.rolling?.updatedAt ?? state.chunks?.at(-1)?.createdAt;
        infoEl.textContent = ts
            ? `Ostatnia aktualizacja: ${new Date(ts).toLocaleString()}`
            : '';
    }

    setContent(parts.join(''));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function setContent(html) {
    const el = document.getElementById('summary-content');
    if (el) el.innerHTML = html;
}

function loadingHtml(label) {
    return `<div class="summary-loading">
        <div class="typing-indicator">
            <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
        </div>
        <p>${escapeHtml(label)}</p>
    </div>`;
}

window.goBack = function() {
    if (document.referrer) history.back();
    else window.location.href = 'index.html';
};

init();
