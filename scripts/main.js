import { openDB }                                                      from './db.js';
import { loadSettings, persistSettings, getShuffledApiKeys,
         getShuffledMistralApiKeys }                                    from './settings.js';
import { getCharacterById, getAllCharacters,
         getCharacterAvatar }                                           from './characters.js';
import { callChatAPI, buildSystemPrompt, AllModelsRateLimitedError } from './providers/index.js';
import { createChat, updateChat, deleteChatById,
         getChatById, getChatsForCharacter }                            from './chats.js';
import { addMessage, getMessagesForChat, deleteMessageById,
         deleteMessagesFrom, deleteAllForChat }                         from './messages.js';
import { getMemoryForChat, computeMemoryUpdate, persistMemory,
         updateMemoryFromExchange,
         seedMemoryFromCharacter, memoryToContext,
         pruneMemoryByMsgIds }                                          from './memory.js';
import { getSummaryState, saveSummaryState, deleteSummaryForChat,
         buildSummaryContext,
         computeRolling, computeChunk, computeMedium, computeGlobal,
         shouldBuildChunk,
         isProhibitedContent,
         computeRollingFallback, computeChunkFallback,
         CHUNK_SIZE, MEDIUM_FROM_CHUNKS, GLOBAL_FROM_MEDIUMS,
         generateAndSaveSummary }                                       from './summary.js';
import { exportChat, importChatFromFile }                               from './export.js';
import { escapeHtml, parseMessageMarkup, showToast, formatTimestamp }   from './ui.js';

import {
    GEMINI_DEFAULTS,
    resolveChatConfig,
    buildDefaultChatConfig as _buildDefault,
} from './chat-config.js';

// ============ PROVIDER CONFIG ============

/** Format AllModelsRateLimitedError into a short user-visible string. */
function formatRateLimitMsg(e) {
    if (!(e instanceof AllModelsRateLimitedError)) return e.message;
    return e.message; // already contains human-readable time from the constructor
}

/**
 * Build a providerConfig for a given task role from the current per-chat config.
 * Uses geminiModel or ollamaModel depending on the active provider.
 */
function getProviderConfig(role = 'chat') {
    const cfg      = currentChatConfig || GEMINI_DEFAULTS;
    const taskCfg  = cfg[role] || GEMINI_DEFAULTS[role] || {};
    const provider = taskCfg.provider || 'gemini';

    let model, modelFallback, keys;
    if (provider === 'ollama') {
        model        = taskCfg.ollamaModel || null;
        modelFallback = null;
        keys          = [];
    } else if (provider === 'mistral') {
        model         = taskCfg.mistralModel || null;
        modelFallback = taskCfg.mistralModelFallback || null;
        keys          = getShuffledMistralApiKeys(cfg);
    } else {
        // gemini (default)
        model         = taskCfg.geminiModel || null;
        modelFallback = taskCfg.geminiModelFallback || null;
        keys          = getShuffledApiKeys(cfg);
    }

    return {
        provider,
        keys,
        ollamaUrl: cfg.ollamaBaseUrl || 'http://localhost:11434',
        model,
        modelFallback,
        lang:      cfg.chatLang || 'pl',
    };
}

/** Return the task-level generation params (temperature, maxTokens, …) for a role. */
function getTaskCfg(role) {
    const cfg = currentChatConfig || GEMINI_DEFAULTS;
    return cfg[role] || GEMINI_DEFAULTS[role] || {};
}

/** Build initial chat config for a new chat, seeded with global API keys. */
function buildDefaultChatConfig() {
    return _buildDefault(settings.apiKeys, settings.ollamaBaseUrl, settings.mistralApiKeys);
}

// ============ STATE ============
let settings             = {};
let currentCharacter     = null;
let currentChat          = null;
let currentChatConfig    = null;
let currentMessages      = [];
let currentMemory        = null;
let currentChatSummary   = null;
let currentChatError     = null;   // { text, isRateLimit } — error bubble shown in chat
let isLoading            = false;
let lastFailedMessage    = null;
let currentSummary       = '';
let memoryPanelOpen      = false;
let aiResponseCount      = 0;
let pendingRequests      = 0;
let currentCharacterAvatarUrl = null;

function setPendingRequest(delta) {
    pendingRequests = Math.max(0, pendingRequests + delta);
    const input   = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const locked  = pendingRequests > 0;
    if (input)   { input.disabled   = locked; if (!locked) input.focus(); }
    if (sendBtn) { sendBtn.disabled = locked; }
}

// ============ SCROLL BUTTONS ============
let isNearTop    = true;
let isNearBottom = true;

function updateScrollButtonVisibility() {
    const container = document.getElementById('messages-container');
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const threshold = 100;

    isNearTop = scrollTop < threshold;
    document.getElementById('scroll-to-top')?.classList.toggle('visible', !isNearTop);

    const distFromBottom = scrollHeight - (scrollTop + clientHeight);
    isNearBottom = distFromBottom < threshold;
    document.getElementById('scroll-to-bottom')?.classList.toggle('visible', !isNearBottom);
}

