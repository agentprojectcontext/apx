// What a turn received (chat/ReceivedDialog.tsx): loaded with the dialog, not with the panel's first screen (usePack
// in index.ts). The button that opens it stays in en-chat.ts.
export const enReceived = {
  "received.title": "What it received",
  "received.description": "What the model was sent on this turn's first call, as it was sent.",
  "received.system": "System prompt",
  "received.input": "Turn input",
  "received.tools": "Tools ({n})",
  "received.history": "Earlier conversation ({n} items)",
  "received.size": "{chars} chars · about {tokens} tokens",
  "received.part.base": "APX's own text",
  "received.part.profile": "Profile",
  "received.part.personality": "Personality",
  "received.part.instructions": "Its instructions",
  "received.part.owner": "About you",
  "received.part.agentsMd": "Project AGENTS.md",
  "received.part.org": "Areas and roles",
  "received.part.projectMemory": "Project notes",
  "received.part.skills": "Skills",
  "received.part.message": "The message",
} as const;

export type ReceivedKey = keyof typeof enReceived;
