import { openDB }                                                      from './db.js';
import { loadSettings, persistSettings, getShuffledApiKeys }          from './settings.js';
import { createCharacter, updateCharacter, deleteCharacterById,
         getCharacterById, getAllCharacters, buildSystemPrompt,
         saveCharacterAvatar, getCharacterAvatar, deleteCharacterAvatar } from './characters.js';
import { createChat, updateChat, deleteChatById,
         getChatById, getChatsForCharacter }                           from './chats.js';
import { addMessage, getMessagesForChat, deleteMessageById,
         deleteMessagesFrom, deleteAllForChat }                        from './messages.js';
import { getMemoryForChat, saveMemory, updateMemoryFromExchange,
         seedMemoryFromCharacter, memoryToContext }                    from './memory.js';
import { callGeminiAPI, callGeminiForSummary }                         from './api.js';
import { getSummaryForChat, deleteSummaryForChat,
         shouldAutoSummarize, generateAndSaveSummary }                 from './summary.js';
import { exportChat, importChatFromFile }                              from './export.js';
import { escapeHtml, parseMessageMarkup, showToast, formatTimestamp }  from './ui.js';

// ============ STATE ============
let settings             = {};
let currentCharacter     = null;
let currentChat          = null;
let currentMessages      = [];
let currentMemory        = null;
let currentChatSummary   = null;  // rolling summary from IndexedDB
let isLoading            = false;
let lastFailedMessage    = null;
let currentSummary       = '';    // text shown in summary modal
let memoryPanelOpen      = false;
let editingCharId        = null;
let aiResponseCount      = 0;     // counts AI replies; memory update every N
let pendingRequests      = 0;     // counts in-flight LLM requests (chat + memory + summary)
let currentCharacterAvatarUrl = null; // Object URL for current character's avatar blob
let _pendingAvatarBlob   = null;  // null=no change, false=delete, File=new blob

const MEMORY_UPDATE_EVERY = 1;    // update memory after every AI response

/** Lock/unlock the send input based on pendingRequests counter. */
function setPendingRequest(delta) {
    pendingRequests = Math.max(0, pendingRequests + delta);
    const input   = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const locked  = pendingRequests > 0;
    if (input)   { input.disabled   = locked; if (!locked) input.focus(); }
    if (sendBtn) { sendBtn.disabled = locked; }
}