function scrollToMessagesTop()    { const c = document.getElementById('messages-container'); if (c) c.scrollTop = 0; }
function scrollToMessagesBottom() { const c = document.getElementById('messages-container'); if (c) c.scrollTop = Math.max(c.scrollHeight - c.clientHeight, 0); }

// ============ INIT ============
async function init() {
    try {
        await openDB();
        settings = await loadSettings();
        window.DEBUG_PROMPTS = !!settings.debugPrompts;
        applyChatFontSize(settings.chatFontSize ?? 14);

        // Restore state after returning from a sub-page
        const savedCharId = sessionStorage.getItem('returnCharId');
        const savedChatId = sessionStorage.getItem('returnChatId');
        sessionStorage.removeItem('returnCharId');
        sessionStorage.removeItem('returnChatId');

        const chars = await getAllCharacters();
        if (chars.length === 0) {
            showWelcomeScreen();
        } else {
            const targetChar = savedCharId ? chars.find(c => String(c.id) === savedCharId) : null;
            await selectCharacter((targetChar || chars[0]).id);

            if (savedChatId) {
                const chatIdNum = parseInt(savedChatId);
                const savedChat = await getChatById(chatIdNum);
                if (savedChat) await selectChat(chatIdNum);
            }
        }

        setupEventListeners();
    } catch (err) {
        console.error('Init error:', err);
        const c = document.getElementById('messages-container');
        if (c) c.innerHTML = `<div class="welcome-section"><h2>Error</h2><p>${escapeHtml(err.message)}</p></div>`;
    }
}

function setupEventListeners() {
    const input = document.getElementById('message-input');
    input?.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); appSendMessage(); }
    });
    input?.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });

    const mc = document.getElementById('messages-container');
    if (mc) {
        mc.addEventListener('scroll', updateScrollButtonVisibility);
        updateScrollButtonVisibility();
        document.querySelector('.scroll-buttons')?.style.setProperty('pointer-events', 'auto');
    }
}

// ============ NAVIGATION TO SUB-PAGES ============
function navigateToCharEditor(charId) {
    sessionStorage.setItem('returnCharId', String(currentCharacter?.id || ''));
    sessionStorage.setItem('returnChatId', String(currentChat?.id || ''));
    window.location.href = charId ? `character.html?id=${charId}` : 'character.html';
}

function navigateToChatSettings() {
    if (!currentChat) { showToast('Najpierw otwórz czat', 'error'); return; }
    sessionStorage.setItem('returnCharId', String(currentCharacter?.id || ''));
    sessionStorage.setItem('returnChatId', String(currentChat.id));
    window.location.href = `chat-settings.html?chatId=${currentChat.id}`;
}

// ============ CHARACTER MANAGEMENT ============
async function loadCharacterAvatar(charId) {
    if (currentCharacterAvatarUrl) {
        URL.revokeObjectURL(currentCharacterAvatarUrl);
        currentCharacterAvatarUrl = null;
    }
    if (charId) {
        const blob = await getCharacterAvatar(charId);
        if (blob) currentCharacterAvatarUrl = URL.createObjectURL(blob);
    }
}

