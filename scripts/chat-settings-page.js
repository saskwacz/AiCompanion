/**
 * chat-settings-page.js — standalone chat settings page (chat-settings.html)
 */

import { openDB } from './db.js';
import { loadSettings } from './settings.js';
import { getChatById, updateChat } from './chats.js';
import { resolveChatConfig } from './chat-config.js';
import {
    MISTRAL_CHAT_LIST, MISTRAL_MEMORY_LIST, MISTRAL_SUMMARY_LIST, MISTRAL_EMBED_LIST,
    MISTRAL_DEFAULTS, getModelListForService,
} from './providers/mistral-models.js';
import { escapeHtml, showToast } from './ui.js';

const params = new URLSearchParams(window.location.search);
const chatId = params.get('chatId') ? parseInt(params.get('chatId')) : null;
let mistralApiKeys = [];
let globalSettings = {};
let savedChatConfig  = null;

async function init() {
    try {
        await openDB();
        globalSettings = await loadSettings();

        if (!chatId) { showToast('Brak chatId w URL', 'error'); return; }
        const chat = await getChatById(chatId);
        if (!chat)  { showToast('Czat nie znaleziony', 'error'); return; }

        const cfg = resolveChatConfig(chat);
        savedChatConfig = cfg;
        populateForm(cfg);
        fillModelDropdowns();
    } catch (err) {
        console.error('[ChatSettings] Init error:', err);
        showToast('Błąd inicjalizacji: ' + err.message, 'error');
    }
}

function populateForm(cfg) {
    setSlider('g-chat-temp',    'g-chat-temp-val',    cfg.chat.temperature    ?? 0.7);
    setSlider('g-memory-temp',  'g-memory-temp-val',  cfg.memory.temperature  ?? 0.1);
    setSlider('g-summary-temp', 'g-summary-temp-val', cfg.summary.temperature ?? 0.3);

    setVal('g-chat-max-tokens',    cfg.chat.maxTokens     ?? 8192);
    setVal('g-chat-ctx',           cfg.chat.contextTokens ?? 8000);
    setVal('g-memory-max-tokens',  cfg.memory.maxTokens   ?? 8192);
    setVal('g-summary-max-tokens', cfg.summary.maxTokens  ?? 8192);
    setVal('g-summary-every',      cfg.summary.everyN     ?? 10);
    setVal('g-chat-lang',          cfg.chatLang || 'pl');

    mistralApiKeys = [...(cfg.mistralApiKeys || [])];
    renderMistralApiKeysList();

    window._pendingMistralModels = {
        chat:         cfg.chat.mistralModel            || MISTRAL_DEFAULTS.chat.mistralModel,
        chatFallback: cfg.chat.mistralModelFallback    ?? MISTRAL_DEFAULTS.chat.mistralModelFallback,
        memory:       cfg.memory.mistralModel          || MISTRAL_DEFAULTS.memory.mistralModel,
        memFallback:  cfg.memory.mistralModelFallback  ?? MISTRAL_DEFAULTS.memory.mistralModelFallback,
        summary:      cfg.summary.mistralModel         || MISTRAL_DEFAULTS.summary.mistralModel,
        goals:        cfg.goals?.mistralModel          || MISTRAL_DEFAULTS.goals.mistralModel,
        emotion:      cfg.emotion?.mistralModel        || MISTRAL_DEFAULTS.emotion.mistralModel,
        relationship: cfg.relationship?.mistralModel   || MISTRAL_DEFAULTS.relationship.mistralModel,
        embed:        cfg.embed.mistralModel           || MISTRAL_DEFAULTS.embed.mistralModel,
    };

    const relLlm = document.getElementById('g-relationship-use-llm');
    if (relLlm) relLlm.checked = cfg.relationship?.useLLM === true;
}

function fillModelDropdowns() {
    const pm = window._pendingMistralModels || {};
    buildModelSelect('g-mistral-chat-model',    MISTRAL_CHAT_LIST,    pm.chat,    'g-mistral-chat-model-custom');
    buildModelSelect('g-mistral-memory-model',  MISTRAL_MEMORY_LIST,  pm.memory,  'g-mistral-memory-model-custom');
    buildModelSelect('g-mistral-summary-model', MISTRAL_SUMMARY_LIST, pm.summary, 'g-mistral-summary-model-custom');
    buildModelSelect('g-mistral-goals-model', getModelListForService('goals'), pm.goals, null);
    buildModelSelect('g-mistral-emotion-model', getModelListForService('emotion'), pm.emotion, null);
    buildModelSelect('g-mistral-relationship-model', getModelListForService('relationship'), pm.relationship, null);
    buildModelSelect('g-mistral-embed-model',   MISTRAL_EMBED_LIST,   pm.embed,   'g-mistral-embed-model-custom');
    buildFallbackSelect('g-mistral-chat-model-fallback',   MISTRAL_CHAT_LIST,   pm.chatFallback);
    buildFallbackSelect('g-mistral-memory-model-fallback', MISTRAL_MEMORY_LIST, pm.memFallback);
}

function buildModelSelect(selectId, list, currentModel, customInputId) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = list.map(m =>
        `<option value="${escapeHtml(m.id)}"${m.id === currentModel ? ' selected' : ''}>${escapeHtml(m.label)}</option>`
    ).join('');

    if (currentModel && !list.find(m => m.id === currentModel)) {
        const opt = document.createElement('option');
        opt.value = currentModel;
        opt.textContent = currentModel + ' (własny)';
        opt.selected = true;
        sel.prepend(opt);
    }

    if (customInputId) {
        const ci = document.getElementById(customInputId);
        if (ci) ci.value = '';
        sel.addEventListener('change', () => {
            const custom = document.getElementById(customInputId);
            if (custom) custom.value = '';
        });
    }
}

