import { callChatAPI } from '../providers/index.js';
import { retryOnce } from './retryOnce.js';

/**
 * Chat orchestration — STEP 5. Stateless. No IndexedDB writes.
 * Prompt assembly is handled by promptBuilder.js (Step 4).
 */

export async function generateChatResponse(chatCfg, chatTask, { messages, systemPrompt }) {
    const result = await retryOnce(
        () => callChatAPI(chatCfg, {
            messages,
            systemPrompt,
            // Summary is included in system prompt by PromptBuilder — avoid duplicate injection.
            chatSummary: { text: '', rolling: '' },
            temperature:   chatTask.temperature,
            maxTokens:     chatTask.maxTokens,
            contextTokens: chatTask.contextTokens,
        }),
        { label: 'Chat LLM', fallback: null },
    );

    if (!result.ok || !result.value) {
        throw result.error ?? new Error('Chat generation failed');
    }
    return result.value;
}

export function assembleChatInput(params) {
    return {
        character_profile:      params.character,
        retrieved_memories:     params.retrievedMemories,
        emotion_state:          params.emotionState,
        goals:                  params.goals,
        world_state:            params.worldState,
        relationship:           params.relationship,
        conversation_summary:   params.conversationSummary,
        user_input:             params.userInput,
        initiative:             params.initiative ?? null,
    };
}
