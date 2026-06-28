import { buildChatPrompt, createChatPromptContext, buildChatPromptDebug } from './promptBuilder.js';
import { emotionToPromptHints } from './emotionService.js';

/** STEP 4 — Build chat context. No writes. */

export function buildChatContext({
    character,
    emotions,
    goals,
    summary,
    retrievedMemories,
    messages,
    world,
    relationship,
    userInput,
    chatCfg,
    runtimeConstraints,
}) {
    const promptContext = createChatPromptContext({
        character,
        emotions,
        goals,
        relationship,
        world,
        retrievedMemories,
        conversationSummary: summary?.summary || '',
        messages,
        userInput,
        chatCfg,
        runtimeConstraints,
    });

    const systemPrompt = buildChatPrompt(promptContext);

    if (window.DEBUG_PROMPTS) {
        console.groupCollapsed('[PromptBuilder] Full debug prompt');
        console.log(buildChatPromptDebug(promptContext));
        console.groupEnd();
    }

    const hints = emotionToPromptHints(emotions);
    const chatInput = {
        character_profile:      character,
        retrieved_memories:     retrievedMemories,
        emotion_state:          emotions,
        goals,
        world_state:            world,
        relationship,
        conversation_summary:   summary?.summary || '',
        user_input:             userInput,
        initiative:             null,
    };

    return {
        chatInput,
        systemPrompt,
        promptContext,
        hints,
        messages,
    };
}
