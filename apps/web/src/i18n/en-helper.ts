export const enHelper = {
  "helper.reviewChange": "Review proposed change",
  "helper.confirm": "Apply proposed instructions?",
  "helper.confirmBody":
    "Review the complete before and after. This changes only the unsaved draft, not an existing agent or its permissions.",
  "helper.before": "Before (removed)",
  "helper.after": "After (added)",
  "helper.stale": "The draft changed since this proposal was reviewed. Review it again; nothing was applied.",
  "helper.title": "Review the project",
  "helper.pitch":
    "{name} goes over the goal, context, tasks and team with you, tells you what is missing and proposes a first step.",
  "helper.talk": "Talk it over with {name}",
  "helper.missing": "What is missing",
  "helper.chatTitle": "Project review",
  "helper.chatDraft":
    "Let's review this project: its goal, context, tasks and team. Tell me what is missing to work well and propose a concrete first step. Before changing instructions or the team, show me the proposal.",
  "helper.gap.goal": "The project has no written goal",
  "helper.gap.start": "No tasks or chats to start from",
  "helper.gap.agentRole": "{name} has no role",
  "helper.gap.agentInstructions": "{name} has no instructions",
  "helper.gap.agentBoth": "{name} has no role or instructions",
  "helper.body":
    "APX checks this agent against the project's goal and can propose instructions for it. Nothing changes until you accept it.",
  "helper.enable": "When creating an agent, tell me if context is missing",
  "helper.enableHint":
    "A new agent's form says when it has no role or instructions, or the project has no goal written.",
  "helper.ready": "This agent and the project have what they need.",
  "helper.goal": "What should this project achieve?",
  "helper.firstResult": "What would be a useful first result?",
  "helper.option.plan": "A short plan with a first actionable step",
  "helper.option.prototype": "A small working prototype",
  "helper.option.audit": "A focused review with concrete findings",
  "helper.roleMissing": "Add a role in the agent form to make the instructions specific.",
  "helper.proposal": "Proposed instructions (not applied)",
  "helper.accept": "Use these proposed instructions",
  "helper.prepare": "Propose instructions",
  "helper.agentOffer": "This draft is missing context, a role or instructions. Review it without blocking creation?",
  "helper.agentReview": "Review draft in project context",
} as const;