// ============ INIT ============
async function init() {
    try {
        await openDB();
        settings = await loadSettings();
        window.DEBUG_PROMPTS = !!settings.debugPrompts;

        const chars = await getAllCharacters();
        if (chars.length === 0) {
            showWelcomeScreen();
        } else {
            await selectCharacter(chars[0].id);
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
    document.getElementById('temperature')?.addEventListener('input', e => {
        const el = document.getElementById('temperature-value');
        if (el) el.textContent = e.target.value;
    });
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

function _showAvatarEditorPreview(url) {
    const preview   = document.getElementById('char-avatar-preview');
    const removeBtn = document.getElementById('char-avatar-remove');
    if (!preview) return;
    if (url) {
        preview.innerHTML = `<img src="${url}" class="char-avatar-preview-img" alt="Avatar">`;
        if (removeBtn) removeBtn.style.display = '';
    } else {
        preview.innerHTML = `<span class="char-avatar-placeholder">Brak zdjęcia</span>`;
        if (removeBtn) removeBtn.style.display = 'none';
    }
}

async function selectCharacter(charId) {
    currentCharacter = await getCharacterById(charId);
    if (!currentCharacter) return;

    // Load avatar and update sidebar
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

    const chat = await createChat(currentCharacter.id);

    if (currentCharacter.welcomeMessage) {
        const msg = await addMessage(chat.id, 'assistant', currentCharacter.welcomeMessage);
        await updateChat(chat.id, {
            messageCount:    1,
            lastMessage:     currentCharacter.welcomeMessage.substring(0, 80),
            lastMessageTime: msg.timestamp,
            updatedAt:       Date.now(),
        });
    }

    currentChat = await getChatById(chat.id);
    await selectChat(currentChat.id);
    renderChatList(await getChatsForCharacter(currentCharacter.id));

    // Seed structured memory from character definition, then refresh panel
    const apiKeys = getShuffledApiKeys(settings);
    if (apiKeys.length) {
        setTimeout(async () => {
            const seeded = await seedMemoryFromCharacter(chat.id, currentCharacter, apiKeys, null, settings.memoryTokens ?? 8192);
            if (seeded && currentChat?.id === chat.id) {
                currentMemory = seeded;
                renderMemoryPanel();
            }
        }, 300);
    }
}

async function selectChat(chatId) {
    currentChat        = await getChatById(chatId);
    if (!currentChat) return;
    currentMessages    = await getMessagesForChat(chatId);
    currentMemory      = await getMemoryForChat(chatId);
    currentChatSummary = await getSummaryForChat(chatId);
    aiResponseCount    = currentMessages.filter(m => m.role === 'assistant').length;

    const titleEl = document.getElementById('chat-title');
    if (titleEl) titleEl.textContent = currentChat.title || 'Chat';

    renderMessages();
    if (memoryPanelOpen) renderMemoryPanel();

    document.querySelectorAll('.chat-item-wrapper').forEach(el => {
        el.classList.toggle('active', el.dataset.chatId === String(chatId));
    });

    document.getElementById('message-input')?.focus();
}

async function deleteChatConfirm(chatId) {
    if (!confirm('Delete this chat and all its messages? This cannot be undone.')) return;
    await deleteAllForChat(chatId);
    await deleteSummaryForChat(chatId);
    await deleteChatById(chatId);

    const chats = await getChatsForCharacter(currentCharacter.id);
    renderChatList(chats);

    if (currentChat?.id === chatId) {
        currentChat = null; currentMessages = []; currentMemory = null;
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

    const apiKeys = getShuffledApiKeys(settings);
    if (!apiKeys.length) { showToast('Add an API key in Settings', 'error'); return; }

    const userMsg = await addMessage(currentChat.id, 'user', message);
    currentMessages = [...currentMessages, userMsg];

    // Auto-title on first user message
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
        const memCtx       = memoryToContext(currentMemory);
        const systemPrompt  = buildSystemPrompt(currentCharacter, memCtx);

        const response = await callGeminiAPI({
            apiKey: apiKeys, messages: currentMessages, systemPrompt,
            chatSummary:   currentChatSummary,
            temperature:   settings.temperature,
            maxTokens:     settings.maxTokens,
            contextTokens: settings.contextTokens,
        });

        const aiMsg = await addMessage(currentChat.id, 'assistant', response);
        currentMessages = [...currentMessages, aiMsg];

        await updateChat(currentChat.id, {
            messageCount:    currentMessages.length,
            lastMessage:     response.substring(0, 80),
            lastMessageTime: aiMsg.timestamp,
            updatedAt:       Date.now(),
        });

        lastFailedMessage = null;
        hideRetryBar();
        renderMessages();
        renderChatList(await getChatsForCharacter(currentCharacter.id));

        // Background memory update every MEMORY_UPDATE_EVERY exchanges (rate-limit friendly)
        aiResponseCount++;
        console.log(`[Memory] AI response #${aiResponseCount} — update in ${MEMORY_UPDATE_EVERY - ((aiResponseCount - 1) % MEMORY_UPDATE_EVERY)} more`);
        if (aiResponseCount % MEMORY_UPDATE_EVERY === 0) {
            setTimeout(() => triggerMemoryUpdate(message, response, apiKeys), 500);
        }

        // Auto-summary every AI_RESPONSES_PER_SUMMARY AI replies (non-blocking)
        if (shouldAutoSummarize(currentMessages, currentChatSummary, settings.summaryEvery ?? 10)) {
            setTimeout(() => triggerAutoSummary(apiKeys), 800);
        }

    } catch (err) {
        await deleteMessageById(userMsg.id);
        currentMessages = currentMessages.filter(m => m.id !== userMsg.id);
        lastFailedMessage = message;
        renderMessages();
        showRetryBar(message);
        showToast(err.message, 'error');
    } finally {
        isLoading = false;
        setPendingRequest(-1);
        hideTypingIndicator();
    }
}

async function triggerMemoryUpdate(userMsg, aiMsg, apiKey) {
    setPendingRequest(+1);
    try {
        currentMemory = await updateMemoryFromExchange(
            currentChat.id, userMsg, aiMsg, apiKey,
            currentCharacter, currentMessages, settings.memoryTokens ?? 8192
        );
        renderMemoryPanel();
    } catch (e) {
        console.warn('[Memory] Background update failed:', e);
    } finally {
        setPendingRequest(-1);
    }
}

async function triggerAutoSummary(apiKey) {
    const chatId   = currentChat?.id;
    const messages = [...currentMessages];
    const char     = currentCharacter;
    const existing = currentChatSummary;

    if (!chatId || messages.length < 4) return;

    setPendingRequest(+1);
    try {
        const newSummary = await generateAndSaveSummary(chatId, messages, char, existing, apiKey, settings.summaryTokens ?? 8192);
        if (currentChat?.id === chatId) {
            currentChatSummary = newSummary;
            console.log('[Summary] Auto-summary saved, covers', newSummary.upToMessageCount, 'messages');
        }
    } catch (e) {
        console.warn('[Summary] Auto-summary failed:', e.message);
    } finally {
        setPendingRequest(-1);
    }
}

// ============ RETRY ============
function showRetryBar(msg) {
    const bar     = document.getElementById('retry-bar');
    const preview = document.getElementById('retry-message-preview');
    bar?.classList.remove('hidden');
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

    container.innerHTML = currentMessages.map(msg => {
        const isUser = msg.role === 'user';
        const time   = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const avatarHtml = (!isUser && currentCharacterAvatarUrl)
            ? `<img src="${currentCharacterAvatarUrl}" class="msg-avatar-thumb" onclick="app.openImageLightbox()" title="Kliknij aby powiększyć" alt="avatar">`
            : '';
        return `
            <div class="message ${isUser ? 'user' : 'ai'}" data-msg-id="${msg.id}">
                <div class="message-wrapper">
                    ${avatarHtml}
                    <div>
                        <div class="message-content">${parseMessageMarkup(msg.content)}</div>
                        <div class="message-time">${time}</div>
                    </div>
                    <button class="message-delete-btn"
                            onclick="app.deleteMessageFrom(${msg.id})"
                            title="Delete this and all following messages">✕</button>
                </div>
            </div>`;
    }).join('');

    container.scrollTop = container.scrollHeight;
}

function showTypingIndicator() {
    const c = document.getElementById('messages-container');
    if (!c || c.querySelector('.typing-message')) return;
    const d = document.createElement('div');
    d.className  = 'message ai typing-message';
    d.innerHTML  = `<div class="message-wrapper"><div class="message-content">
        <div class="typing-indicator">
            <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
        </div></div></div>`;
    c.appendChild(d);
    c.scrollTop = c.scrollHeight;
}

function hideTypingIndicator() {
    document.querySelector('.typing-message')?.remove();
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
                        const text  = escapeHtml(i.text || i);
                        const count = i.count || 1;
                        const badge = count > 1 ? `<span class="mem-count" title="wspomniano ${count} razy">x${count}</span>` : '';
                        const dateStr = i.firstSeen
                            ? new Date(i.firstSeen).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })
                            : '';
                        const dateBadge = dateStr ? `<span class="mem-date" title="Pierwsze pojawienie: ${dateStr}">${dateStr}</span>` : '';
                        return `<li>${text}${badge}${dateBadge}</li>`;
                      }).join('')}</ul>`
                    : `<p class="memory-empty-section">Nothing recorded yet</p>`}
            </div>`;
    };

    const charSections = [
        ['charFacts',       '🧬 Self-facts'],
        ['charPreferences', '💙 Own preferences'],
        ['charGoals',       '🎯 Own goals'],
        ['charPersonality', '✨ Personality traits'],
        ['charMemories',    '📖 Own memories'],
    ];
    const userSections = [
        ['facts',         '📋 User facts'],
        ['preferences',   '❤️ User preferences'],
        ['goals',         '🏆 User goals'],
        ['relationships', '🤝 Relationship'],
        ['memories',      '💭 Shared memories'],
    ];

    body.innerHTML =
        `<div class="memory-group-title">About ${escapeHtml(currentCharacter?.name || 'Character')}</div>` +
        charSections.map(([k, l]) => renderSection(k, l)).join('') +
        `<div class="memory-group-title">About the User</div>` +
        userSections.map(([k, l]) => renderSection(k, l)).join('');
}

