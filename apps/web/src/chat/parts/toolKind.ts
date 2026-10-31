// What kind of action a tool call is, for the icon its step shows: the web, reading or writing a file, memory, a
// command, the computer… Tools APX does not know (an MCP server's, an extension's) show as a plain tool.

export type ToolKind =
  | "web"
  | "read"
  | "write"
  | "memory"
  | "command"
  | "computer"
  | "message"
  | "mail"
  | "calendar"
  | "agents"
  | "task"
  | "widget"
  | "image"
  | "file"
  | "phone"
  | "ask"
  | "flow"
  | "settings"
  | "skill"
  | "tool";

const EXACT: Record<string, ToolKind> = {
  web_search: "web",
  web_read: "web",
  read_page: "web",
  video_transcript: "web",
  file_read: "read",
  read_output: "read",
  open_document: "read",
  read_chat: "read",
  search_chats: "read",
  file_write: "write",
  file_edit: "write",
  file_parallel: "write",
  remember: "memory",
  recall: "memory",
  forget: "memory",
  search_owner_notes: "memory",
  send_file: "file",
  make_image: "image",
  ask_owner: "ask",
  notify_owner: "ask",
  apx_flow: "flow",
  apx_settings: "settings",
  grant_tool: "settings",
  load_skill: "skill",
  delegate: "agents",
  list_agents: "agents",
  agent_set: "agents",
  agent_limits: "agents",
  list_sessions: "agents",
  stop_session: "agents",
  message_contact: "message",
  channel_post: "message",
  pass_request: "message",
  commitment_settle: "task",
};

const PREFIX: [string, ToolKind][] = [
  ["browser_", "web"],
  ["shell", "command"],
  ["screen_", "computer"],
  ["imessage_", "message"],
  ["contact", "message"],
  ["channel_", "message"],
  ["gmail_", "mail"],
  ["email", "mail"],
  ["calendar_", "calendar"],
  ["task_", "task"],
  ["routine_", "task"],
  ["drive_", "file"],
  ["phone_", "phone"],
  ["show_widget", "widget"],
  ["read_widget", "widget"],
  ["edit_widget", "widget"],
];

export function toolKind(tool: string): ToolKind {
  return EXACT[tool] ?? PREFIX.find(([p]) => tool.startsWith(p))?.[1] ?? "tool";
}

/** A step's words: its title, or, when the title is only the tool's id (a tool with none of its own), that id in words. */
export function stepLabel(tool: string, title: string): string {
  if (title.trim() && title !== tool) return title;
  const words = tool
    .replace(/^mcp_/, "")
    .split(/__|[_.-]+/)
    .filter(Boolean)
    .join(" ");
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : tool;
}