async function selectCharacter(charId) {
    currentCharacter = await getCharacterById(charId);
    if (!currentCharacter) return;

    await loadCharacterAvatar(charId);

    const el = document.getElementById('current-char-name');
    const av = document.getElementById('current-char-avatar');
    if (el) el.textContent = currentCharacter.name;
    if (av) {
        if (currentCharacterAvatarUrl) {
            av.innerHTML = `<img src="${currentCharacterAvatarUrl}" alt="avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
        } else {
            av.innerHTML = '';
            av.textContent = (currentCharacter.name[0] || '?').toUpperCase();
        }
    }

    const chats = await getChatsForCharacter(charId);
    renderChatList(chats);

    if (chats.length > 0) await selectChat(chats[0].id);
    else                  await createNewChat();
}

// ============ CHAT MANAGEMENT ============
async function createNewChat() {
    if (!currentCharacter) { showToast('Select a character first', 'error'); return; }

    const initConfig = buildDefaultChatConfig();
    const chat = await createChat(currentCharacter.id, initConfig);

    if (currentCharacter.welcomeMessage) {
        const msg = await addMessage(chat.id, 'assistant', currentCharacter.welcomeMessage);
        await updateChat(chat.id, {
            messageCount:    1,
            lastMessage:     currentCharacter.welcomeMessage.substring(0, 80),
            lastMessageTime: msg.timestamp,
            updatedAt:       Date.now(),
        });
    }

    currentChat       = await getChatById(chat.id);
    currentChatConfig = resolveChatConfig(currentChat);
    await selectChat(currentChat.id);
    renderChatList(await getChatsForCharacter(currentCharacter.id));

    const memCfgSeed = getProviderConfig('memory');
    setTimeout(async () => {
        const seeded = await seedMemoryFromCharacter(chat.id, currentCharacter, memCfgSeed, null, getTaskCfg('memory').maxTokens ?? 8192);
        if (seeded && currentChat?.id === chat.id) {
            currentMemory = seeded;
            renderMemoryPanel();
        }
    }, 300);
}

async function selectChat(chatId) {
    currentChat        = await getChatById(chatId);
    if (!currentChat) return;
    currentChatConfig  = resolveChatConfig(currentChat);
    currentMessages    = await getMessagesForChat(chatId);
    currentMemory      = await getMemoryForChat(chatId);
    currentChatSummary = await getSummaryState(chatId);
    currentChatError   = null;
    aiResponseCount    = currentMessages.filter(m => m.role === 'assistant').length;

    const titleEl = document.getElementById('chat-title');
    if (titleEl) titleEl.textContent = currentChat.title || 'Chat';

    renderMessages();
    updateScrollButtonVisibility();
    if (memoryPanelOpen) renderMemoryPanel();

    document.querySelectorAll('.chat-item-wrapper').forEach(el => {
        el.classList.toggle('active', el.dataset.chatId === String(chatId));
    });

    document.getElementById('message-input')?.focus();

    /* Close mobile sidebar after selecting a chat */
    document.querySelector('.sidebar')?.classList.remove('sidebar-open');
    document.getElementById('sidebar-backdrop')?.classList.remove('active');
}

async function deleteChatConfirm(chatId) {
    if (!confirm('Delete this chat and all its messages? This cannot be undone.')) return;
    await deleteAllForChat(chatId);
    await deleteSummaryForChat(chatId);
    await deleteChatById(chatId);

    const chats = await getChatsForCharacter(currentCharacter.id);
    renderChatList(chats);

    if (currentChat?.id === chatId) {
        currentChat = null; currentMessages = []; currentMemory = null; currentChatConfig = null;
        currentChatError = null;
        if (chats.length > 0) await selectChat(chats[0].id);
        else showWelcomeScreen();
    }
}

// ============ SEND MESSAGE ============
async function appSendMessage(retryText) {
    const input   = document.getElementById('message-input');
    const message = retryText || input?.value.trim();

    if (!message || isLoading)     return;
    if (!currentChat)              { showToast('Select a chat first', 'error'); return; }

    const chatCfg  = getProviderConfig('chat');
    const embedCfg = getProviderConfig('embed');

    if (chatCfg.provider === 'gemini'  && !chatCfg.keys.length) {
        showToast('Dodaj klucz API Gemini w ustawieniach czatu', 'error'); return;
    }
    if (chatCfg.provider === 'mistral' && !chatCfg.keys.length) {
        showToast('Dodaj klucz API Mistral w ustawieniach czatu', 'error'); return;
    }

    // On retry: the user message may already be saved in DB (from a previous failed attempt).
    // Detect this to avoid inserting a duplicate.
    const lastSaved = currentMessages[currentMessages.length - 1];
    const alreadySaved = retryText && lastSaved?.role === 'user' && lastSaved?.content === retryText;

    let userMsg;
    if (alreadySaved) {
        userMsg = lastSaved;
    } else {
        userMsg = await addMessage(currentChat.id, 'user', message);
        currentMessages = [...currentMessages, userMsg];
    }

    // Clear any previous error bubble
    currentChatError = null;

    if (currentMessages.filter(m => m.role === 'user').length === 1) {
        const title = message.substring(0, 55) + (message.length > 55 ? '…' : '');
        await updateChat(currentChat.id, { title });
        currentChat.title = title;
        const el = document.getElementById('chat-title');
        if (el) el.textContent = title;
    }

    if (input && !retryText) { input.value = ''; input.style.height = 'auto'; }

    isLoading = true;
    setPendingRequest(+1);
    renderMessages();
    showTypingIndicator();

    try {
        // ── Step 1: get AI response text (not saved to DB yet) ──
        const memCtx       = await memoryToContext(currentMemory, { query: message, cfg: embedCfg });
        const systemPrompt = buildSystemPrompt(chatCfg, currentCharacter, memCtx);
        const chatTask     = getTaskCfg('chat');

        const response = await callChatAPI(chatCfg, {
            messages:      currentMessages,
            systemPrompt,
            chatSummary: {
                text:    buildSummaryContext(currentChatSummary),
                rolling: currentChatSummary?.rolling?.text || '',
            },
            temperature:   chatTask.temperature,
            maxTokens:     chatTask.maxTokens,
            contextTokens: chatTask.contextTokens,
        });

        // ── Step 2: compute background tasks (no DB writes, throw on failure) ──
        const memCfg  = getProviderConfig('memory');
        const sumCfg  = getProviderConfig('summary');
        const chatId  = currentChat.id;
        const char    = currentCharacter;
        const msgs    = [...currentMessages];    // snapshot without AI msg
        const state   = currentChatSummary ?? { chatId, rolling: null, chunks: [], medium: [], global: null, prohibitedMsgIds: [] };
        const maxTok  = getTaskCfg('summary').maxTokens ?? 8192;
        const doChunk = shouldBuildChunk(msgs, currentChatSummary);

        const [computedMem, rollingResult, computedHistoryTiers] = await Promise.all([
            computeMemoryUpdate(
                chatId, message, response, memCfg,
                char, msgs,
                getTaskCfg('memory').maxTokens ?? 8192,
                null,
                embedCfg
            ),
            computeRollingFallback(msgs, char, sumCfg, Math.min(maxTok, 4096)),
            doChunk
                ? _computeHistoryTiers(state, msgs, char, sumCfg, maxTok)
                : null,
        ]);

        // ── Step 3: all computed successfully → commit everything atomically ──
        const aiMsg = await addMessage(chatId, 'assistant', response);
        currentMessages = [...currentMessages, aiMsg];

        await persistMemory(computedMem);

        let newState = { ...state };
        const { rolling: computedRolling, prohibitedIds: rollingProhibitedIds } = rollingResult;
        if (computedRolling) newState.rolling = computedRolling;
        if (rollingProhibitedIds?.length) {
            const existing = new Set(newState.prohibitedMsgIds ?? []);
            rollingProhibitedIds.forEach(id => existing.add(id));
            newState.prohibitedMsgIds = [...existing];
        }
        if (computedHistoryTiers) {
            const { newChunk, newMedium, newGlobal, newProhibitedIds } = computedHistoryTiers;
            if (newChunk) {
                const unsorted = [...(state.chunks || []), newChunk];
                newState.chunks = unsorted.sort((a, b) => (a.fromMsg ?? 0) - (b.fromMsg ?? 0));
            }
            if (newMedium) newState.medium = [...(state.medium || []), newMedium];
            if (newGlobal) newState.global  = newGlobal;
            if (newProhibitedIds?.length) {
                const existing = new Set(newState.prohibitedMsgIds ?? []);
                newProhibitedIds.forEach(id => existing.add(id));
                newState.prohibitedMsgIds = [...existing];
            }
        }
        await saveSummaryState(newState);

        // ── Step 4: update metadata & in-memory state ──
        await updateChat(chatId, {
            messageCount:    currentMessages.length,
            lastMessage:     response.substring(0, 80),
            lastMessageTime: aiMsg.timestamp,
            updatedAt:       Date.now(),
        });

        currentMemory      = computedMem;
        currentChatSummary = newState;
        aiResponseCount++;

        lastFailedMessage = null;
        hideRetryBar();

        // ── Step 5: render ──
        renderMessages();
        renderMemoryPanel();
        renderChatList(await getChatsForCharacter(currentCharacter.id));

    } catch (err) {
        // Keep user message in chat. Show error bubble instead of deleting.
        const isRateLimit = err instanceof AllModelsRateLimitedError;
        const text = isRateLimit
            ? formatRateLimitMsg(err)
            : `Nie udało się przetworzyć wiadomości: ${err.message}`;

        currentChatError = { text, isRateLimit };
        lastFailedMessage = message;

        renderMessages();   // re-renders with error bubble appended

        if (isRateLimit) {
            document.getElementById('message-input')?.setAttribute('disabled', 'true');
            document.getElementById('send-btn')?.setAttribute('disabled', 'true');
        }
    } finally {
        isLoading = false;
        setPendingRequest(-1);
        hideTypingIndicator();
    }
}

/** Returns true when an API error indicates prohibited/blocked content (not a network/rate error). */
async function _computeHistoryTiers(state, messages, char, sumCfg, maxTok) {
    const prohibitedIds = new Set(state.prohibitedMsgIds ?? []);
    const filteredMsgs  = messages.filter(m => !prohibitedIds.has(m.id));

    const chunkIdx   = state.chunks?.length ?? 0;
    const chunkStart = chunkIdx * CHUNK_SIZE;
    const chunkEnd   = chunkStart + CHUNK_SIZE;
    const chunkMsgs  = filteredMsgs.slice(chunkStart, chunkEnd);

    const { chunks: fallbackChunks, prohibited: newProhibitedIds } =
        await computeChunkFallback(chunkMsgs, char, sumCfg, Math.min(maxTok, 4096));

    const newChunk = fallbackChunks[0] ?? null;
    if (!newChunk) {
        return { newChunk: null, newMedium: null, newGlobal: null, newProhibitedIds };
    }

    const allChunks    = [...(state.chunks || []), newChunk];
    const totalChunks  = allChunks.length;
    let newMedium = null;
    let newGlobal = null;

    if (totalChunks % MEDIUM_FROM_CHUNKS === 0) {
        const fromIdx      = totalChunks - MEDIUM_FROM_CHUNKS;
        const mediumChunks = allChunks.slice(fromIdx);
        try {
            newMedium = await computeMedium(mediumChunks, char, sumCfg, Math.min(maxTok, 4096), fromIdx);
        } catch (e) {
            if (isProhibitedContent(e)) { console.warn('[Summary] Medium skipped — prohibited content:', e.message); }
            else throw e;
        }

        if (newMedium) {
            const allMediums = [...(state.medium || []), newMedium];
            if (allMediums.length % GLOBAL_FROM_MEDIUMS === 0) {
                try {
                    newGlobal = await computeGlobal(allMediums, char, sumCfg, maxTok);
                } catch (e) {
                    if (isProhibitedContent(e)) { console.warn('[Summary] Global skipped — prohibited content:', e.message); }
                    else throw e;
                }
            }
        }
    }

    return { newChunk, newMedium, newGlobal, newProhibitedIds };
}

// ============ RETRY ============
function showRetryBar(msg) {
    document.getElementById('retry-bar')?.classList.remove('hidden');
    const preview = document.getElementById('retry-message-preview');
    if (preview) preview.textContent = msg.substring(0, 65) + (msg.length > 65 ? '…' : '');
}
function hideRetryBar() {
    document.getElementById('retry-bar')?.classList.add('hidden');
}

// ============ RENDERING – MESSAGES ============
function renderMessages() {
    const container = document.getElementById('messages-container');
    if (!container) return;

    if (!currentMessages?.length) {
        container.innerHTML = `
            <div class="welcome-section">
                <h2>${escapeHtml(currentCharacter?.name || 'AiComp')}</h2>
                <p>Start the conversation</p>
            </div>`;
        return;
    }

    const prohibitedIds = new Set(currentChatSummary?.prohibitedMsgIds ?? []);

    container.innerHTML = currentMessages.map(msg => {
        const isUser      = msg.role === 'user';
        const isProhibited = prohibitedIds.has(msg.id);
        const time   = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const seqLabel = msg.seqId != null ? `<span class="msg-seq-id" title="Message #${msg.seqId}">#${msg.seqId}</span> ` : '';
        const prohibBadge = isProhibited ? `<span class="msg-prohibited-badge" title="Ta wiadomość jest wykluczona z podsumowania (prohibited content)">⚠ prohibited</span> ` : '';
        const avatarHtml = (!isUser && currentCharacterAvatarUrl)
            ? `<img src="${currentCharacterAvatarUrl}" class="msg-avatar-thumb" onclick="app.openImageLightbox()" title="Kliknij aby powiększyć" alt="avatar">`
            : '';
        return `
            <div class="message ${isUser ? 'user' : 'ai'}${isProhibited ? ' msg-prohibited' : ''}" data-msg-id="${msg.id}">
                <div class="message-wrapper">
                    ${avatarHtml}
                    <div>
                        <div class="message-content">${parseMessageMarkup(msg.content)}</div>
                        <div class="message-time">${seqLabel}${prohibBadge}${time}</div>
                    </div>
                    <button class="message-delete-btn"
                            onclick="app.deleteMessageFrom(${msg.id})"
                            title="Delete this and all following messages">✕</button>
                </div>
            </div>`;
    }).join('');

    container.scrollTop = container.scrollHeight;
    updateScrollButtonVisibility();

    // Append error bubble if present (not saved to DB, UI-only)
    if (currentChatError) {
        const errDiv = document.createElement('div');
        errDiv.className = `message ai chat-error-message${currentChatError.isRateLimit ? ' rate-limit-error' : ''}`;
        errDiv.innerHTML = `
            <div class="message-wrapper">
                <div>
                    <div class="message-content error-content">
                        ⚠️ ${escapeHtml(currentChatError.text)}
                    </div>
                    <div class="message-time error-actions">
                        <button class="btn-link retry-inline-btn" onclick="app.retryLastMessage()">Spróbuj ponownie</button>
                        <button class="btn-link dismiss-error-btn" onclick="app.dismissChatError()">Odrzuć</button>
                    </div>
                </div>
            </div>`;
        container.appendChild(errDiv);
        container.scrollTop = container.scrollHeight;
    }
}

