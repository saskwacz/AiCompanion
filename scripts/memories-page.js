/**
 * memories-page.js — standalone memory page (memories.html)
 */

import { openDB }                                       from './db.js';
import { getChatById }                                    from './chats.js';
import { getCharacterById }                               from './characters.js';
import { getMessagesForChat }                             from './messages.js';
import { resolveChatConfig }                              from './chat-config.js';
import { getShuffledApiKeys, getShuffledMistralApiKeys,
         getShuffledGroqApiKeys, getShuffledOpenRouterApiKeys,
         getShuffledOpenaiApiKeys, getShuffledClaudeApiKeys } from './settings.js';
import { GEMINI_DEFAULTS }                                from './providers/gemini-models.js';
import { getMemoryForChat, updateMemoryFromExchange }     from './memory.js';
import { escapeHtml, showToast }                          from './ui.js';

const params = new URLSearchParams(window.location.search);
const chatId = params.get('chatId') ? parseInt(params.get('chatId')) : null;

let chatData  = null;
let charData  = null;
let msgs      = [];
let memory    = null;
let memCfg    = null;
let embedCfg  = null;
let maxTok    = 8192;
let refreshing = false;

async function init() {
    try {
        await openDB();
        if (!chatId) { setContent('<p class="error-text">Brak chatId w URL.</p>'); return; }

        chatData = await getChatById(chatId);
        if (!chatData) { setContent('<p class="error-text">Czat nie znaleziony.</p>'); return; }

        charData = await getCharacterById(chatData.characterId);
        msgs     = await getMessagesForChat(chatId);
        memory   = await getMemoryForChat(chatId);

        const cfg = resolveChatConfig(chatData);
        memCfg    = buildProviderCfg(cfg, 'memory');
        embedCfg  = buildProviderCfg(cfg, 'embed');
        maxTok    = cfg.memory?.maxTokens ?? 8192;

        document.getElementById('page-title').textContent =
            `Pamięć — ${chatData.title || charData?.name || 'czat'}`;

        render();
    } catch (err) {
        console.error('[MemoriesPage] Init error:', err);
        setContent(`<p class="error-text">Błąd: ${escapeHtml(err.message)}</p>`);
    }
}

function buildProviderCfg(cfg, role) {
    const taskCfg  = cfg[role] || GEMINI_DEFAULTS[role] || {};
    const provider = taskCfg.provider || 'gemini';

    let model, modelFallback, keys;
    if (provider === 'ollama') {
        model = taskCfg.ollamaModel || null;
        modelFallback = null;
        keys = [];
    } else if (provider === 'mistral') {
        model = taskCfg.mistralModel || null;
        modelFallback = taskCfg.mistralModelFallback || null;
        keys = getShuffledMistralApiKeys(cfg);
    } else if (provider === 'groq') {
        model = taskCfg.groqModel || null;
        modelFallback = taskCfg.groqModelFallback || null;
        keys = getShuffledGroqApiKeys(cfg);
    } else if (provider === 'openrouter') {
        model = taskCfg.openrouterModel || null;
        modelFallback = taskCfg.openrouterModelFallback || null;
        keys = getShuffledOpenRouterApiKeys(cfg);
    } else if (provider === 'openai') {
        model = taskCfg.openaiModel || null;
        modelFallback = taskCfg.openaiModelFallback || null;
        keys = getShuffledOpenaiApiKeys(cfg);
    } else if (provider === 'claude') {
        model = taskCfg.claudeModel || null;
        modelFallback = taskCfg.claudeModelFallback || null;
        keys = getShuffledClaudeApiKeys(cfg);
    } else {
        model = taskCfg.geminiModel || null;
        modelFallback = taskCfg.geminiModelFallback || null;
        keys = getShuffledApiKeys(cfg);
    }

    return {
        provider,
        keys,
        ollamaUrl: cfg.ollamaBaseUrl || 'http://localhost:11434',
        model,
        modelFallback,
        lang: cfg.chatLang || 'pl',
    };
}