function buildFallbackSelect(selectId, list, current) {
    const sel = document.getElementById(selectId);
    if (!sel) return;

    const noneOpt = `<option value=""${!current ? ' selected' : ''}>— brak fallbacku —</option>`;
    const opts = list.map(m =>
        `<option value="${escapeHtml(m.id)}"${m.id === current ? ' selected' : ''}>${escapeHtml(m.label)}</option>`
    ).join('');
    sel.innerHTML = noneOpt + opts;

    if (current && !list.find(m => m.id === current)) {
        const opt = document.createElement('option');
        opt.value = current;
        opt.textContent = current + ' (własny)';
        opt.selected = true;
        sel.insertBefore(opt, sel.options[1]);
    }
}

window.syncCustomModel = function(input, selectId) {
    const val = input.value.trim();
    if (!val) return;
    const sel = document.getElementById(selectId);
    if (!sel) return;
    let opt = [...sel.options].find(o => o.value === val);
    if (!opt) {
        opt = document.createElement('option');
        opt.value = val;
        opt.textContent = val + ' (własny)';
        sel.prepend(opt);
    }
    sel.value = val;
};

window.switchTab = function(btn, name) {
    document.querySelectorAll('.cs-outer-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.cs-outer-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`cs-panel-${name}`)?.classList.add('active');
};

window.switchInnerTab = function(btn, name) {
    const panel = btn.closest('.cs-outer-panel');
    if (!panel) return;
    panel.querySelectorAll('.cs-inner-tab').forEach(t => t.classList.remove('active'));
    panel.querySelectorAll('.cs-inner-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`cs-inner-${name}`)?.classList.add('active');
};

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

window.syncMistralApiKeysFromGlobal = function() {
    const global = globalSettings.mistralApiKeys || [];
    if (!global.length) { showToast('Brak globalnych kluczy Mistral', 'info'); return; }
    const existing = new Set(mistralApiKeys.map(k => k.key));
    const added    = global.filter(k => !existing.has(k.key));
    mistralApiKeys = [...mistralApiKeys, ...added];
    renderMistralApiKeysList();
    showToast(`Skopiowano ${added.length} klucz(y) Mistral`, 'success');
};

function collectConfig() {
    const pf  = (id, fallback) => parseFloat(document.getElementById(id)?.value ?? fallback);
    const pi  = (id, fallback) => parseInt(document.getElementById(id)?.value   ?? fallback);
    const str = (id, fallback) => document.getElementById(id)?.value.trim() || fallback;

    return {
        chat: {
            provider:             'mistral',
            temperature:          pf('g-chat-temp', 0.7),
            maxTokens:            pi('g-chat-max-tokens', 8192),
            contextTokens:        pi('g-chat-ctx', 8000),
            mistralModel:         str('g-mistral-chat-model', MISTRAL_DEFAULTS.chat.mistralModel),
            mistralModelFallback: document.getElementById('g-mistral-chat-model-fallback')?.value || null,
        },
        memory: {
            provider:             'mistral',
            temperature:          pf('g-memory-temp', 0.1),
            maxTokens:            pi('g-memory-max-tokens', 8192),
            mistralModel:         str('g-mistral-memory-model', MISTRAL_DEFAULTS.memory.mistralModel),
            mistralModelFallback: document.getElementById('g-mistral-memory-model-fallback')?.value || null,
        },
        summary: {
            provider:             'mistral',
            temperature:          pf('g-summary-temp', 0.3),
            maxTokens:            pi('g-summary-max-tokens', 8192),
            everyN:               pi('g-summary-every', 10),
            mistralModel:         str('g-mistral-summary-model', MISTRAL_DEFAULTS.summary.mistralModel),
            mistralModelFallback: null,
        },
        goals: {
            provider:     'mistral',
            temperature:  0.05,
            maxTokens:    1024,
            mistralModel: str('g-mistral-goals-model', MISTRAL_DEFAULTS.goals.mistralModel),
        },
        emotion: {
            provider:     'mistral',
            temperature:  0.05,
            maxTokens:    512,
            mistralModel: str('g-mistral-emotion-model', MISTRAL_DEFAULTS.emotion.mistralModel),
        },
        relationship: {
            provider:     'mistral',
            useLLM:       document.getElementById('g-relationship-use-llm')?.checked === true,
            maxTokens:    512,
            mistralModel: str('g-mistral-relationship-model', MISTRAL_DEFAULTS.relationship.mistralModel),
        },
        initiative:   { provider: 'deterministic', enabled: true },
        consistency:  { provider: 'deterministic', enabled: true },
        embed: {
            provider:     'mistral',
            mistralModel: str('g-mistral-embed-model', MISTRAL_DEFAULTS.embed.mistralModel),
        },
        mistralApiKeys: [...mistralApiKeys],
        chatLang:       str('g-chat-lang', 'pl'),
        prompts: savedChatConfig?.prompts || {},
    };
}

window.openPromptSettings = function() {
    if (!chatId) return;
    window.location.href = `prompt-settings.html?chatId=${chatId}`;
};

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

window.goBack = function() {
    window.location.href = 'index.html';
};

function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
}

function setSlider(sliderId, valueId, val) {
    const slider  = document.getElementById(sliderId);
    const valueEl = document.getElementById(valueId);
    if (slider)  slider.value = val;
    if (valueEl) valueEl.textContent = (+val).toFixed(2);
}

init();