function showTypingIndicator() {
    const c = document.getElementById('messages-container');
    if (!c || c.querySelector('.typing-message')) return;
    const d = document.createElement('div');
    d.className = 'message ai typing-message';
    d.innerHTML = `<div class="message-wrapper"><div class="message-content">
        <div class="typing-indicator">
            <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
        </div></div></div>`;
    c.appendChild(d);
    c.scrollTop = c.scrollHeight;
    updateScrollButtonVisibility();
}
function hideTypingIndicator() { document.querySelector('.typing-message')?.remove(); }

function applyChatFontSize(size) {
    document.documentElement.style.setProperty('--chat-font-size', `${size}px`);
}

function renderChatList(chats) {
    const el = document.getElementById('chat-list');
    if (!el) return;

    if (!chats?.length) {
        el.innerHTML = '<div class="no-chats">No chats yet</div>';
        return;
    }

    el.innerHTML = chats.map(c => `
        <div class="chat-item-wrapper ${currentChat?.id === c.id ? 'active' : ''}" data-chat-id="${c.id}">
            <div class="chat-item" onclick="app.selectChat(${c.id})">
                <div class="chat-item-title">${escapeHtml(c.title || 'New Chat')}</div>
                <div class="chat-item-preview">${escapeHtml(c.lastMessage || '…')}</div>
                <div class="chat-item-meta">
                    <span>${c.messageCount || 0} msgs</span>
                    <span>${formatTimestamp(c.lastMessageTime)}</span>
                </div>
            </div>
            <button class="chat-delete-btn"
                    onclick="app.deleteCurrentChatConfirm(${c.id})"
                    title="Delete chat">✕</button>
        </div>`).join('');
}