async function refreshMemory() {
    if (!currentChat || currentMessages.length < 2) {
        showToast('Need more conversation to refresh memory', 'info');
        return;
    }
    const apiKeys = getShuffledApiKeys(settings);
    if (!apiKeys.length) { showToast('API key required', 'error'); return; }

    showToast('Updating memory…', 'info');
    const lastUser = [...currentMessages].reverse().find(m => m.role === 'user');
    const lastAi   = [...currentMessages].reverse().find(m => m.role === 'assistant');

    if (lastUser && lastAi) {
        currentMemory = await updateMemoryFromExchange(
            currentChat.id, lastUser.content, lastAi.content, apiKeys,
            currentCharacter, currentMessages, settings.memoryTokens ?? 8192
        );
        renderMemoryPanel();
        showToast('Memory updated', 'success');
    }
}

// ============ DELETE MESSAGE ============
async function deleteMessageFrom(msgId) {
    if (!confirm('Delete this message and all messages after it?')) return;
    const remaining = await deleteMessagesFrom(currentChat.id, msgId);
    currentMessages = remaining;

    const last = remaining.at(-1);
    await updateChat(currentChat.id, {
        messageCount:    remaining.length,
        lastMessage:     last?.content.substring(0, 80) ?? null,
        lastMessageTime: last?.timestamp ?? null,
    });

    renderMessages();
    renderChatList(await getChatsForCharacter(currentCharacter.id));
}

