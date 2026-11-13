// The one-time welcome slides: imported by them alone, so the panel's first screen
// carries none of them.
export const enWelcome = {
  "welcome.title": "What's new in APX",
  "welcome.step": "{n} of {total}",
  "welcome.skip": "Skip",
  "welcome.back": "Back",
  "welcome.next": "Next",
  "welcome.cta": "Let's go",
  "welcome.soundOn": "Turn sound on",
  "welcome.soundOff": "Turn sound off",
  "welcome.sidebar.title": "A compact sidebar",
  "welcome.sidebar.text": "Right-click the sidebar to make it compact. Each section opens its list beside it.",
  "welcome.projects.title": "Projects inside projects",
  "welcome.projects.text":
    "Move a project inside another from its menu. Each project's summary has a board you arrange by dragging.",
  "welcome.routines.title": "Every routine's timeline",
  "welcome.routines.text":
    "Run your finger along the edge of a routine's chat to see when it ran. Tap a mark to go to that run.",
  "welcome.inbox.title": "A tidier Inbox",
  "welcome.inbox.text":
    "Its tabs show what is working and what you haven't read. The chats Home handed off sit under Home.",
  "welcome.channels.title": "Several accounts per channel",
  "welcome.channels.text": "Connect more than one account of the same app, each with the agent that answers it.",
  "welcome.signin.title": "Sign-in variables",
  "welcome.signin.text": "Save a username and password for a site. Your agents sign in there without ever seeing them.",
  "welcome.apps.title": "Websites you can edit",
  "welcome.apps.text": "Open a website an agent made and ask for a change. It is rewritten right there.",
  "welcome.flows.title": "Diagrams and Flows",
  "welcome.flows.text":
    "Ask an agent for a diagram and it draws it in the chat. Flows take shape step by step in their editor.",
  "welcome.gauges.title": "Quotas and memory at a glance",
  "welcome.gauges.text":
    "The top bar shows what is left of each AI quota. When your disk is almost full, APX tells you.",
  "welcome.review.title": "A weekly review",
  "welcome.review.text": "Turn on the weekly review and APX suggests improvements. You accept the ones you want.",
};

export type WelcomeKey = keyof typeof enWelcome;
