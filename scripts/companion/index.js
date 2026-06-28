/**
 * Companion AI — public exports.
 */
export { STORES, RAG_WEIGHTS, EMOTION_DECAY, IDLE_INTERVAL_MS } from './types.js';
export * from './readService.js';
export * from './persistenceService.js';
export * from './contextService.js';
export * from './contextBuilder.js';
export * from './embeddingService.js';
export * from './memoryService.js';
export * from './emotionService.js';
export * from './goalService.js';
export * from './relationshipService.js';
export * from './worldStateService.js';
export * from './consistencyService.js';
export * from './initiativeService.js';
export * from './chatService.js';
export * from './promptBuilder.js';
export * from './memoryPromptBuilder.js';
export * from './memoryDeltaParser.js';
export * from './dashboardService.js';
export * from './prompts/promptConfigService.js';
export * from './config/serviceRegistry.js';
export * from './idleService.js';
export * from './retryOnce.js';
export { runPipeline, runCompanionExchange, seedCompanionState, getCompanionState } from './pipeline.js';
