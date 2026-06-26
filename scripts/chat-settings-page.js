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
    MISTRAL_CHAT_LIST, MISTRAL_MEMORY_LIST, MISTRAL_SUMMARY_LIST, MISTRAL_EMBED_LIST,
    MISTRAL_DEFAULTS,
} from './providers/mistral-models.js';
import {
    GROQ_CHAT_LIST, GROQ_MEMORY_LIST, GROQ_SUMMARY_LIST,
    GROQ_DEFAULTS,
} from './providers/groq-models.js';
import {
    OPENROUTER_CHAT_LIST, OPENROUTER_MEMORY_LIST, OPENROUTER_SUMMARY_LIST,
    OPENROUTER_DEFAULTS,
} from './providers/openrouter-models.js';
import {
    OPENAI_CHAT_LIST, OPENAI_MEMORY_LIST, OPENAI_SUMMARY_LIST, OPENAI_EMBED_LIST,
    OPENAI_DEFAULTS,
} from './providers/openai-models.js';
import {
    CLAUDE_CHAT_LIST, CLAUDE_MEMORY_LIST, CLAUDE_SUMMARY_LIST,
    CLAUDE_DEFAULTS,
} from './providers/claude-models.js';
import {
    OLLAMA_CHAT_LIST, OLLAMA_MEMORY_LIST, OLLAMA_SUMMARY_LIST, OLLAMA_EMBED_LIST,
    OLLAMA_DEFAULTS,
} from './providers/ollama-models.js';
import { escapeHtml, showToast } from './ui.js';
import { rlGetStatusForKey, rlClear } from './providers/index.js';

