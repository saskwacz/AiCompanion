/**
 * chat-settings-page.js — standalone chat settings page (chat-settings.html)
 *
 * Tab structure:
 *   Outer: [Ogólne] [Gemini] [Ollama]
 *   Gemini inner: [Ogólne(keys)] [Chat] [Memory] [Summary] [Embeddings]
 *   Ollama inner: [Ogólne(url)]  [Chat] [Memory] [Summary] [Embeddings]
 */

import { openDB }                                   from './db.js';
import { loadSettings }                             from './settings.js';
import { getChatById, updateChat }                  from './chats.js';
import { resolveChatConfig }                        from './chat-config.js';
import {
    GEMINI_CHAT_LIST, GEMINI_MEMORY_LIST, GEMINI_SUMMARY_LIST, GEMINI_EMBED_LIST,
    GEMINI_DEFAULTS,
} from './providers/gemini-models.js';
import {
    OLLAMA_CHAT_LIST, OLLAMA_MEMORY_LIST, OLLAMA_SUMMARY_LIST, OLLAMA_EMBED_LIST,
    OLLAMA_DEFAULTS,
} from './providers/ollama-models.js';
import { escapeHtml, showToast } from './ui.js';
import { rlGetStatusForKey, rlClear } from './providers/index.js';

// ─── State ────────────────────────────────────────────────────────────────────
const params  = new URLSearchParams(window.location.search);
const chatId  = params.get('chatId') ? parseInt(params.get('chatId')) : null;
let   apiKeys = [];   // current per-chat api keys
let   globalSettings = {};

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
    try {
        await openDB();
        globalSettings = await loadSettings();

        if (!chatId) { showToast('Brak chatId w URL', 'error'); return; }
        const chat = await getChatById(chatId);
        if (!chat)  { showToast('Czat nie znaleziony', 'error'); return; }

        const cfg = resolveChatConfig(chat);
        populateForm(cfg);
        fillModelDropdowns();
        fillDatalistSuggestions();
    } catch (err) {
        console.error('[ChatSettings] Init error:', err);
        showToast('Błąd inicjalizacji: ' + err.message, 'error');
    }
}

// ─── Populate form from config ────────────────────────────────────────────────
function populateForm(cfg) {
    // ── General: providers + generation params ──
    setVal('g-chat-provider',    cfg.chat.provider    || 'gemini');
    setVal('g-memory-provider',  cfg.memory.provider  || 'gemini');
    setVal('g-summary-provider', cfg.summary.provider || 'gemini');
    setVal('g-embed-provider',   cfg.embed.provider   || 'gemini');

    setSlider('g-chat-temp',    'g-chat-temp-val',    cfg.chat.temperature    ?? 0.7);
    setSlider('g-memory-temp',  'g-memory-temp-val',  cfg.memory.temperature  ?? 0.1);
    setSlider('g-summary-temp', 'g-summary-temp-val', cfg.summary.temperature ?? 0.3);

    setVal('g-chat-max-tokens',    cfg.chat.maxTokens    ?? 8192);
    setVal('g-chat-ctx',           cfg.chat.contextTokens ?? 8000);
    setVal('g-memory-max-tokens',  cfg.memory.maxTokens  ?? 8192);
    setVal('g-summary-max-tokens', cfg.summary.maxTokens ?? 8192);
    setVal('g-summary-every',      cfg.summary.everyN    ?? 10);

    // ── Ollama URL ──
    setVal('g-ollama-url', cfg.ollamaBaseUrl || 'http://localhost:11434');

    // ── Language ──
    setVal('g-chat-lang', cfg.chatLang || 'pl');

    // ── Ollama models (text inputs) ──
    setVal('g-ollama-chat-model',    cfg.chat.ollamaModel    || OLLAMA_DEFAULTS.chat.ollamaModel);
    setVal('g-ollama-memory-model',  cfg.memory.ollamaModel  || OLLAMA_DEFAULTS.memory.ollamaModel);
    setVal('g-ollama-summary-model', cfg.summary.ollamaModel || OLLAMA_DEFAULTS.summary.ollamaModel);
    setVal('g-ollama-embed-model',   cfg.embed.ollamaModel   || OLLAMA_DEFAULTS.embed.ollamaModel);

    // ── Per-chat Gemini API keys ──
    apiKeys = [...(cfg.apiKeys || [])];
    renderApiKeysList();

    // Note: Gemini model dropdowns are filled by fillModelDropdowns() after this
    // store current gemini models to select them in the dropdowns
    window._pendingGeminiModels = {
        chat:    cfg.chat.geminiModel    || GEMINI_DEFAULTS.chat.geminiModel,
        memory:  cfg.memory.geminiModel  || GEMINI_DEFAULTS.memory.geminiModel,
        summary: cfg.summary.geminiModel || GEMINI_DEFAULTS.summary.geminiModel,
        embed:   cfg.embed.geminiModel   || GEMINI_DEFAULTS.embed.geminiModel,
    };
}

