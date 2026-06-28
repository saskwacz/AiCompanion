/**
 * prompt-settings-page.js — Per-service prompt editor
 */

import { openDB } from './db.js';
import { getChatById, updateChat } from './chats.js';
import { resolveChatConfig } from './chat-config.js';
import { SERVICE_REGISTRY, SERVICE_IDS } from './companion/config/serviceRegistry.js';
import {
    getPrompt, getDefaultPrompt, setPrompt, resetPrompt,
    exportPrompts, importPrompts as importPromptsData,
} from './companion/prompts/promptConfigService.js';
import { getModelListForService, MISTRAL_DEFAULTS } from './providers/mistral-models.js';
import { escapeHtml, showToast } from './ui.js';

const params = new URLSearchParams(window.location.search);
const chatId = params.get('chatId') ? parseInt(params.get('chatId')) : null;

let chatConfig = null;
let customPrompts = {};
let currentService = 'chat';

async function init() {
    await openDB();
    if (!chatId) { showToast('Brak chatId', 'error'); return; }
    const chat = await getChatById(chatId);
    if (!chat) { showToast('Czat nie znaleziony', 'error'); return; }
    chatConfig = resolveChatConfig(chat);
    customPrompts = { ...(chatConfig.prompts || {}) };
    buildServiceSelect();
    selectService('chat');
}

function buildServiceSelect() {
    const sel = document.getElementById('ps-service');
    if (!sel) return;
    sel.innerHTML = SERVICE_IDS.map(id => {
        const meta = SERVICE_REGISTRY[id];
        return `<option value="${id}">${escapeHtml(meta?.label || id)}</option>`;
    }).join('');
}

window.selectService = function(serviceId) {
    currentService = serviceId;
    const meta = SERVICE_REGISTRY[serviceId];
    const lang = chatConfig.chatLang || 'pl';

    document.getElementById('ps-description').textContent = meta?.description || '';
    const note = document.getElementById('ps-deterministic-note');
    if (!meta?.usesLLM) {
        note.classList.remove('hidden');
        note.textContent = 'Ta usługa jest deterministyczna — prompt służy tylko dokumentacji.';
    } else {
        note.classList.add('hidden');
    }

    const taskCfg = chatConfig[serviceId] || {};
    const model = taskCfg.mistralModel || MISTRAL_DEFAULTS[serviceId]?.mistralModel || '—';
    document.getElementById('ps-model-badge').textContent = meta?.usesLLM ? `Model: ${model}` : 'Bez LLM';

    const text = customPrompts[serviceId] ?? getDefaultPrompt(serviceId, lang);
    document.getElementById('ps-prompt').value = text;
};

window.resetCurrentPrompt = function() {
    const lang = chatConfig.chatLang || 'pl';
    customPrompts = resetPrompt({ prompts: customPrompts }, currentService);
    document.getElementById('ps-prompt').value = getDefaultPrompt(currentService, lang);
    showToast('Przywrócono domyślny prompt', 'success');
};

window.savePromptSettings = async function() {
    const textarea = document.getElementById('ps-prompt');
    const lang = chatConfig.chatLang || 'pl';
    const defaultText = getDefaultPrompt(currentService, lang);
    if (textarea.value.trim() && textarea.value.trim() !== defaultText.trim()) {
        customPrompts = setPrompt({ prompts: customPrompts }, currentService, textarea.value);
    } else {
        customPrompts = resetPrompt({ prompts: customPrompts }, currentService);
    }

    try {
        const chat = await getChatById(chatId);
        const config = { ...resolveChatConfig(chat), prompts: customPrompts };
        await updateChat(chatId, { config });
        showToast('Prompty zapisane', 'success');
    } catch (e) {
        showToast('Błąd: ' + e.message, 'error');
    }
};

window.exportPrompts = function() {
    const data = exportPrompts({ prompts: customPrompts }, chatConfig.chatLang || 'pl');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `aicomp-prompts-chat${chatId}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
};

window.importPrompts = function() {
    document.getElementById('ps-import-file')?.click();
};

document.getElementById('ps-import-file')?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        customPrompts = importPromptsData({ prompts: customPrompts }, data);
        selectService(currentService);
        showToast('Zaimportowano prompty', 'success');
    } catch (err) {
        showToast('Błąd importu: ' + err.message, 'error');
    }
    e.target.value = '';
});

window.goBack = () => {
    window.location.href = chatId ? `chat-settings.html?chatId=${chatId}` : 'index.html';
};

init();