// ─── State ────────────────────────────────────────────────────────────────────
const params  = new URLSearchParams(window.location.search);
const chatId  = params.get('chatId') ? parseInt(params.get('chatId')) : null;
let   apiKeys           = [];   // Gemini keys for this chat
let   mistralApiKeys    = [];   // Mistral keys for this chat
let   groqApiKeys       = [];   // Groq keys for this chat
let   openrouterApiKeys = [];   // OpenRouter keys for this chat
let   openaiApiKeys     = [];   // OpenAI keys for this chat
let   claudeApiKeys     = [];   // Claude keys for this chat
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

    // ── Per-chat Mistral API keys ──
    mistralApiKeys = [...(cfg.mistralApiKeys || [])];
    renderMistralApiKeysList();

    // ── Per-chat Groq API keys ──
    groqApiKeys = [...(cfg.groqApiKeys || [])];
    renderGroqApiKeysList();

    // ── Per-chat OpenRouter API keys ──
    openrouterApiKeys = [...(cfg.openrouterApiKeys || [])];
    renderOpenRouterApiKeysList();

    // ── Per-chat OpenAI API keys ──
    openaiApiKeys = [...(cfg.openaiApiKeys || [])];
    renderOpenaiApiKeysList();

    // ── Per-chat Claude API keys ──
    claudeApiKeys = [...(cfg.claudeApiKeys || [])];
    renderClaudeApiKeysList();

    // Note: model dropdowns are filled by fillModelDropdowns() after this
    window._pendingGeminiModels = {
        chat:          cfg.chat.geminiModel             || GEMINI_DEFAULTS.chat.geminiModel,
        chatFallback:  cfg.chat.geminiModelFallback     ?? GEMINI_DEFAULTS.chat.geminiModelFallback,
        memory:        cfg.memory.geminiModel           || GEMINI_DEFAULTS.memory.geminiModel,
        memFallback:   cfg.memory.geminiModelFallback   ?? GEMINI_DEFAULTS.memory.geminiModelFallback,
        summary:       cfg.summary.geminiModel          || GEMINI_DEFAULTS.summary.geminiModel,
        sumFallback:   cfg.summary.geminiModelFallback  ?? GEMINI_DEFAULTS.summary.geminiModelFallback,
        embed:         cfg.embed.geminiModel            || GEMINI_DEFAULTS.embed.geminiModel,
    };

    window._pendingGroqModels = {
        chat:         cfg.chat.groqModel             || GROQ_DEFAULTS.chat.groqModel,
        chatFallback: cfg.chat.groqModelFallback     ?? GROQ_DEFAULTS.chat.groqModelFallback,
        memory:       cfg.memory.groqModel           || GROQ_DEFAULTS.memory.groqModel,
        memFallback:  cfg.memory.groqModelFallback   ?? GROQ_DEFAULTS.memory.groqModelFallback,
        summary:      cfg.summary.groqModel          || GROQ_DEFAULTS.summary.groqModel,
    };

    window._pendingMistralModels = {
        chat:         cfg.chat.mistralModel             || MISTRAL_DEFAULTS.chat.mistralModel,
        chatFallback: cfg.chat.mistralModelFallback     ?? MISTRAL_DEFAULTS.chat.mistralModelFallback,
        memory:       cfg.memory.mistralModel           || MISTRAL_DEFAULTS.memory.mistralModel,
        memFallback:  cfg.memory.mistralModelFallback   ?? MISTRAL_DEFAULTS.memory.mistralModelFallback,
        summary:      cfg.summary.mistralModel          || MISTRAL_DEFAULTS.summary.mistralModel,
        sumFallback:  cfg.summary.mistralModelFallback  ?? null,
        embed:        cfg.embed.mistralModel            || MISTRAL_DEFAULTS.embed.mistralModel,
    };

    window._pendingOpenRouterModels = {
        chat:         cfg.chat.openrouterModel             || OPENROUTER_DEFAULTS.chat.openrouterModel,
        chatFallback: cfg.chat.openrouterModelFallback     ?? OPENROUTER_DEFAULTS.chat.openrouterModelFallback,
        memory:       cfg.memory.openrouterModel           || OPENROUTER_DEFAULTS.memory.openrouterModel,
        memFallback:  cfg.memory.openrouterModelFallback   ?? OPENROUTER_DEFAULTS.memory.openrouterModelFallback,
        summary:      cfg.summary.openrouterModel          || OPENROUTER_DEFAULTS.summary.openrouterModel,
    };

    window._pendingOpenaiModels = {
        chat:         cfg.chat.openaiModel             || OPENAI_DEFAULTS.chat.openaiModel,
        chatFallback: cfg.chat.openaiModelFallback     ?? OPENAI_DEFAULTS.chat.openaiModelFallback,
        memory:       cfg.memory.openaiModel           || OPENAI_DEFAULTS.memory.openaiModel,
        memFallback:  cfg.memory.openaiModelFallback   ?? OPENAI_DEFAULTS.memory.openaiModelFallback,
        summary:      cfg.summary.openaiModel          || OPENAI_DEFAULTS.summary.openaiModel,
        embed:        cfg.embed.openaiModel            || OPENAI_DEFAULTS.embed.openaiModel,
    };

    window._pendingClaudeModels = {
        chat:         cfg.chat.claudeModel             || CLAUDE_DEFAULTS.chat.claudeModel,
        chatFallback: cfg.chat.claudeModelFallback     ?? CLAUDE_DEFAULTS.chat.claudeModelFallback,
        memory:       cfg.memory.claudeModel           || CLAUDE_DEFAULTS.memory.claudeModel,
        memFallback:  cfg.memory.claudeModelFallback   ?? CLAUDE_DEFAULTS.memory.claudeModelFallback,
        summary:      cfg.summary.claudeModel          || CLAUDE_DEFAULTS.summary.claudeModel,
    };
}

