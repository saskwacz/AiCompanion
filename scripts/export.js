import { getChatById, createChat, updateChat }              from './chats.js';
import { getCharacterById, createCharacter, saveCharacterAvatar, getCharacterAvatar } from './characters.js';
import { getMessagesForChat, addMessage }                  from './messages.js';
import { getMemoryForChat, saveMemory, memoryForExport, memoryFromImport } from './memory.js';
import { getSummaryForChat, saveSummaryForChat }           from './summary.js';

// ============ HELPERS ============
/** Convert Blob to base64 string */
async function blobToBase64(blob) {
    if (!blob) return null;
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result;
            const base64 = result.split(',')[1] || result;
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/** Convert base64 string to Blob */
function base64ToBlob(base64, mimeType = 'image/jpeg') {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
}

// ============ EXPORT ============
export async function exportChat(chatId) {
    const [chat, messages, memory, summary] = await Promise.all([
        getChatById(chatId),
        getMessagesForChat(chatId),
        getMemoryForChat(chatId),
        getSummaryForChat(chatId),
    ]);
    const character = await getCharacterById(chat.characterId);
    const avatarBlob = await getCharacterAvatar(chat.characterId);
    const avatarBase64 = await blobToBase64(avatarBlob);

    const data = {
        version:    4,
        exportedAt: new Date().toISOString(),
        character:  { ...character, id: undefined, avatarBase64 },
        chat:       {
            ...chat,
            id:          undefined,
            characterId: undefined,
            // Strip API keys from exported config — security: keys should not travel in plain JSON files.
            // The recipient can sync keys from their own global settings after import.
            config: chat.config ? { ...chat.config, apiKeys: [] } : null,
        },
        messages:   messages.map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp })),
        memory:     memoryForExport(memory),
        summary: summary
            ? { text: summary.text, upToMessageCount: summary.upToMessageCount, createdAt: summary.createdAt }
            : null,
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
        href:     url,
        download: `aicomp-${(chat.title || 'chat').replace(/[^\w-]/g, '_')}-${Date.now()}.json`,
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ============ IMPORT ============
export function importChatFromFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.onload  = async e => {
            try {
                const data = JSON.parse(e.target.result);
                if (!data.version || !Array.isArray(data.messages)) {
                    throw new Error('Invalid export file format (missing version or messages)');
                }

                // Re-create character
                const cd        = data.character || {};
                const character = await createCharacter({
                    name:             cd.name             || 'Imported Character',
                    prompt:           cd.prompt           || '',
                    welcomeMessage:   cd.welcomeMessage   || '',
                    scenario:         cd.scenario         || '',
                    characterDetails: cd.characterDetails || '',
                    dialogueExamples: cd.dialogueExamples || '',
                });

                // Restore avatar if present
                if (cd.avatarBase64) {
                    try {
                        const avatarBlob = base64ToBlob(cd.avatarBase64, 'image/jpeg');
                        await saveCharacterAvatar(character.id, avatarBlob);
                    } catch (err) {
                        console.warn('Failed to restore character avatar:', err);
                    }
                }

                // Re-create chat (pass config from export; strip any stale keys)
                const importedConfig = data.chat?.config
                    ? { ...data.chat.config, apiKeys: [] }
                    : null;
                const chat = await createChat(character.id, importedConfig);
                await updateChat(chat.id, {
                    title:           data.chat?.title  || 'Imported Chat',
                    messageCount:    data.messages.length,
                    lastMessage:     data.messages.at(-1)?.content?.substring(0, 80) ?? null,
                    lastMessageTime: data.messages.at(-1)?.timestamp ?? Date.now(),
                });

                // Re-import messages
                for (const m of data.messages) {
                    await addMessage(chat.id, m.role, m.content);
                }

                // Re-import memory (v3 schema; v2 legacy keys migrated automatically)
                if (data.memory) {
                    await saveMemory(memoryFromImport(data.memory, chat.id));
                }

                // Re-import rolling summary (v2+)
                if (data.summary?.text) {
                    await saveSummaryForChat(chat.id, data.summary.text, data.summary.upToMessageCount ?? 0);
                }

                resolve({ character, chat });
            } catch (err) {
                reject(err);
            }
        };
        reader.readAsText(file);
    });
}