// ============ SETTINGS ============
async function openSettings() {
    const el = document.getElementById('temperature');
    if (el) {
        el.value = settings.temperature;
        const valEl = document.getElementById('temperature-value');
        if (valEl) valEl.textContent = settings.temperature;
    }
    const mt = document.getElementById('max-tokens');
    const ct = document.getElementById('context-tokens');
    const mem = document.getElementById('memory-tokens');
    const st  = document.getElementById('summary-tokens');
    const se  = document.getElementById('summary-every');
    const dp = document.getElementById('debug-prompts');
    if (mt)  mt.value      = settings.maxTokens;
    if (ct)  ct.value      = settings.contextTokens;
    if (mem) mem.value     = settings.memoryTokens  ?? 8192;
    if (st)  st.value      = settings.summaryTokens ?? 8192;
    if (se)  se.value      = settings.summaryEvery  ?? 10;
    if (dp)  dp.checked    = !!settings.debugPrompts;
    renderApiKeysList();
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
                <button class="btn-danger small" onclick="app.removeApiKey(${i})">Remove</button>
            </div>`).join('')
        : '<p class="no-keys">No API keys added yet</p>';
}

function addApiKeyRow() {
    const labelEl = document.getElementById('new-key-label');
    const keyEl   = document.getElementById('new-key-value');
    const key     = keyEl?.value.trim();
    if (!key) { showToast('API key cannot be empty', 'error'); return; }

    settings.apiKeys = [...(settings.apiKeys || []),
        { label: labelEl?.value.trim() || `Key ${(settings.apiKeys?.length || 0) + 1}`, key }];
    if (labelEl) labelEl.value = '';
    if (keyEl)   keyEl.value   = '';
    renderApiKeysList();
}

function removeApiKey(idx) {
    if (!confirm('Remove this API key?')) return;
    settings.apiKeys = settings.apiKeys.filter((_, i) => i !== idx);
    renderApiKeysList();
}

async function handleSaveSettings() {
    const temp = document.getElementById('temperature');
    const mt   = document.getElementById('max-tokens');
    const ct   = document.getElementById('context-tokens');
    if (temp) settings.temperature   = parseFloat(temp.value);
    if (mt)   settings.maxTokens     = parseInt(mt.value);
    if (ct)   settings.contextTokens = parseInt(ct.value);
    const mem = document.getElementById('memory-tokens');
    const st  = document.getElementById('summary-tokens');
    const se  = document.getElementById('summary-every');
    if (mem) settings.memoryTokens  = parseInt(mem.value);
    if (st)  settings.summaryTokens = parseInt(st.value);
    if (se)  settings.summaryEvery  = parseInt(se.value);
    const dp = document.getElementById('debug-prompts');
    if (dp)   settings.debugPrompts  = dp.checked;
    window.DEBUG_PROMPTS = !!settings.debugPrompts;
    await persistSettings(settings);
    closeModal('settings-modal');
    showToast('Settings saved', 'success');
}

// ============ CHARACTER EDITOR ============
async function openCharacterEditor(charId) {
    editingCharId = charId;
    const titleEl     = document.getElementById('character-modal-title');
    const deleteBtn   = document.getElementById('char-delete-btn');
    if (titleEl)   titleEl.textContent    = charId ? 'Edit Character' : 'New Character';
    if (deleteBtn) deleteBtn.style.display = charId ? '' : 'none';

    const fields = {
        'char-name':     '',
        'char-prompt':   'You are a helpful, friendly AI assistant. Be conversational and engaging.',
        'char-welcome':  'Hello! How can I help you?',
        'char-scenario': '',
        'char-details':  '',
        'char-dialogue': '',
    };

    // Reset pending avatar state when opening editor
    _pendingAvatarBlob = null;

    if (charId) {
        const char = await getCharacterById(charId);
        if (char) {
            fields['char-name']     = char.name             || '';
            fields['char-prompt']   = char.prompt           || '';
            fields['char-welcome']  = char.welcomeMessage   || '';
            fields['char-scenario'] = char.scenario         || '';
            fields['char-details']  = char.characterDetails || '';
            fields['char-dialogue'] = char.dialogueExamples || '';
        }
    }

    for (const [id, val] of Object.entries(fields)) {
        const el = document.getElementById(id);
        if (el) el.value = val;
    }

    // Show existing avatar preview
    const existingBlob = charId ? await getCharacterAvatar(charId) : null;
    _showAvatarEditorPreview(existingBlob ? URL.createObjectURL(existingBlob) : null);
    // reset file input
    const fi = document.getElementById('char-avatar-input');
    if (fi) fi.value = '';

    openModal('character-modal');
}

async function saveCharacter() {
    const nameEl = document.getElementById('char-name');
    const name   = nameEl?.value.trim();
    if (!name) { showToast('Character name is required', 'error'); return; }

    const data = {
        name,
        prompt:           document.getElementById('char-prompt')?.value   || '',
        welcomeMessage:   document.getElementById('char-welcome')?.value  || '',
        scenario:         document.getElementById('char-scenario')?.value || '',
        characterDetails: document.getElementById('char-details')?.value  || '',
        dialogueExamples: document.getElementById('char-dialogue')?.value || '',
    };

    let char;
    if (editingCharId) {
        char = await updateCharacter(editingCharId, data);
    } else {
        char = await createCharacter(data);
    }

    closeModal('character-modal');
    showToast(`Character "${char.name}" saved`, 'success');

    // Persist avatar
    if (_pendingAvatarBlob === false) {
        await deleteCharacterAvatar(char.id);
    } else if (_pendingAvatarBlob instanceof Blob) {
        await saveCharacterAvatar(char.id, _pendingAvatarBlob);
    }
    _pendingAvatarBlob = null;

    await selectCharacter(char.id);

    // Seed/refresh memory from character definition for all chats (new + edited)
    const apiKeys = getShuffledApiKeys(settings);
    if (apiKeys.length) {
        const chats = await getChatsForCharacter(char.id);
        for (const c of chats) {
            setTimeout(async () => {
                const seeded = await seedMemoryFromCharacter(c.id, char, apiKeys, null, settings.memoryTokens ?? 8192);
                if (seeded && currentChat?.id === c.id) {
                    currentMemory = seeded;
                    renderMemoryPanel();
                }
            }, 600);
        }
    }
}

async function deleteCurrentCharacter() {
    if (!editingCharId) return;
    const char = await getCharacterById(editingCharId);
    if (!confirm(`Delete character "${char?.name}"? All associated chats will also be deleted.`)) return;

    const chats = await getChatsForCharacter(editingCharId);
    for (const c of chats) {
        await deleteAllForChat(c.id);
        await deleteChatById(c.id);
    }
    await deleteCharacterById(editingCharId);
    await deleteCharacterAvatar(editingCharId);
    closeModal('character-modal');
    showToast('Character deleted', 'success');

    const remaining = await getAllCharacters();
    if (remaining.length > 0) {
        await selectCharacter(remaining[0].id);
    } else {
        currentCharacter = null; currentChat = null; currentMessages = []; currentMemory = null;
        showWelcomeScreen();
        const cl = document.getElementById('chat-list');
        if (cl) cl.innerHTML = '';
        const cn = document.getElementById('current-char-name');
        const ca = document.getElementById('current-char-avatar');
        if (cn) cn.textContent = 'No Character';
        if (ca) ca.textContent = '?';
    }
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

async function editCharacterFromList(charId) {
    closeModal('character-list-modal');
    await openCharacterEditor(charId);
}

// ============ SUMMARY ============
async function generateSummary() {
    if (!currentMessages.length) { showToast('No messages to summarize', 'error'); return; }
    if (!currentChat)            { showToast('No chat selected', 'error'); return; }
    const apiKeys = getShuffledApiKeys(settings);
    if (!apiKeys.length) { showToast('API key required', 'error'); return; }

    const summaryContent = document.getElementById('summary-content');
    const infoEl         = document.getElementById('summary-info');
    if (summaryContent) {
        summaryContent.innerHTML = `
            <div class="summary-loading">
                <div class="typing-indicator">
                    <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
                </div>
                <p>Generating summary…</p>
            </div>`;
    }
    if (infoEl) infoEl.textContent = '';
    openModal('summary-modal');

    try {
        // Generate and persist as rolling summary
        const record = await generateAndSaveSummary(
            currentChat.id, currentMessages, currentCharacter, currentChatSummary, apiKeys,
            settings.summaryTokens ?? 8192
        );
        currentChatSummary = record;
        currentSummary     = record?.text || '';

        if (summaryContent) {
            summaryContent.innerHTML =
                `<pre style="white-space:pre-wrap;word-wrap:break-word;font-size:13px;line-height:1.6">${escapeHtml(currentSummary)}</pre>`;
        }
        if (infoEl && record) {
            infoEl.textContent = `Covers first ${record.upToMessageCount} messages — saved to chat.`;
        }
    } catch (err) {
        closeModal('summary-modal');
        showToast(err.message, 'error');
    }
}

async function clearChatSummary() {
    if (!currentChat) return;
    if (!confirm('Delete the saved summary for this chat? The next auto-summary will start fresh.')) return;
    await deleteSummaryForChat(currentChat.id);
    currentChatSummary = null;
    showToast('Summary cleared', 'success');
}

async function copySummary() {
    if (!currentSummary) return;
    try {
        await navigator.clipboard.writeText(currentSummary);
        showToast('Copied to clipboard', 'success');
    } catch {
        showToast('Copy failed', 'error');
    }
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
    // Reset file input so the same file can be imported again
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

// ============ EXPOSE PUBLIC API ============
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

    openCharacterEditor,
    closeCharacterEditor:     () => closeModal('character-modal'),
    saveCharacter,
    deleteCurrentCharacter,

    showCharacterList,
    closeCharacterList:       () => closeModal('character-list-modal'),
    selectCharacterAndClose,
    editCharacterFromList,

    toggleMemoryPanel,
    refreshMemory,

    generateSummary,
    clearChatSummary,
    closeSummaryModal:        () => closeModal('summary-modal'),
    copySummary,

    exportCurrentChat:        handleExportChat,
    importChat:               handleImportChat,

    previewCharacterAvatar(input) {
        const file = input?.files?.[0];
        if (!file) return;
        _pendingAvatarBlob = file;
        _showAvatarEditorPreview(URL.createObjectURL(file));
    },
    removeCharacterAvatar() {
        _pendingAvatarBlob = false;
        _showAvatarEditorPreview(null);
    },
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

    retryLastMessage: () => {
        if (lastFailedMessage) { hideRetryBar(); appSendMessage(lastFailedMessage); }
    },
    dismissRetry: () => { lastFailedMessage = null; hideRetryBar(); },

    closeModals: closeAllModals,
};

// ── Boot ──
init();