// ============ MEMORY PANEL ============
function toggleMemoryPanel() {
    memoryPanelOpen = !memoryPanelOpen;
    document.getElementById('memory-panel')?.classList.toggle('open', memoryPanelOpen);
    if (memoryPanelOpen) renderMemoryPanel();
}

function renderMemoryPanel() {
    const body = document.getElementById('memory-panel-body');
    if (!body) return;

    if (!currentMemory || !currentChat) {
        body.innerHTML = '<p class="memory-empty">Open a chat to view memory</p>';
        return;
    }

    const renderSection = (key, label) => {
        const items  = currentMemory[key] || [];
        const sorted = [...items].sort((a, b) => (a.firstSeen || 0) - (b.firstSeen || 0));
        return `
            <div class="memory-section">
                <div class="memory-section-title">${label}</div>
                ${sorted.length
                    ? `<ul class="memory-list">${sorted.map(i => {
                        const text      = escapeHtml(i.text || i);
                        const count     = i.count || 1;
                        const badge     = count > 1 ? `<span class="mem-count" title="wspomniano ${count} razy">x${count}</span>` : '';
                        const dateStr   = i.firstSeen ? new Date(i.firstSeen).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
                        const dateBadge = dateStr ? `<span class="mem-date" title="Pierwsze pojawienie: ${dateStr}">${dateStr}</span>` : '';
                        const msgBadge  = i.createdAtMsgId != null ? `<span class="mem-msgid" title="Powstało przy wiadomości #${i.createdAtMsgId}">msg#${i.createdAtMsgId}</span>` : '';
                        return `<li>${text}${badge}${dateBadge}${msgBadge}</li>`;
                      }).join('')}</ul>`
                    : `<p class="memory-empty-section">Nothing recorded yet</p>`}
            </div>`;
    };

    body.innerHTML =
        `<div class="memory-group-title">About ${escapeHtml(currentCharacter?.name || 'Character')}</div>` +
        [['charProfile','🧬 Self-profile'],['charGoals','🎯 Own goals'],['charMemories','📖 Own memories']].map(([k,l]) => renderSection(k,l)).join('') +
        `<div class="memory-group-title">About the User</div>` +
        [['profile','📋 User profile'],['goals','🏆 User goals'],['memories','💭 Shared memories']].map(([k,l]) => renderSection(k,l)).join('');
}

