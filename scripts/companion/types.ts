/**
 * Companion AI — canonical TypeScript types (reference schema).
 * Runtime uses companion/types.js; keep both in sync.
 */

export type MemoryType = 'fact' | 'event' | 'preference' | 'relationship' | 'rule';
export type MemoryValidity = 'permanent' | 'long_term' | 'temporary';
export type GoalStatus = 'active' | 'completed' | 'failed';
export type InitiativeType = 'reminder' | 'question' | 'emotional' | 'action' | 'narrative';

export interface MemoryRecord {
  memory_id: string;
  chatId: number;
  type: MemoryType;
  content: string;
  importance: number;
  confidence: number;
  entities: string[];
  tags: string[];
  embedding_id: string | null;
  created_at: number;
  last_accessed: number;
  validity: MemoryValidity;
  expires_at: number | null;
}

export interface EmbeddingRecord {
  embedding_id: string;
  memory_id: string;
  chatId: number;
  vector: number[];
  model: string;
  created_at: number;
}

export interface EmotionState {
  state_id: string;
  chatId: number;
  mood: string;
  valence: number;
  energy: number;
  stress: number;
  trust_user: number;
  affection: number;
  fear: number;
  anger: number;
  curiosity: number;
  loneliness: number;
  confidence: number;
  last_updated: number;
}

export interface GoalRecord {
  goal_id: string;
  chatId: number;
  text: string;
  priority: number;
  status: GoalStatus;
  progress: number;
  created_at: number;
  updated_at: number;
}

export interface WorldState {
  chatId: number;
  location: string;
  time: string;
  active_scene: string;
  entities: unknown[];
  inventory: unknown[];
  narrative_flags: unknown[];
}

export interface SessionSummary {
  session_id: string;
  chatId: number;
  summary: string;
  key_events: string[];
  created_at: number;
}

export interface ConsistencyResult {
  conflicts: string[];
  fixes: string[];
  rejected: string[];
  merged: string[];
}

export interface InitiativeOutput {
  type: InitiativeType;
  content: string;
  priority: number;
  trigger_reason: string;
  context_links: string[];
  should_interrupt_user: boolean;
}

export interface RelationshipState {
  chatId?: number;
  trust: number;
  respect: number;
  friendship: number;
  affection: number;
  dependency: number;
  jealousy: number;
  romance: number;
  hostility: number;
  familiarity: number;
  rapport: number;
  last_updated?: number;
}

export interface CharacterProfileInput {
  name?: string;
  characterDetails?: string;
  promptInstructions?: string;
  dialogueExamples?: string;
  [key: string]: unknown;
}

export type RuntimeConstraint = string | { text: string };

export interface ChatMessageInput {
  role: string;
  content: string;
}

/** Processed inputs for the Chat Prompt Builder — no IndexedDB. */
export interface ChatPromptContext {
  lang?: 'pl' | 'en';
  chatConfig?: Record<string, unknown>;
  characterProfile: CharacterProfileInput;
  characterState: EmotionState | null;
  relationship: RelationshipState | null;
  goals: GoalRecord[];
  worldState: WorldState | null;
  retrievedMemories: MemoryRecord[];
  conversationSummary: string;
  recentMessages: ChatMessageInput[];
  currentUserMessage: string;
  runtimeConstraints?: RuntimeConstraint[];
  contextTokens?: number | null;
}

export interface ChatOrchestrationInput {
  character_profile: Record<string, unknown>;
  retrieved_memories: MemoryRecord[];
  emotion_state: EmotionState;
  goals: GoalRecord[];
  world_state: WorldState;
  conversation_summary: string;
  user_input: string;
  initiative?: InitiativeOutput | null;
}

export interface PipelineContext {
  chatId: number;
  character: Record<string, unknown>;
  messages: Array<{ role: string; content: string }>;
  userInput: string;
  chatCfg: Record<string, unknown>;
  embedCfg: Record<string, unknown>;
  memoryCfg: Record<string, unknown>;
  summaryCfg: Record<string, unknown>;
  chatTask: Record<string, unknown>;
  memoryTask: Record<string, unknown>;
  summaryTask: Record<string, unknown>;
  conversationSummary: string;
}

export interface PipelineResult {
  response: string;
  retrievedMemories: MemoryRecord[];
  emotionState: EmotionState;
  goals: GoalRecord[];
  worldState: WorldState;
  initiative: InitiativeOutput | null;
  consistency: ConsistencyResult;
  pendingMemoryWrites: MemoryRecord[];
  pendingGoalWrites: GoalRecord[];
}