// ─── Gemini model dropdowns ───────────────────────────────────────────────────
function fillModelDropdowns() {
    // ── Gemini ──
    const pg = window._pendingGeminiModels || {};
    buildModelSelect('g-gemini-chat-model',    GEMINI_CHAT_LIST,    pg.chat,    'g-gemini-chat-model-custom');
    buildModelSelect('g-gemini-memory-model',  GEMINI_MEMORY_LIST,  pg.memory,  'g-gemini-memory-model-custom');
    buildModelSelect('g-gemini-summary-model', GEMINI_SUMMARY_LIST, pg.summary, 'g-gemini-summary-model-custom');
    buildModelSelect('g-gemini-embed-model',   GEMINI_EMBED_LIST,   pg.embed,   'g-gemini-embed-model-custom');
    buildFallbackSelect('g-gemini-chat-model-fallback',    GEMINI_CHAT_LIST,    pg.chatFallback);
    buildFallbackSelect('g-gemini-memory-model-fallback',  GEMINI_MEMORY_LIST,  pg.memFallback);
    buildFallbackSelect('g-gemini-summary-model-fallback', GEMINI_SUMMARY_LIST, pg.sumFallback);

    // ── Groq ──
    const pq = window._pendingGroqModels || {};
    buildModelSelect('g-groq-chat-model',    GROQ_CHAT_LIST,    pq.chat,    'g-groq-chat-model-custom');
    buildModelSelect('g-groq-memory-model',  GROQ_MEMORY_LIST,  pq.memory,  'g-groq-memory-model-custom');
    buildModelSelect('g-groq-summary-model', GROQ_SUMMARY_LIST, pq.summary, 'g-groq-summary-model-custom');
    buildFallbackSelect('g-groq-chat-model-fallback',   GROQ_CHAT_LIST,   pq.chatFallback);
    buildFallbackSelect('g-groq-memory-model-fallback', GROQ_MEMORY_LIST, pq.memFallback);

    // ── Mistral ──
    const pm = window._pendingMistralModels || {};
    buildModelSelect('g-mistral-chat-model',    MISTRAL_CHAT_LIST,    pm.chat,    'g-mistral-chat-model-custom');
    buildModelSelect('g-mistral-memory-model',  MISTRAL_MEMORY_LIST,  pm.memory,  'g-mistral-memory-model-custom');
    buildModelSelect('g-mistral-summary-model', MISTRAL_SUMMARY_LIST, pm.summary, 'g-mistral-summary-model-custom');
    buildModelSelect('g-mistral-embed-model',   MISTRAL_EMBED_LIST,   pm.embed,   'g-mistral-embed-model-custom');
    buildFallbackSelect('g-mistral-chat-model-fallback',   MISTRAL_CHAT_LIST,   pm.chatFallback);
    buildFallbackSelect('g-mistral-memory-model-fallback', MISTRAL_MEMORY_LIST, pm.memFallback);

    // ── OpenRouter ──
    const por = window._pendingOpenRouterModels || {};
    buildModelSelect('g-or-chat-model',    OPENROUTER_CHAT_LIST,    por.chat,    'g-or-chat-model-custom');
    buildModelSelect('g-or-memory-model',  OPENROUTER_MEMORY_LIST,  por.memory,  'g-or-memory-model-custom');
    buildModelSelect('g-or-summary-model', OPENROUTER_SUMMARY_LIST, por.summary, 'g-or-summary-model-custom');
    buildFallbackSelect('g-or-chat-model-fallback',   OPENROUTER_CHAT_LIST,   por.chatFallback);
    buildFallbackSelect('g-or-memory-model-fallback', OPENROUTER_MEMORY_LIST, por.memFallback);

    // ── OpenAI ──
    const poi = window._pendingOpenaiModels || {};
    buildModelSelect('g-openai-chat-model',    OPENAI_CHAT_LIST,    poi.chat,    'g-openai-chat-model-custom');
    buildModelSelect('g-openai-memory-model',  OPENAI_MEMORY_LIST,  poi.memory,  'g-openai-memory-model-custom');
    buildModelSelect('g-openai-summary-model', OPENAI_SUMMARY_LIST, poi.summary, 'g-openai-summary-model-custom');
    buildModelSelect('g-openai-embed-model',   OPENAI_EMBED_LIST,   poi.embed,   'g-openai-embed-model-custom');
    buildFallbackSelect('g-openai-chat-model-fallback',   OPENAI_CHAT_LIST,   poi.chatFallback);
    buildFallbackSelect('g-openai-memory-model-fallback', OPENAI_MEMORY_LIST, poi.memFallback);

    // ── Claude ──
    const pcl = window._pendingClaudeModels || {};
    buildModelSelect('g-claude-chat-model',    CLAUDE_CHAT_LIST,    pcl.chat,    'g-claude-chat-model-custom');
    buildModelSelect('g-claude-memory-model',  CLAUDE_MEMORY_LIST,  pcl.memory,  'g-claude-memory-model-custom');
    buildModelSelect('g-claude-summary-model', CLAUDE_SUMMARY_LIST, pcl.summary, 'g-claude-summary-model-custom');
    buildFallbackSelect('g-claude-chat-model-fallback',   CLAUDE_CHAT_LIST,   pcl.chatFallback);
    buildFallbackSelect('g-claude-memory-model-fallback', CLAUDE_MEMORY_LIST, pcl.memFallback);
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

/**
 * Build a fallback-model select.  Always has "— brak fallbacku —" as the first option (value "").
 * @param {string} selectId
 * @param {Array}  list          - model catalogue
 * @param {string|null} current  - currently selected value (null/'' → no fallback)
 */
function buildFallbackSelect(selectId, list, current) {
    const sel = document.getElementById(selectId);
    if (!sel) return;

    const noneOpt = `<option value=""${!current ? ' selected' : ''}>— brak fallbacku —</option>`;
    const opts = list.map(m =>
        `<option value="${escapeHtml(m.id)}"${m.id === current ? ' selected' : ''}>${escapeHtml(m.label)}</option>`
    ).join('');

    sel.innerHTML = noneOpt + opts;

    // If current is a custom model not in the list, prepend it
    if (current && !list.find(m => m.id === current)) {
        const opt = document.createElement('option');
        opt.value       = current;
        opt.textContent = current + ' (własny)';
        opt.selected    = true;
        sel.insertBefore(opt, sel.options[1]); // after "brak" option
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
    if (!global.length) { showToast('Brak globalnych kluczy Gemini', 'info'); return; }
    const existing = new Set(apiKeys.map(k => k.key));
    const added    = global.filter(k => !existing.has(k.key));
    apiKeys = [...apiKeys, ...added];
    renderApiKeysList();
    showToast(`Skopiowano ${added.length} klucz(y) Gemini`, 'success');
};

// ── Mistral API Keys ──────────────────────────────────────────────────────────
function renderMistralApiKeysList() {
    const list = document.getElementById('g-mistral-api-keys-list');
    if (!list) return;

    if (!mistralApiKeys.length) {
        list.innerHTML = '<p class="no-keys">Brak kluczy — dodaj lub skopiuj z globalnych</p>';
        return;
    }

    list.innerHTML = mistralApiKeys.map((k, i) => `
        <div class="api-key-item">
            <div class="api-key-main">
                <span class="api-key-label">${escapeHtml(k.label || `Key ${i + 1}`)}</span>
                <span class="api-key-masked">••••••••${escapeHtml(k.key.slice(-4))}</span>
                <button class="btn-danger small" onclick="removeMistralApiKey(${i})">Usuń</button>
            </div>
        </div>`).join('');
}

window.addMistralApiKey = function() {
    const labelEl = document.getElementById('g-new-mistral-key-label');
    const keyEl   = document.getElementById('g-new-mistral-key-value');
    const key     = keyEl?.value.trim();
    if (!key) { showToast('Klucz nie może być pusty', 'error'); return; }
    mistralApiKeys = [...mistralApiKeys, { label: labelEl?.value.trim() || `Key ${mistralApiKeys.length + 1}`, key }];
    if (labelEl) labelEl.value = '';
    if (keyEl)   keyEl.value   = '';
    renderMistralApiKeysList();
};

window.removeMistralApiKey = function(idx) {
    if (!confirm('Usunąć ten klucz Mistral z czatu?')) return;
    mistralApiKeys = mistralApiKeys.filter((_, i) => i !== idx);
    renderMistralApiKeysList();
};

// ── Groq API Keys ─────────────────────────────────────────────────────────────
function renderGroqApiKeysList() {
    const list = document.getElementById('g-groq-api-keys-list');
    if (!list) return;

    if (!groqApiKeys.length) {
        list.innerHTML = '<p class="no-keys">Brak kluczy — dodaj lub skopiuj z globalnych</p>';
        return;
    }

    list.innerHTML = groqApiKeys.map((k, i) => `
        <div class="api-key-item">
            <div class="api-key-main">
                <span class="api-key-label">${escapeHtml(k.label || `Key ${i + 1}`)}</span>
                <span class="api-key-masked">••••••••${escapeHtml(k.key.slice(-4))}</span>
                <button class="btn-danger small" onclick="removeGroqApiKey(${i})">Usuń</button>
            </div>
        </div>`).join('');
}

window.addGroqApiKey = function() {
    const labelEl = document.getElementById('g-new-groq-key-label');
    const keyEl   = document.getElementById('g-new-groq-key-value');
    const key     = keyEl?.value.trim();
    if (!key) { showToast('Klucz nie może być pusty', 'error'); return; }
    groqApiKeys = [...groqApiKeys, { label: labelEl?.value.trim() || `Key ${groqApiKeys.length + 1}`, key }];
    if (labelEl) labelEl.value = '';
    if (keyEl)   keyEl.value   = '';
    renderGroqApiKeysList();
};

window.removeGroqApiKey = function(idx) {
    if (!confirm('Usunąć ten klucz Groq z czatu?')) return;
    groqApiKeys = groqApiKeys.filter((_, i) => i !== idx);
    renderGroqApiKeysList();
};

window.syncGroqApiKeysFromGlobal = function() {
    const global = globalSettings.groqApiKeys || [];
    if (!global.length) { showToast('Brak globalnych kluczy Groq', 'info'); return; }
    const existing = new Set(groqApiKeys.map(k => k.key));
    const added    = global.filter(k => !existing.has(k.key));
    groqApiKeys = [...groqApiKeys, ...added];
    renderGroqApiKeysList();
    showToast(`Skopiowano ${added.length} klucz(y) Groq`, 'success');
};

window.syncMistralApiKeysFromGlobal = function() {
    const global = globalSettings.mistralApiKeys || [];
    if (!global.length) { showToast('Brak globalnych kluczy Mistral', 'info'); return; }
    const existing = new Set(mistralApiKeys.map(k => k.key));
    const added    = global.filter(k => !existing.has(k.key));
    mistralApiKeys = [...mistralApiKeys, ...added];
    renderMistralApiKeysList();
    showToast(`Skopiowano ${added.length} klucz(y) Mistral`, 'success');
};

// ── OpenRouter key management ──
function renderOpenRouterApiKeysList() {
    const list = document.getElementById('or-api-keys-list');
    if (!list) return;
    list.innerHTML = openrouterApiKeys.length
        ? openrouterApiKeys.map((k, i) => `
            <div class="api-key-item">
                <span class="api-key-label">${escapeHtml(k.label || `Key ${i + 1}`)}</span>
                <span class="api-key-masked">••••••••${escapeHtml(k.key.slice(-4))}</span>
                <button class="btn-danger small" onclick="page.removeOpenRouterApiKey(${i})">Usuń</button>
            </div>`).join('')
        : '<p class="no-keys">Brak kluczy</p>';
}

window.page = window.page || {};

Object.assign(window.page, {
    addOpenRouterApiKey() {
        const labelEl = document.getElementById('new-or-key-label');
        const keyEl   = document.getElementById('new-or-key-value');
        const key     = keyEl?.value.trim();
        if (!key) { showToast('Klucz nie może być pusty', 'error'); return; }
        openrouterApiKeys = [...openrouterApiKeys, {
            label: labelEl?.value.trim() || `Key ${openrouterApiKeys.length + 1}`,
            key,
        }];
        if (labelEl) labelEl.value = '';
        if (keyEl)   keyEl.value   = '';
        renderOpenRouterApiKeysList();
    },
    removeOpenRouterApiKey(idx) {
        if (!confirm('Usunąć ten klucz?')) return;
        openrouterApiKeys = openrouterApiKeys.filter((_, i) => i !== idx);
        renderOpenRouterApiKeysList();
    },
    syncOpenRouterApiKeysFromGlobal() {
        const global = globalSettings.openrouterApiKeys || [];
        if (!global.length) { showToast('Brak globalnych kluczy OpenRouter', 'info'); return; }
        const existing = new Set(openrouterApiKeys.map(k => k.key));
        const added    = global.filter(k => !existing.has(k.key));
        openrouterApiKeys = [...openrouterApiKeys, ...added];
        renderOpenRouterApiKeysList();
        showToast(`Skopiowano ${added.length} klucz(y) OpenRouter`, 'success');
    },
});

// ── OpenAI API Keys ───────────────────────────────────────────────────────────
function renderOpenaiApiKeysList() {
    const list = document.getElementById('g-openai-api-keys-list');
    if (!list) return;

    if (!openaiApiKeys.length) {
        list.innerHTML = '<p class="no-keys">Brak kluczy — dodaj lub skopiuj z globalnych</p>';
        return;
    }

    list.innerHTML = openaiApiKeys.map((k, i) => `
        <div class="api-key-item">
            <div class="api-key-main">
                <span class="api-key-label">${escapeHtml(k.label || `Key ${i + 1}`)}</span>
                <span class="api-key-masked">••••••••${escapeHtml(k.key.slice(-4))}</span>
                <button class="btn-danger small" onclick="removeOpenaiApiKey(${i})">Usuń</button>
            </div>
        </div>`).join('');
}

window.addOpenaiApiKey = function() {
    const labelEl = document.getElementById('g-new-openai-key-label');
    const keyEl   = document.getElementById('g-new-openai-key-value');
    const key     = keyEl?.value.trim();
    if (!key) { showToast('Klucz nie może być pusty', 'error'); return; }
    openaiApiKeys = [...openaiApiKeys, { label: labelEl?.value.trim() || `Key ${openaiApiKeys.length + 1}`, key }];
    if (labelEl) labelEl.value = '';
    if (keyEl)   keyEl.value   = '';
    renderOpenaiApiKeysList();
};

window.removeOpenaiApiKey = function(idx) {
    if (!confirm('Usunąć ten klucz OpenAI z czatu?')) return;
    openaiApiKeys = openaiApiKeys.filter((_, i) => i !== idx);
    renderOpenaiApiKeysList();
};

window.syncOpenaiApiKeysFromGlobal = function() {
    const global = globalSettings.openaiApiKeys || [];
    if (!global.length) { showToast('Brak globalnych kluczy OpenAI', 'info'); return; }
    const existing = new Set(openaiApiKeys.map(k => k.key));
    const added    = global.filter(k => !existing.has(k.key));
    openaiApiKeys = [...openaiApiKeys, ...added];
    renderOpenaiApiKeysList();
    showToast(`Skopiowano ${added.length} klucz(y) OpenAI`, 'success');
};

// ── Claude API Keys ─────────────────────────────────────────────────────────────
function renderClaudeApiKeysList() {
    const list = document.getElementById('g-claude-api-keys-list');
    if (!list) return;

    if (!claudeApiKeys.length) {
        list.innerHTML = '<p class="no-keys">Brak kluczy — dodaj lub skopiuj z globalnych</p>';
        return;
    }

    list.innerHTML = claudeApiKeys.map((k, i) => `
        <div class="api-key-item">
            <div class="api-key-main">
                <span class="api-key-label">${escapeHtml(k.label || `Key ${i + 1}`)}</span>
                <span class="api-key-masked">••••••••${escapeHtml(k.key.slice(-4))}</span>
                <button class="btn-danger small" onclick="removeClaudeApiKey(${i})">Usuń</button>
            </div>
        </div>`).join('');
}

window.addClaudeApiKey = function() {
    const labelEl = document.getElementById('g-new-claude-key-label');
    const keyEl   = document.getElementById('g-new-claude-key-value');
    const key     = keyEl?.value.trim();
    if (!key) { showToast('Klucz nie może być pusty', 'error'); return; }
    claudeApiKeys = [...claudeApiKeys, { label: labelEl?.value.trim() || `Key ${claudeApiKeys.length + 1}`, key }];
    if (labelEl) labelEl.value = '';
    if (keyEl)   keyEl.value   = '';
    renderClaudeApiKeysList();
};

window.removeClaudeApiKey = function(idx) {
    if (!confirm('Usunąć ten klucz Claude z czatu?')) return;
    claudeApiKeys = claudeApiKeys.filter((_, i) => i !== idx);
    renderClaudeApiKeysList();
};

window.syncClaudeApiKeysFromGlobal = function() {
    const global = globalSettings.claudeApiKeys || [];
    if (!global.length) { showToast('Brak globalnych kluczy Claude', 'info'); return; }
    const existing = new Set(claudeApiKeys.map(k => k.key));
    const added    = global.filter(k => !existing.has(k.key));
    claudeApiKeys = [...claudeApiKeys, ...added];
    renderClaudeApiKeysList();
    showToast(`Skopiowano ${added.length} klucz(y) Claude`, 'success');
};

// ─── Collect form → config ────────────────────────────────────────────────────
function collectConfig() {
    const pf  = (id, fallback) => parseFloat(document.getElementById(id)?.value ?? fallback);
    const pi  = (id, fallback) => parseInt(document.getElementById(id)?.value   ?? fallback);
    const str = (id, fallback) => document.getElementById(id)?.value.trim() || fallback;

    return {
        chat: {
            provider:             str('g-chat-provider',       'gemini'),
            temperature:          pf ('g-chat-temp',           0.7),
            maxTokens:            pi ('g-chat-max-tokens',     8192),
            contextTokens:        pi ('g-chat-ctx',            8000),
            geminiModel:          str('g-gemini-chat-model',   GEMINI_DEFAULTS.chat.geminiModel),
            geminiModelFallback:  document.getElementById('g-gemini-chat-model-fallback')?.value || null,
            mistralModel:         str('g-mistral-chat-model',  MISTRAL_DEFAULTS.chat.mistralModel),
            mistralModelFallback: document.getElementById('g-mistral-chat-model-fallback')?.value || null,
            groqModel:              str('g-groq-chat-model',       GROQ_DEFAULTS.chat.groqModel),
            groqModelFallback:      document.getElementById('g-groq-chat-model-fallback')?.value || null,
            openrouterModel:         str('g-or-chat-model',         OPENROUTER_DEFAULTS.chat.openrouterModel),
            openrouterModelFallback: document.getElementById('g-or-chat-model-fallback')?.value || null,
            openaiModel:             str('g-openai-chat-model',     OPENAI_DEFAULTS.chat.openaiModel),
            openaiModelFallback:     document.getElementById('g-openai-chat-model-fallback')?.value || null,
            claudeModel:             str('g-claude-chat-model',     CLAUDE_DEFAULTS.chat.claudeModel),
            claudeModelFallback:     document.getElementById('g-claude-chat-model-fallback')?.value || null,
            ollamaModel:             str('g-ollama-chat-model',     OLLAMA_DEFAULTS.chat.ollamaModel),
        },
        memory: {
            provider:               str('g-memory-provider',    'gemini'),
            temperature:            pf ('g-memory-temp',        0.1),
            maxTokens:              pi ('g-memory-max-tokens',  8192),
            geminiModel:            str('g-gemini-memory-model',  GEMINI_DEFAULTS.memory.geminiModel),
            geminiModelFallback:    document.getElementById('g-gemini-memory-model-fallback')?.value || null,
            mistralModel:           str('g-mistral-memory-model', MISTRAL_DEFAULTS.memory.mistralModel),
            mistralModelFallback:   document.getElementById('g-mistral-memory-model-fallback')?.value || null,
            groqModel:              str('g-groq-memory-model',    GROQ_DEFAULTS.memory.groqModel),
            groqModelFallback:      document.getElementById('g-groq-memory-model-fallback')?.value || null,
            openrouterModel:         str('g-or-memory-model',      OPENROUTER_DEFAULTS.memory.openrouterModel),
            openrouterModelFallback: document.getElementById('g-or-memory-model-fallback')?.value || null,
            openaiModel:             str('g-openai-memory-model',  OPENAI_DEFAULTS.memory.openaiModel),
            openaiModelFallback:     document.getElementById('g-openai-memory-model-fallback')?.value || null,
            claudeModel:             str('g-claude-memory-model',  CLAUDE_DEFAULTS.memory.claudeModel),
            claudeModelFallback:     document.getElementById('g-claude-memory-model-fallback')?.value || null,
            ollamaModel:             str('g-ollama-memory-model',  OLLAMA_DEFAULTS.memory.ollamaModel),
        },
        summary: {
            provider:               str('g-summary-provider',    'gemini'),
            temperature:            pf ('g-summary-temp',        0.3),
            maxTokens:              pi ('g-summary-max-tokens',  8192),
            everyN:                 pi ('g-summary-every',       10),
            geminiModel:            str('g-gemini-summary-model',  GEMINI_DEFAULTS.summary.geminiModel),
            geminiModelFallback:    document.getElementById('g-gemini-summary-model-fallback')?.value || null,
            mistralModel:           str('g-mistral-summary-model', MISTRAL_DEFAULTS.summary.mistralModel),
            mistralModelFallback:   null,
            groqModel:              str('g-groq-summary-model',    GROQ_DEFAULTS.summary.groqModel),
            groqModelFallback:      null,
            openrouterModel:         str('g-or-summary-model',     OPENROUTER_DEFAULTS.summary.openrouterModel),
            openrouterModelFallback: null,
            openaiModel:             str('g-openai-summary-model', OPENAI_DEFAULTS.summary.openaiModel),
            openaiModelFallback:     null,
            claudeModel:             str('g-claude-summary-model', CLAUDE_DEFAULTS.summary.claudeModel),
            claudeModelFallback:     null,
            ollamaModel:             str('g-ollama-summary-model', OLLAMA_DEFAULTS.summary.ollamaModel),
        },
        embed: {
            provider:              str('g-embed-provider',    'gemini'),
            geminiModel:           str('g-gemini-embed-model',  GEMINI_DEFAULTS.embed.geminiModel),
            mistralModel:          str('g-mistral-embed-model', MISTRAL_DEFAULTS.embed.mistralModel),
            groqModel:             null,
            openrouterModel:       null,
            openaiModel:           str('g-openai-embed-model',  OPENAI_DEFAULTS.embed.openaiModel),
            claudeModel:           null,
            ollamaModel:           str('g-ollama-embed-model',  OLLAMA_DEFAULTS.embed.ollamaModel),
        },
        ollamaBaseUrl:     str('g-ollama-url', 'http://localhost:11434'),
        apiKeys:           [...apiKeys],
        mistralApiKeys:    [...mistralApiKeys],
        groqApiKeys:       [...groqApiKeys],
        openrouterApiKeys: [...openrouterApiKeys],
        openaiApiKeys:     [...openaiApiKeys],
        claudeApiKeys:     [...claudeApiKeys],
        chatLang:          str('g-chat-lang', 'pl'),
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
    window.location.href = 'index.html';
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