async function refreshMemory() {
    if (!currentChat || currentMessages.length < 2) {
        showToast('Need more conversation to refresh memory', 'info'); return;
    }
    const memCfg  = getProviderConfig('memory');
    showToast('Updating memory…', 'info');
    const lastUser = [...currentMessages].reverse().find(m => m.role === 'user');
    const lastAi   = [...currentMessages].reverse().find(m => m.role === 'assistant');
    if (lastUser && lastAi) {
        currentMemory = await updateMemoryFromExchange(
            currentChat.id, lastUser.content, lastAi.content, memCfg,
            currentCharacter, currentMessages, getTaskCfg('memory').maxTokens ?? 8192
        );
        renderMemoryPanel();
        showToast('Memory updated', 'success');
    }
}

// ============ DELETE MESSAGE ============
async function deleteMessageFrom(msgId) {
    if (!confirm('Delete this message and all messages after it?')) return;
    const { remaining, deletedSeqIds, deletedIds } = await deleteMessagesFrom(currentChat.id, msgId);
    currentMessages = remaining;

    if (deletedSeqIds.length) {
        currentMemory = await pruneMemoryByMsgIds(currentChat.id, deletedSeqIds) ?? currentMemory;
        if (memoryPanelOpen) renderMemoryPanel();
    }

    const last = remaining.at(-1);
    await updateChat(currentChat.id, {
        messageCount:    remaining.length,
        lastMessage:     last?.content.substring(0, 80) ?? null,
        lastMessageTime: last?.timestamp ?? null,
    });

    // Rebuild summary — old state is stale after message deletion.
    // Keep only rolling (recomputed from remaining); discard chunks/medium/global.
    const sumCfg = getProviderConfig('summary');
    const maxTok = getTaskCfg('summary').maxTokens ?? 8192;
    // Preserve surviving prohibited IDs after deletion; discard chunk/medium/global (stale).
    const survivingProhibitedIds = (currentChatSummary?.prohibitedMsgIds ?? [])
        .filter(id => !(deletedIds ?? []).includes(id));
    const freshState = {
        chatId: currentChat.id,
        rolling: null, chunks: [], medium: [], global: null,
        prohibitedMsgIds: survivingProhibitedIds,
    };

    if (remaining.length >= 2) {
        try {
            showToast('Przeliczam podsumowanie…', 'info', 2000);
            const computedRolling = await computeRolling(
                remaining, currentCharacter, sumCfg, Math.min(maxTok, 4096)
            );
            if (computedRolling) freshState.rolling = computedRolling;
        } catch (e) {
            if (!isProhibitedContent(e)) console.warn('[Summary] Rebuild after delete failed:', e.message);
        }
    }

    await saveSummaryState(freshState);
    currentChatSummary = freshState;

    renderMessages();
    renderChatList(await getChatsForCharacter(currentCharacter.id));
}