// ─── Gemini model dropdowns ───────────────────────────────────────────────────
function fillModelDropdowns() {
    const pending = window._pendingGeminiModels || {};
    buildModelSelect('g-gemini-chat-model',    GEMINI_CHAT_LIST,    pending.chat,    'g-gemini-chat-model-custom');
    buildModelSelect('g-gemini-memory-model',  GEMINI_MEMORY_LIST,  pending.memory,  'g-gemini-memory-model-custom');
    buildModelSelect('g-gemini-summary-model', GEMINI_SUMMARY_LIST, pending.summary, 'g-gemini-summary-model-custom');
    buildModelSelect('g-gemini-embed-model',   GEMINI_EMBED_LIST,   pending.embed,   'g-gemini-embed-model-custom');
}

function buildModelSelect(selectId, list, currentModel, customInputId) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = list.map(m =>
        `<option value="${escapeHtml(m.id)}"${m.id === currentModel ? ' selected' : ''}>${escapeHtml(m.label)}</option>`
    ).join('');

    // If currentModel is not in list, add it at top
    if (currentModel && !list.find(m => m.id === currentModel)) {
        const opt    = document.createElement('option');
        opt.value    = currentModel;
        opt.textContent = currentModel + ' (własny)';
        opt.selected = true;
        sel.prepend(opt);
    }

    // Keep custom input in sync
    if (customInputId) {
        const ci = document.getElementById(customInputId);
        if (ci) ci.value = '';
        sel.addEventListener('change', () => {
            const ci = document.getElementById(customInputId);
            if (ci) ci.value = '';
        });
    }
}

/** Called from HTML: when user types in the custom model input, update the select value. */
window.syncCustomModel = function(input, selectId) {
    const val = input.value.trim();
    if (!val) return;
    const sel = document.getElementById(selectId);
    if (!sel) return;
    // Add option if not present
    let opt = [...sel.options].find(o => o.value === val);
    if (!opt) {
        opt = document.createElement('option');
        opt.value = val;
        opt.textContent = val + ' (własny)';
        sel.prepend(opt);
    }
    sel.value = val;
};

// ─── Ollama datalist suggestions ──────────────────────────────────────────────
function fillDatalistSuggestions() {
    fill('dl-ollama-chat',    OLLAMA_CHAT_LIST);
    fill('dl-ollama-memory',  OLLAMA_MEMORY_LIST);
    fill('dl-ollama-summary', OLLAMA_SUMMARY_LIST);
    fill('dl-ollama-embed',   OLLAMA_EMBED_LIST);
}