function setContent(html) {
    const el = document.getElementById('memory-content');
    if (el) el.innerHTML = html;
}

function countItems(mem) {
    if (!mem) return 0;
    return ['charProfile', 'charGoals', 'charMemories', 'profile', 'goals', 'memories']
        .reduce((n, k) => n + (mem[k]?.length || 0), 0);
}

function renderSection(mem, key, label) {
    const items  = mem[key] || [];
    const sorted = [...items].sort((a, b) => (a.firstSeen || 0) - (b.firstSeen || 0));
    return `
        <div class="memory-section">
            <div class="memory-section-title">${label}</div>
            ${sorted.length
                ? `<ul class="memory-list">${sorted.map(i => {
                    const text      = escapeHtml(i.text || i);
                    const count     = i.count || 1;
                    const badge     = count > 1 ? `<span class="mem-count" title="wspomniano ${count} razy">x${count}</span>` : '';
                    const dateStr   = i.firstSeen
                        ? new Date(i.firstSeen).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })
                        : '';
                    const dateBadge = dateStr ? `<span class="mem-date" title="Pierwsze pojawienie: ${dateStr}">${dateStr}</span>` : '';
                    const msgBadge  = i.createdAtMsgId != null
                        ? `<span class="mem-msgid" title="Powstało przy wiadomości #${i.createdAtMsgId}">msg#${i.createdAtMsgId}</span>`
                        : '';
                    return `<li>${text}${badge}${dateBadge}${msgBadge}</li>`;
                }).join('')}</ul>`
                : `<p class="memory-empty-section">Nic jeszcze nie zapisano</p>`}
        </div>`;
}

function render() {
    const info = document.getElementById('memory-info');
    if (!memory) {
        setContent('<p class="memory-empty">Brak danych pamięci dla tego czatu.</p>');
        if (info) info.textContent = '';
        return;
    }

    const charName = escapeHtml(charData?.name || 'Postać');
    setContent(
        `<div class="memory-group-title">O ${charName}</div>` +
        [['charProfile', '🧬 Profil postaci'], ['charGoals', '🎯 Cele postaci'], ['charMemories', '📖 Wspomnienia postaci']]
            .map(([k, l]) => renderSection(memory, k, l)).join('') +
        `<div class="memory-group-title">O użytkowniku</div>` +
        [['profile', '📋 Profil użytkownika'], ['goals', '🏆 Cele użytkownika'], ['memories', '💭 Wspólne wspomnienia']]
            .map(([k, l]) => renderSection(memory, k, l)).join('')
    );

    if (info) {
        info.textContent = `${countItems(memory)} wpisów · ${msgs.length} wiadomości w czacie`;
    }
}

window.refreshMemory = async function() {
    if (refreshing) return;
    if (!chatId || msgs.length < 2) {
        showToast('Potrzeba co najmniej dwóch wiadomości, aby odświeżyć pamięć', 'info');
        return;
    }

    const lastUser = [...msgs].reverse().find(m => m.role === 'user');
    const lastAi   = [...msgs].reverse().find(m => m.role === 'assistant');
    if (!lastUser || !lastAi) {
        showToast('Brak ostatniej wymiany user/assistant', 'info');
        return;
    }

    refreshing = true;
    const btn = document.getElementById('btn-refresh');
    if (btn) btn.disabled = true;
    showToast('Aktualizuję pamięć…', 'info');

    try {
        memory = await updateMemoryFromExchange(
            chatId, lastUser.content, lastAi.content, memCfg,
            charData, msgs, maxTok, null, embedCfg,
        );
        render();
        showToast('Pamięć zaktualizowana', 'success');
    } catch (err) {
        console.error('[MemoriesPage] Refresh error:', err);
        showToast('Błąd aktualizacji pamięci: ' + err.message, 'error');
    } finally {
        refreshing = false;
        if (btn) btn.disabled = false;
    }
};

window.goBack = function() {
    window.location.href = 'index.html';
};

init();
