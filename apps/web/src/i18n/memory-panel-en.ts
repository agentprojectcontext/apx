// A project's Memory tab: the note beside the list and the chat that reviews the notes with an agent.
export const enMemoryPanel = {
  "memory.kind.user": "About you",
  "memory.kind.feedback": "Guidance",
  "memory.kind.project": "Project",
  "memory.kind.reference": "Reference",
  "memory.kind.procedure": "How it was done",
  "memory.panel.label": "Memory note",
  "memory.panel.writtenBy": "Written by",
  "memory.panel.updated": "Updated {when}",
  "memory.panel.forgotten": "Forgotten {when}",
  "memory.panel.gone": "This note is no longer in the list.",
  "memory.review.with": "Review with {name}",
  "memory.review.title": "Memory review",
  "memory.review.drawer": "Reviewing with {name}",
  "memory.review.hint":
    "Send the message to start: {name} reads the notes and proposes what to keep, fix or forget, one at a time.",
  "memory.review.new": "Start another review",
  "memory.review.open": "Open the whole chat",
  "memory.review.back": "Back to the note",
  "memory.review.noAgent": "No agent can review these notes.",
  "memory.review.draft.project":
    "Let's review this project's memory notes together, one by one: which are still true, which repeat another and which are out of date. Propose how to leave each one and wait for my ok before changing or forgetting it.",
  "memory.review.draft.global":
    "Let's review what your notes say about me together, one by one: which are still true, which repeat another and which are out of date. Propose how to leave each one and wait for my ok before changing or forgetting it.",
  "memory.review.draft.agent":
    "Let's review your notebook together, one note at a time: which are still true, which repeat another and which are out of date. Propose how to leave each one and wait for my ok before changing or forgetting it.",
  "memory.review.draft.note":
    "Let's review this memory note ({id}): «{text}». Is it still true, does it repeat another, should it say something else? Propose how to leave it and wait for my ok before changing or forgetting it.",
} as const;
