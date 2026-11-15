// Strings only a group chat's card and its New group dialog show: loaded with them (usePack).
export const enGroup = {
  "group.newBody":
    "Pick two to five agents. When you write, the ones your message is for answer, one after the other. Name someone, with or without @, to ask them.",
  "group.name": "Name",
  "group.nameHint": "Optional. Without one, the group is named after its members.",
  "group.members": "Members",
  "group.picked": "{count} of 5",
  "group.search": "Search agents",
  "group.noAgents": "No agent matches.",
  "group.create": "Create group",
  "group.card": "Group",
  "group.cardHint": "Who is in the group and which model each one answers with here",
  "group.remove": "Take {name} out",
  "group.resetModel": "Back to its own model",
  "group.resetRouter": "Back to the auxiliary model",
  "group.models": "Models",
  "group.sameModel": "Same model for everyone",
  "group.sameModelHint": "Off: each agent answers with its own model, or the one you pick for it here.",
  "group.modelOf": "{name}'s model",
  "group.ownSuffix": "{model} · its own",
  "group.routerModel": "Model that picks who answers",
  "group.routerHelpLabel": "About the model that picks who answers",
  "group.routerHelp":
    "Before each of your messages, this model reads it and picks which agents answer, usually one. It is not used when you name someone, with or without @. A fast one keeps the group from waiting.",
  "group.auxSuffix": "{model} · auxiliary",
  "group.addMember": "Add an agent",
} as const;
