// Integrations: an account the owner connects once (GitHub, Notion, Slack…), which brings its MCP server with the
// variables it needs, or a Google account signed in to for APX's own tools. Connecting stores the secrets and adds the server as a global one; where it is used is the
// usual per-project switch of global servers. The catalog is data: each entry says how its server starts.

export type IntegrationField = {
  name: string;
  /** Shown to the owner ("Personal access token"). */
  label: string;
  /** Kept in the secret store (a token, a key) or written as is (a team id, a folder). */
  secret: boolean;
  placeholder?: string;
  /** Where to get it. */
  url?: string;
};

export type IntegrationEntry = {
  id: string;
  label: string;
  description: string;
  fields: IntegrationField[];
  /** The MCP server: values in `{field}` are filled in (a secret field as secret://<id>-<field>). */
  server: { command: string; args: string[]; env: Record<string, string> };
};

/** Coming: they need a sign-in flow (OAuth) APX does not run for them yet. */
export const COMING = [{ id: "linear", label: "Linear", description: "Issues, projects and cycles." }];

/**
 * Google accounts the owner signs in to (OAuth, with APX's own desktop client or one of their own). No MCP server:
 * their tools are APX's own, offered only while connected (integrations/google.ts, tools/google.ts). `apxScopes` is
 * what APX's own client asks for: no restricted scope, so Google verifies it without a paid security assessment
 * (DECISIONS.md#d-130); the owner's own client gets `scopes`.
 */
export const GOOGLE_INTEGRATIONS = [
  {
    id: "google-calendar",
    label: "Google Calendar",
    description: "Your calendar: events, free time, invitations.",
    scopes: ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly"],
    apxScopes: ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly"],
  },
  {
    id: "gmail",
    label: "Gmail",
    description: "Search and read your mail, and write drafts.",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose"],
    // Reading mail is restricted; with APX's client agents only send (and read mail through the Email channel).
    apxScopes: ["https://www.googleapis.com/auth/gmail.send"],
  },
  {
    id: "google-drive",
    label: "Google Drive",
    description: "Find and read your files and Docs, and write new Docs.",
    // drive.file reaches only what APX made (its Docs, and sharing them); the rest is read-only.
    scopes: ["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/drive.file"],
    apxScopes: ["https://www.googleapis.com/auth/drive.file"],
  },
] as const;

export type GoogleId = (typeof GOOGLE_INTEGRATIONS)[number]["id"];
export const isGoogleId = (id: string): id is GoogleId => GOOGLE_INTEGRATIONS.some((g) => g.id === id);

export const CATALOG: IntegrationEntry[] = [
  {
    id: "github",
    label: "GitHub",
    description: "Repositories, issues and pull requests.",
    fields: [
      {
        name: "token",
        label: "Personal access token",
        secret: true,
        placeholder: "ghp_…",
        url: "https://github.com/settings/tokens",
      },
    ],
    server: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "{token}" },
    },
  },
  {
    id: "notion",
    label: "Notion",
    description: "Pages and databases of your workspace.",
    fields: [
      {
        name: "token",
        label: "Integration token",
        secret: true,
        placeholder: "ntn_…",
        url: "https://www.notion.so/profile/integrations",
      },
    ],
    server: { command: "npx", args: ["-y", "@notionhq/notion-mcp-server"], env: { NOTION_TOKEN: "{token}" } },
  },
  {
    id: "slack",
    label: "Slack",
    description: "Channels, messages and threads of your workspace.",
    fields: [
      { name: "token", label: "Bot token", secret: true, placeholder: "xoxb-…", url: "https://api.slack.com/apps" },
      { name: "team", label: "Team id", secret: false, placeholder: "T0123ABCD" },
    ],
    server: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-slack"],
      env: { SLACK_BOT_TOKEN: "{token}", SLACK_TEAM_ID: "{team}" },
    },
  },
  {
    id: "sentry",
    label: "Sentry",
    description: "Errors and issues of your projects.",
    fields: [
      {
        name: "token",
        label: "Access token",
        secret: true,
        placeholder: "sntrys_…",
        url: "https://sentry.io/settings/account/api/auth-tokens/",
      },
    ],
    server: { command: "npx", args: ["-y", "@sentry/mcp-server"], env: { SENTRY_ACCESS_TOKEN: "{token}" } },
  },
  {
    id: "brave-search",
    label: "Brave Search",
    description: "Web search for your agents.",
    fields: [
      {
        name: "key",
        label: "API key",
        secret: true,
        placeholder: "BSA…",
        url: "https://api-dashboard.search.brave.com/app/keys",
      },
    ],
    server: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-brave-search"],
      env: { BRAVE_API_KEY: "{key}" },
    },
  },
  {
    id: "obsidian",
    label: "Obsidian",
    description: "Read and write the notes of your vault.",
    fields: [{ name: "vault", label: "Vault folder", secret: false, placeholder: "~/Documents/Vault" }],
    server: { command: "npx", args: ["-y", "mcp-obsidian", "{vault}"], env: {} },
  },
];

/** The secret a field of an integration is kept under. */
export const integrationSecret = (id: string, field: string) => `${id}-${field}`;

/** The server of an entry with the owner's values in: secrets by reference, the rest as typed. */
export function serverFor(e: IntegrationEntry, values: Record<string, string>) {
  const fill = (s: string) =>
    s.replace(/\{([a-z]+)\}/g, (_m, name: string) => {
      const f = e.fields.find((x) => x.name === name);
      if (!f) return "";
      return f.secret ? `secret://${integrationSecret(e.id, name)}` : (values[name] ?? "");
    });
  return {
    command: e.server.command,
    args: e.server.args.map(fill),
    env: Object.fromEntries(Object.entries(e.server.env).map(([k, v]) => [k, fill(v)])),
  };
}
