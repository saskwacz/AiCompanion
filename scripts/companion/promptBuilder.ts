/**
 * Chat Prompt Builder — TypeScript API reference.
 * Runtime implementation: promptBuilder.js
 */

import type {
  ChatPromptContext,
  CharacterProfileInput,
  ChatMessageInput,
  RuntimeConstraint,
  EmotionState,
  GoalRecord,
  MemoryRecord,
  WorldState,
  RelationshipState,
} from './types';

export type {
  ChatPromptContext,
  CharacterProfileInput,
  ChatMessageInput,
  RuntimeConstraint,
};

export interface CreateChatPromptContextParams {
  character?: CharacterProfileInput;
  emotions?: EmotionState | null;
  goals?: GoalRecord[];
  relationship?: RelationshipState | null;
  world?: WorldState | null;
  retrievedMemories?: MemoryRecord[];
  conversationSummary?: string;
  messages?: ChatMessageInput[];
  userInput?: string;
  chatCfg?: Record<string, unknown> & { lang?: string; chatConfig?: Record<string, unknown> };
  runtimeConstraints?: RuntimeConstraint[];
}

export declare function buildChatPrompt(context: ChatPromptContext): string;
export declare function buildChatPromptDebug(context: ChatPromptContext): string;
export declare function formatRecentConversationSection(context: ChatPromptContext): string;
export declare function formatCurrentUserMessageSection(context: ChatPromptContext): string;
export declare function createChatPromptContext(params: CreateChatPromptContextParams): ChatPromptContext;