function fill(datalistId, list) {
    const dl = document.getElementById(datalistId);
    if (!dl) return;
    dl.innerHTML = list.map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}</option>`).join('');
}

// ─── Tab switching ────────────────────────────────────────────────────────────

/** Outer tab (General / Gemini / Ollama) */
window.switchTab = function(btn, name) {
    document.querySelectorAll('.cs-outer-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.cs-outer-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`cs-panel-${name}`)?.classList.add('active');
    if (name === 'gemini') renderRateLimitStatus();
};

/** Inner tab (inside Gemini or Ollama panel) */
window.switchInnerTab = function(btn, name) {
    const panel = btn.closest('.cs-outer-panel');
    if (!panel) return;
    panel.querySelectorAll('.cs-inner-tab').forEach(t => t.classList.remove('active'));
    panel.querySelectorAll('.cs-inner-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`cs-inner-${name}`)?.classList.add('active');
};

// ─── Quick provider switch ────────────────────────────────────────────────────
window.setAllProviders = function(provider) {
    ['chat', 'memory', 'summary', 'embed'].forEach(role => {
        const sel = document.getElementById(`g-${role}-provider`);
        if (sel) sel.value = provider;
    });
};

/** Placeholder – called from HTML onchange. No-op here; reads happen at save. */
window.onProviderChange = function(role) {
    // Nothing needed: provider is read from the select at save time
};

// ─── API Keys ─────────────────────────────────────────────────────────────────
function renderApiKeysList() {
    const list = document.getElementById('g-api-keys-list');
    if (!list) return;

    if (!apiKeys.length) {
        list.innerHTML = '<p class="no-keys">Brak kluczy — dodaj lub skopiuj z globalnych</p>';
        return;
    }

    const now = Date.now();
    list.innerHTML = apiKeys.map((k, i) => {
        const blocks   = rlGetStatusForKey(k.key);
        const blocksHtml = blocks.map(({ model, until }) => {
            const diff    = until.getTime() - now;
            const hrs     = Math.floor(diff / 3_600_000);
            const mins    = Math.floor((diff % 3_600_000) / 60_000);
            const timeStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
            // encode key and model safely for inline onclick
            const safeKey   = encodeURIComponent(k.key);
            const safeModel = encodeURIComponent(model);
            return `<div class="rate-limit-inline">
                <span class="rate-limit-model">&#x1F6AB; ${escapeHtml(model)}</span>
                <span class="rate-limit-time">429 — zablokowany ~${timeStr} (do ${until.toLocaleTimeString()})</span>
                <button class="btn-secondary small" onclick="clearOneRateLimit('${safeKey}','${safeModel}')">Odblokuj</button>
            </div>`;
        }).join('');

        return `<div class="api-key-item${blocks.length ? ' api-key-has-blocks' : ''}">
            <div class="api-key-main">
                <span class="api-key-label">${escapeHtml(k.label || `Key ${i + 1}`)}</span>
                <span class="api-key-masked">••••••••${escapeHtml(k.key.slice(-4))}</span>
                <button class="btn-danger small" onclick="removeApiKey(${i})">Usuń</button>
            </div>
            ${blocksHtml}
        </div>`;
    }).join('');
}

function renderRateLimitStatus() { renderApiKeysList(); }

window.addApiKey = function() {
    const labelEl = document.getElementById('g-new-key-label');
    const keyEl   = document.getElementById('g-new-key-value');
    const key     = keyEl?.value.trim();
    if (!key) { showToast('Klucz nie może być pusty', 'error'); return; }
    apiKeys = [...apiKeys, { label: labelEl?.value.trim() || `Key ${apiKeys.length + 1}`, key }];
    if (labelEl) labelEl.value = '';
    if (keyEl)   keyEl.value   = '';
    renderApiKeysList();
};

window.removeApiKey = function(idx) {
    if (!confirm('Usunąć ten klucz z czatu?')) return;
    apiKeys = apiKeys.filter((_, i) => i !== idx);
    renderApiKeysList();
};

window.clearOneRateLimit = function(encodedKey, encodedModel) {
    const keyValue = decodeURIComponent(encodedKey);
    const model    = decodeURIComponent(encodedModel);
    rlClear(keyValue, model);
    renderApiKeysList();
    showToast(`Blokada modelu "${model}" odblokowana`, 'success');
};

window.clearAllRateLimits = function() {
    rlClear();
    renderApiKeysList();
    showToast('Wszystkie blokady limitów usunięte', 'success');
};

window.syncApiKeysFromGlobal = function() {
    const global = globalSettings.apiKeys || [];
    if (!global.length) { showToast('Brak globalnych kluczy', 'info'); return; }
    const existing = new Set(apiKeys.map(k => k.key));
    const added    = global.filter(k => !existing.has(k.key));
    apiKeys = [...apiKeys, ...added];
    renderApiKeysList();
    showToast(`Skopiowano ${added.length} klucz(y)`, 'success');
};

// ─── Collect form → config ────────────────────────────────────────────────────
function collectConfig() {
    const pf  = (id, fallback) => parseFloat(document.getElementById(id)?.value ?? fallback);
    const pi  = (id, fallback) => parseInt(document.getElementById(id)?.value   ?? fallback);
    const str = (id, fallback) => document.getElementById(id)?.value.trim() || fallback;

    return {
        chat: {
            provider:      str('g-chat-provider',       'gemini'),
            temperature:   pf ('g-chat-temp',           0.7),
            maxTokens:     pi ('g-chat-max-tokens',     8192),
            contextTokens: pi ('g-chat-ctx',            8000),
            geminiModel:   str('g-gemini-chat-model',   GEMINI_DEFAULTS.chat.geminiModel),
            ollamaModel:   str('g-ollama-chat-model',   OLLAMA_DEFAULTS.chat.ollamaModel),
        },
        memory: {
            provider:    str('g-memory-provider',    'gemini'),
            temperature: pf ('g-memory-temp',        0.1),
            maxTokens:   pi ('g-memory-max-tokens',  8192),
            geminiModel: str('g-gemini-memory-model', GEMINI_DEFAULTS.memory.geminiModel),
            ollamaModel: str('g-ollama-memory-model', OLLAMA_DEFAULTS.memory.ollamaModel),
        },
        summary: {
            provider:    str('g-summary-provider',    'gemini'),
            temperature: pf ('g-summary-temp',        0.3),
            maxTokens:   pi ('g-summary-max-tokens',  8192),
            everyN:      pi ('g-summary-every',       10),
            geminiModel: str('g-gemini-summary-model', GEMINI_DEFAULTS.summary.geminiModel),
            ollamaModel: str('g-ollama-summary-model', OLLAMA_DEFAULTS.summary.ollamaModel),
        },
        embed: {
            provider:    str('g-embed-provider',    'gemini'),
            geminiModel: str('g-gemini-embed-model', GEMINI_DEFAULTS.embed.geminiModel),
            ollamaModel: str('g-ollama-embed-model', OLLAMA_DEFAULTS.embed.ollamaModel),
        },
        ollamaBaseUrl: str('g-ollama-url', 'http://localhost:11434'),
        apiKeys:       [...apiKeys],
        chatLang:      str('g-chat-lang', 'pl'),
    };
}

// ─── Save ─────────────────────────────────────────────────────────────────────
window.saveSettings = async function() {
    if (!chatId) { showToast('Brak chatId', 'error'); return; }
    try {
        const config = collectConfig();
        await updateChat(chatId, { config });
        showToast('Ustawienia czatu zapisane', 'success');
        setTimeout(() => { window.location.href = 'index.html'; }, 500);
    } catch (err) {
        console.error('[ChatSettings] Save error:', err);
        showToast('Błąd zapisu: ' + err.message, 'error');
    }
};

// ─── Navigation ───────────────────────────────────────────────────────────────
window.goBack = function() {
    if (history.length > 1) {
        history.back();
    } else {
        window.location.href = 'index.html';
    }
};

// ─── Utilities ────────────────────────────────────────────────────────────────
function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
}

function setSlider(sliderId, valueId, val) {
    const slider   = document.getElementById(sliderId);
    const valueEl  = document.getElementById(valueId);
    if (slider)  slider.value       = val;
    if (valueEl) valueEl.textContent = (+val).toFixed(2);
}

init();
