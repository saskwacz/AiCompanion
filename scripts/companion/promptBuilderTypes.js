/**
 * @typedef {import('./types.js').EmotionState} EmotionState
 * @typedef {import('./types.js').GoalRecord} GoalRecord
 * @typedef {import('./types.js').MemoryRecord} MemoryRecord
 * @typedef {import('./types.js').WorldState} WorldState
 */

/**
 * @typedef {Object} CharacterProfileInput
 * @property {string} [name]
 * @property {string} [characterDetails]
 * @property {string} [promptInstructions]
 * @property {string} [dialogueExamples]
 */

/**
 * @typedef {Object} RelationshipStateInput
 * @property {number} [trust]
 * @property {number} [friendship]
 * @property {number} [affection]
 * @property {number} [respect]
 * @property {number} [romance]
 * @property {number} [dependency]
 * @property {number} [hostility]
 * @property {number} [familiarity]
 * @property {number} [rapport]
 */

/**
 * @typedef {Object} ChatMessageInput
 * @property {string} role
 * @property {string} content
 */

/**
 * @typedef {string | { text: string }} RuntimeConstraint
 */

/**
 * @typedef {Object} ChatPromptContext
 * @property {'pl'|'en'} [lang]
 * @property {Record<string, unknown>} [chatConfig]
 * @property {CharacterProfileInput} characterProfile
 * @property {EmotionState|null} characterState
 * @property {RelationshipStateInput|null} relationship
 * @property {GoalRecord[]} goals
 * @property {WorldState|null} worldState
 * @property {MemoryRecord[]} retrievedMemories
 * @property {string} conversationSummary
 * @property {ChatMessageInput[]} recentMessages
 * @property {string} currentUserMessage
 * @property {RuntimeConstraint[]} [runtimeConstraints]
 * @property {number|null} [contextTokens]
 */

export {};
