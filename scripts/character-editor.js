/**
 * character-editor.js — standalone character editing page (character.html)
 */

import { openDB }                                                        from './db.js';
import { loadSettings, persistSettings, getShuffledMistralApiKeys } from './settings.js';
import { createCharacter, updateCharacter, deleteCharacterById,
         getCharacterById, getAllCharacters,
         saveCharacterAvatar, getCharacterAvatar, deleteCharacterAvatar } from './characters.js';
import { getChatsForCharacter, deleteChatById }                         from './chats.js';
import { deleteAllForChat }                                             from './messages.js';
import { seedMemoryFromCharacter }                                       from './memory.js';
import { seedCompanionState }                                            from './companion/pipeline.js';
import { resolveChatConfig, resolveModel }                              from './chat-config.js';
import { escapeHtml, showToast }                                        from './ui.js';

// ─── State ────────────────────────────────────────────────────────────────────
const params    = new URLSearchParams(window.location.search);
const charId    = params.get('id') ? parseInt(params.get('id')) : null;
let pendingAvatarBlob = null;   // Blob → new avatar, false → remove, null → unchanged

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
    try {
        await openDB();

        if (charId) {
            const char = await getCharacterById(charId);
            if (!char) { showToast('Postać nie znaleziona', 'error'); goBack(); return; }
            populateForm(char);
            await loadAvatarPreview(charId);

            document.getElementById('page-title').textContent = `Edycja: ${char.name}`;
            document.getElementById('aside-delete').style.display       = '';
            document.getElementById('footer-delete-wrap').style.display = '';
        } else {
            document.getElementById('page-title').textContent = 'Nowa postać';
        }
    } catch (err) {
        console.error('[CharEditor] Init error:', err);
        showToast('Błąd inicjalizacji: ' + err.message, 'error');
    }
}

function populateForm(char) {
    set('char-name',         char.name               || '');
    set('char-instructions', char.promptInstructions || char.dialogueExamples || ''); // migrate legacy
    set('char-welcome',      char.welcomeMessage     || '');
    set('char-scenario',     char.scenario           || '');
    set('char-details',      char.characterDetails   || '');
}

async function loadAvatarPreview(id) {
    const blob = await getCharacterAvatar(id);
    if (blob) {
        showAvatarPreview(URL.createObjectURL(blob));
    }
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
function showAvatarPreview(url) {
    const img        = document.getElementById('char-avatar-img');
    const placeholder = document.getElementById('char-avatar-placeholder');
    const removeBtn  = document.getElementById('char-avatar-remove');
    if (url) {
        img.src               = url;
        img.style.display     = '';
        placeholder.style.display = 'none';
        removeBtn.style.display   = '';
    } else {
        img.style.display         = 'none';
        placeholder.style.display = '';
        removeBtn.style.display   = 'none';
    }
}

window.previewAvatar = function(input) {
    const file = input?.files?.[0];
    if (!file) return;
    pendingAvatarBlob = file;
    showAvatarPreview(URL.createObjectURL(file));
};

window.removeAvatar = function() {
    pendingAvatarBlob = false;
    showAvatarPreview(null);
    const fi = document.getElementById('char-avatar-input');
    if (fi) fi.value = '';
};

// ─── Save ─────────────────────────────────────────────────────────────────────
window.saveCharacter = async function() {
    const name = document.getElementById('char-name')?.value.trim();
    if (!name) { showToast('Nazwa postaci jest wymagana', 'error'); return; }

    const data = {
        name,
        promptInstructions: get('char-instructions'),
        welcomeMessage:     get('char-welcome'),
        scenario:           get('char-scenario'),
        characterDetails:   get('char-details'),
    };

    try {
        let char;
        if (charId) {
            char = await updateCharacter(charId, data);
        } else {
            char = await createCharacter(data);
        }

        // Handle avatar changes
        if (pendingAvatarBlob === false) {
            await deleteCharacterAvatar(char.id);
        } else if (pendingAvatarBlob instanceof Blob) {
            await saveCharacterAvatar(char.id, pendingAvatarBlob);
        }

        showToast(`Postać "${char.name}" zapisana`, 'success');

        // Seed memory in the background for each chat
        seedMemoryForAllChats(char).catch(e => console.warn('[CharEditor] Memory seed error:', e));

        // Navigate back — restore this character on index.html
        const globalSettings = await loadSettings();
        await persistSettings({
            lastCharacterId: char.id,
            lastChatId:      globalSettings.lastChatId,
        });
        setTimeout(() => { window.location.href = 'index.html'; }, 600);

    } catch (err) {
        console.error('[CharEditor] Save error:', err);
        showToast('Błąd zapisu: ' + err.message, 'error');
    }
};

// ─── Delete ───────────────────────────────────────────────────────────────────
window.deleteCharacter = async function() {
    if (!charId) return;
    const char = await getCharacterById(charId);
    if (!confirm(`Usunąć postać "${char?.name}"? Wszystkie powiązane czaty zostaną usunięte.`)) return;

    try {
        const chats = await getChatsForCharacter(charId);
        for (const c of chats) {
            await deleteAllForChat(c.id);
            await deleteChatById(c.id);
        }
        await deleteCharacterById(charId);
        await deleteCharacterAvatar(charId);
        showToast('Postać usunięta', 'success');
        setTimeout(() => { window.location.href = 'index.html'; }, 600);
    } catch (err) {
        showToast('Błąd usuwania: ' + err.message, 'error');
    }
};

// ─── Navigation ───────────────────────────────────────────────────────────────
window.goBack = function() {
    window.location.href = 'index.html';
};

// ─── Memory seeding ───────────────────────────────────────────────────────────
async function seedMemoryForAllChats(char) {
    const settings = await loadSettings();
    const chats    = await getChatsForCharacter(char.id);
    for (const c of chats) {
        const chatCfg = resolveChatConfig(c);
        const memTask   = chatCfg.memory;
        const embedTask = chatCfg.embed;
        const memCfg = {
            provider: 'mistral',
            keys:     getShuffledMistralApiKeys(chatCfg),
            model:    resolveModel(memTask),
        };
        const embedCfg = {
            provider: 'mistral',
            keys:     getShuffledMistralApiKeys(chatCfg),
            model:    resolveModel(embedTask),
        };
        setTimeout(async () => {
            try {
                const seeded = await seedMemoryFromCharacter(
                    c.id, char, memCfg, null, memTask.maxTokens ?? 8192, embedCfg,
                );
                if (seeded) {
                    await seedCompanionState(c.id, seeded, embedCfg);
                    console.log(`[CharEditor] Memory seeded for chat ${c.id}`);
                }
            } catch (e) {
                console.warn(`[CharEditor] Memory seed failed for chat ${c.id}:`, e);
            }
        }, 400);
    }
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function set(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
}

function get(id) {
    return document.getElementById(id)?.value || '';
}

init();