// ============ GLOBAL SETTINGS MODAL ============
async function openSettings() {
    const dp    = document.getElementById('debug-prompts');
    const obu   = document.getElementById('ollama-base-url');
    const fs    = document.getElementById('chat-font-size');
    const fsVal = document.getElementById('chat-font-size-value');
    const curFs = settings.chatFontSize ?? 14;

    if (dp)    dp.checked        = !!settings.debugPrompts;
    if (obu)   obu.value         = settings.ollamaBaseUrl || 'http://localhost:11434';
    if (fs)    fs.value          = curFs;
    if (fsVal) fsVal.textContent = curFs;

    renderApiKeysList();
    renderMistralApiKeysList();
    openModal('settings-modal');
}

function renderApiKeysList() {
    const list = document.getElementById('api-keys-list');
    if (!list) return;
    const keys = settings.apiKeys || [];
    list.innerHTML = keys.length
        ? keys.map((k, i) => `
            <div class="api-key-item">
                <span class="api-key-label">${escapeHtml(k.label || `Key ${i + 1}`)}</span>
                <span class="api-key-masked">••••••••${escapeHtml(k.key.slice(-4))}</span>
                <button class="btn-danger small" onclick="app.removeApiKey(${i})">Usuń</button>
            </div>`).join('')
        : '<p class="no-keys">Brak kluczy</p>';
}

function addApiKeyRow() {
    const labelEl = document.getElementById('new-key-label');
    const keyEl   = document.getElementById('new-key-value');
    const key     = keyEl?.value.trim();
    if (!key) { showToast('Klucz nie może być pusty', 'error'); return; }
    settings.apiKeys = [...(settings.apiKeys || []),
        { label: labelEl?.value.trim() || `Key ${(settings.apiKeys?.length || 0) + 1}`, key }];
    if (labelEl) labelEl.value = '';
    if (keyEl)   keyEl.value   = '';
    renderApiKeysList();
}

function removeApiKey(idx) {
    if (!confirm('Usunąć ten klucz?')) return;
    settings.apiKeys = settings.apiKeys.filter((_, i) => i !== idx);
    renderApiKeysList();
}

// ── Mistral global keys ──
function renderMistralApiKeysList() {
    const list = document.getElementById('mistral-api-keys-list');
    if (!list) return;
    const keys = settings.mistralApiKeys || [];
    list.innerHTML = keys.length
        ? keys.map((k, i) => `
            <div class="api-key-item">
                <span class="api-key-label">${escapeHtml(k.label || `Key ${i + 1}`)}</span>
                <span class="api-key-masked">••••••••${escapeHtml(k.key.slice(-4))}</span>
                <button class="btn-danger small" onclick="app.removeMistralApiKey(${i})">Usuń</button>
            </div>`).join('')
        : '<p class="no-keys">Brak kluczy</p>';
}

function addMistralApiKeyRow() {
    const labelEl = document.getElementById('new-mistral-key-label');
    const keyEl   = document.getElementById('new-mistral-key-value');
    const key     = keyEl?.value.trim();
    if (!key) { showToast('Klucz nie może być pusty', 'error'); return; }
    settings.mistralApiKeys = [...(settings.mistralApiKeys || []),
        { label: labelEl?.value.trim() || `Key ${(settings.mistralApiKeys?.length || 0) + 1}`, key }];
    if (labelEl) labelEl.value = '';
    if (keyEl)   keyEl.value   = '';
    renderMistralApiKeysList();
}

function removeMistralApiKey(idx) {
    if (!confirm('Usunąć ten klucz?')) return;
    settings.mistralApiKeys = settings.mistralApiKeys.filter((_, i) => i !== idx);
    renderMistralApiKeysList();
}

async function handleSaveSettings() {
    const dp  = document.getElementById('debug-prompts');
    const obu = document.getElementById('ollama-base-url');
    const fs  = document.getElementById('chat-font-size');

    if (dp)  settings.debugPrompts  = dp.checked;
    if (obu) settings.ollamaBaseUrl = obu.value.trim() || 'http://localhost:11434';
    if (fs)  settings.chatFontSize  = parseInt(fs.value);
    // mistralApiKeys are mutated in-place by addMistralApiKeyRow / removeMistralApiKey

    window.DEBUG_PROMPTS = !!settings.debugPrompts;
    applyChatFontSize(settings.chatFontSize ?? 14);

    await persistSettings(settings);
    closeModal('settings-modal');
    showToast('Ustawienia globalne zapisane', 'success');
}

// ============ CHARACTER LIST MODAL ============
async function showCharacterList() {
    const chars = await getAllCharacters();
    const body  = document.getElementById('character-list-body');
    if (!body) return;

    body.innerHTML = chars.length
        ? chars.map(c => `
            <div class="character-card ${currentCharacter?.id === c.id ? 'active' : ''}">
                <div class="character-card-avatar">${escapeHtml((c.name[0] || '?').toUpperCase())}</div>
                <div class="character-card-info">
                    <div class="character-card-name">${escapeHtml(c.name)}</div>
                    <div class="character-card-desc">${escapeHtml((c.prompt || '').substring(0, 70))}…</div>
                </div>
                <div class="character-card-actions">
                    <button class="btn-primary small"   onclick="app.selectCharacterAndClose(${c.id})">Select</button>
                    <button class="btn-secondary small" onclick="app.editCharacterFromList(${c.id})">Edit</button>
                </div>
            </div>`).join('')
        : '<p class="no-keys">No characters yet – create one!</p>';

    openModal('character-list-modal');
}

async function selectCharacterAndClose(charId) {
    closeModal('character-list-modal');
    await selectCharacter(charId);
}

function editCharacterFromList(charId) {
    closeModal('character-list-modal');
    navigateToCharEditor(charId);
}

// ============ SUMMARY ============
function generateSummary() {
    if (!currentChat) { showToast('No chat selected', 'error'); return; }
    window.location.href = `summary.html?chatId=${currentChat.id}`;
}

// ============ EXPORT / IMPORT ============
async function handleExportChat() {
    if (!currentChat) { showToast('No chat to export', 'error'); return; }
    try {
        await exportChat(currentChat.id);
        showToast('Chat exported', 'success');
    } catch (err) {
        showToast('Export failed: ' + err.message, 'error');
    }
}

async function handleImportChat(file) {
    if (!file) return;
    try {
        const { character, chat } = await importChatFromFile(file);
        showToast(`Imported chat for "${character.name}"`, 'success');
        closeModal('settings-modal');
        await selectCharacter(character.id);
        await selectChat(chat.id);
    } catch (err) {
        showToast('Import failed: ' + err.message, 'error');
    }
    const el = document.getElementById('import-file');
    if (el) el.value = '';
}

// ============ MODAL HELPERS ============
function openModal(id) {
    document.getElementById(id)?.classList.add('active');
    document.getElementById('overlay')?.classList.add('active');
}

function closeModal(id) {
    document.getElementById(id)?.classList.remove('active');
    const anyOpen = document.querySelectorAll('.modal.active').length > 0;
    if (!anyOpen) document.getElementById('overlay')?.classList.remove('active');
}

function closeAllModals() {
    document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
    document.getElementById('overlay')?.classList.remove('active');
}

function showWelcomeScreen() {
    const c = document.getElementById('messages-container');
    if (c) c.innerHTML = `
        <div class="welcome-section">
            <h2>Welcome to AiComp</h2>
            <p>Create your first character to get started</p>
            <button class="btn-primary" onclick="app.openCharacterEditor(null)" style="margin-top:20px">+ Create Character</button>
        </div>`;
}

// ============ PUBLIC API ============
window.app = {
    sendMessage:              appSendMessage,
    createNewChat,
    selectChat,
    deleteMessageFrom,
    deleteCurrentChatConfirm: deleteChatConfirm,

    openSettings,
    closeSettings:            () => closeModal('settings-modal'),
    saveSettings:             handleSaveSettings,
    addApiKeyRow,
    removeApiKey,
    addMistralApiKeyRow,
    removeMistralApiKey,

    openChatSettings:         navigateToChatSettings,
    openCharacterEditor:      charId => navigateToCharEditor(charId),

    showCharacterList,
    closeCharacterList:       () => closeModal('character-list-modal'),
    selectCharacterAndClose,
    editCharacterFromList,

    toggleMemoryPanel,
    refreshMemory,

    generateSummary,

    exportCurrentChat:        handleExportChat,
    importChat:               handleImportChat,

    openImageLightbox() {
        if (!currentCharacterAvatarUrl) return;
        const lb  = document.getElementById('image-lightbox');
        const img = document.getElementById('lightbox-img');
        if (lb && img) { img.src = currentCharacterAvatarUrl; lb.style.display = 'flex'; }
    },
    closeLightbox() {
        const lb = document.getElementById('image-lightbox');
        if (lb) lb.style.display = 'none';
    },

    scrollToTop()    { scrollToMessagesTop(); },
    scrollToBottom() { scrollToMessagesBottom(); },

    setChatFontSize(size) {
        const fs    = document.getElementById('chat-font-size');
        const fsVal = document.getElementById('chat-font-size-value');
        if (fs)    fs.value          = size;
        if (fsVal) fsVal.textContent = size;
        applyChatFontSize(size);
    },

    retryLastMessage() {
        if (!lastFailedMessage) return;
        const msg = lastFailedMessage;
        lastFailedMessage = null;
        currentChatError  = null;
        appSendMessage(msg);
    },

    dismissRetry: () => { lastFailedMessage = null; hideRetryBar(); },

    dismissChatError() {
        currentChatError = null;
        renderMessages();
    },

    closeModals: closeAllModals,

    toggleSidebar() {
        const sidebar  = document.querySelector('.sidebar');
        const backdrop = document.getElementById('sidebar-backdrop');
        const open = sidebar?.classList.toggle('sidebar-open');
        backdrop?.classList.toggle('active', !!open);
    },
    closeSidebar() {
        document.querySelector('.sidebar')?.classList.remove('sidebar-open');
        document.getElementById('sidebar-backdrop')?.classList.remove('active');
    },
};

// ── Boot ──
init();
