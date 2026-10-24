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
  /**
   * The MCP server, run here or reached at its address: values in `{field}` are filled in (a secret field as
   * secret://<id>-<field>).
   */
  server: StdioServer | RemoteServer;
  /**
   * A server that may refuse an account the app accepts elsewhere: connecting asks it first, with the owner's values,
   * and on a refusal (401/403) the entry runs `server` from `fallback` instead.
   */
  fallback?: StdioServer;
};

type StdioServer = { command: string; args: string[]; env: Record<string, string> };
type RemoteServer = { url: string; headers: Record<string, string> };

/** Coming: their sign-in needs an app of APX's own registered with them (no dynamic client registration). */
export const COMING = [
  { id: "microsoft-365", label: "Microsoft 365", description: "Outlook mail and calendar, OneDrive and Teams." },
  { id: "box", label: "Box", description: "Files and folders of your Box account." },
];

/**
 * An app's own MCP server that signs in through the owner's browser: mcp-remote registers itself with the app
 * (OAuth dynamic client registration) and prints the page to open, which APX shows (mcp/sign-in.ts).
 */
const signIn = (id: string, label: string, description: string, url: string): IntegrationEntry => ({
  id,
  label,
  description,
  fields: [],
  server: { command: "npx", args: ["-y", "mcp-remote", url], env: {} },
});

/** A public MCP server with nothing to sign in to (documentation, knowledge). */
const open = (id: string, label: string, description: string, url: string): IntegrationEntry => ({
  id,
  label,
  description,
  fields: [],
  server: { url, headers: {} },
});

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
    // GitHub's own server; it may ask for Copilot access, so an account it refuses gets the earlier open one.
    server: { url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: "Bearer {token}" } },
    fallback: {
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
    ],
    // Slack's own server takes only apps it approved; this one is the maintained open one. Posting is on, as before.
    server: {
      command: "npx",
      args: ["-y", "slack-mcp-server", "--transport", "stdio"],
      env: { SLACK_MCP_XOXB_TOKEN: "{token}", SLACK_MCP_ADD_MESSAGE_TOOL: "true" },
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
      args: ["-y", "@brave/brave-search-mcp-server"],
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
  {
    id: "home-assistant",
    label: "Home Assistant",
    description: "Lights, sensors and automations of your home.",
    fields: [
      { name: "server", label: "Address", secret: false, placeholder: "http://homeassistant.local:8123" },
      {
        name: "token",
        label: "Long-lived access token",
        secret: true,
        placeholder: "eyJ…",
        url: "https://www.home-assistant.io/integrations/mcp_server/",
      },
    ],
    // Its MCP Server integration, turned on in Home Assistant.
    server: { url: "{server}/api/mcp", headers: { Authorization: "Bearer {token}" } },
  },
  {
    id: "n8n",
    label: "n8n",
    description: "Run the workflows of your n8n instance.",
    fields: [
      { name: "server", label: "Address", secret: false, placeholder: "https://n8n.example.org" },
      {
        name: "token",
        label: "MCP access token",
        secret: true,
        placeholder: "eyJ…",
        url: "https://docs.n8n.io/advanced-ai/accessing-n8n-mcp-server/",
      },
    ],
    server: { url: "{server}/mcp-server/http", headers: { Authorization: "Bearer {token}" } },
  },
  signIn("linear", "Linear", "Issues, projects and cycles.", "https://mcp.linear.app/mcp"),
  signIn("atlassian", "Jira and Confluence", "Jira issues and Confluence pages.", "https://mcp.atlassian.com/v1/mcp"),
  signIn("gitlab", "GitLab", "Projects, issues and merge requests.", "https://gitlab.com/api/v4/mcp"),
  signIn("vercel", "Vercel", "Projects, deployments and their logs.", "https://mcp.vercel.com"),
  signIn("supabase", "Supabase", "Databases, auth and storage of your projects.", "https://mcp.supabase.com/mcp"),
  signIn("stripe", "Stripe", "Customers, payments and subscriptions.", "https://mcp.stripe.com"),
  signIn("todoist", "Todoist", "Your tasks and projects.", "https://ai.todoist.net/mcp"),
  signIn("airtable", "Airtable", "Bases, tables and records.", "https://mcp.airtable.com/mcp"),
  signIn("figma", "Figma", "Designs and their components, as code context.", "https://mcp.figma.com/mcp"),
  open("context7", "Context7", "Current documentation of libraries, for coding.", "https://mcp.context7.com/mcp"),
  signIn("cloudflare", "Cloudflare", "Workers, DNS and the rest of your account.", "https://mcp.cloudflare.com/mcp"),
  signIn("netlify", "Netlify", "Sites, deploys and their settings.", "https://netlify-mcp.netlify.app/mcp"),
  signIn("neon", "Neon", "Postgres databases and branches.", "https://mcp.neon.tech/mcp"),
  signIn("clickup", "ClickUp", "Tasks, lists and docs.", "https://mcp.clickup.com/mcp"),
  signIn("monday", "monday.com", "Boards, items and updates.", "https://mcp.monday.com/mcp"),
  signIn("canva", "Canva", "Designs: find, create and export them.", "https://mcp.canva.com/mcp"),
  signIn("miro", "Miro", "Boards and what is on them.", "https://mcp.miro.com/"),
  signIn("dropbox", "Dropbox", "Find and read your files.", "https://mcp.dropbox.com/mcp"),
  signIn("calendly", "Calendly", "Event types, bookings and availability.", "https://mcp.calendly.com"),
  signIn("datadog", "Datadog", "Logs, metrics and monitors.", "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp"),
  signIn("grafana", "Grafana", "Dashboards, queries and alerts.", "https://mcp.grafana.com/mcp"),
  signIn("paypal", "PayPal", "Invoices, orders and transactions.", "https://mcp.paypal.com/mcp"),
  signIn(
    "wordpress",
    "WordPress.com",
    "Posts, pages and stats of your sites.",
    "https://public-api.wordpress.com/wpcom/v2/mcp/v1",
  ),
  signIn("hugging-face", "Hugging Face", "Models, datasets and Spaces.", "https://huggingface.co/mcp"),
  open("deepwiki", "DeepWiki", "Questions about any public GitHub repository.", "https://mcp.deepwiki.com/mcp"),
  signIn("railway", "Railway", "Projects, services and deployments.", "https://mcp.railway.com"),
  signIn("intercom", "Intercom", "Conversations and contacts.", "https://mcp.intercom.com/mcp"),
  signIn("attio", "Attio", "Your CRM: people, companies and deals.", "https://mcp.attio.com/mcp"),
  signIn("close", "Close", "Leads, contacts and opportunities.", "https://mcp.close.com/mcp"),
  signIn("klaviyo", "Klaviyo", "Campaigns, flows and audiences.", "https://mcp.klaviyo.com/mcp"),
  signIn("mixpanel", "Mixpanel", "Product analytics: events and reports.", "https://mcp.mixpanel.com/mcp"),
  signIn("amplitude", "Amplitude", "Product analytics: charts and cohorts.", "https://mcp.amplitude.com/mcp"),
  signIn("better-stack", "Better Stack", "Uptime monitors, incidents and logs.", "https://mcp.betterstack.com"),
  signIn("square", "Square", "Payments, orders and catalog.", "https://mcp.squareup.com/sse"),
  signIn("fireflies", "Fireflies", "Meeting transcripts and summaries.", "https://api.fireflies.ai/mcp"),
  signIn("strava", "Strava", "Your activities and training.", "https://mcp.strava.com/mcp"),
  open("wolfram", "Wolfram", "Computation and curated data.", "https://agenttools.wolfram.com/mcp"),
  open("aws-knowledge", "AWS Knowledge", "AWS documentation and guidance.", "https://knowledge-mcp.global.api.aws"),
  open("microsoft-learn", "Microsoft Learn", "Microsoft documentation.", "https://learn.microsoft.com/api/mcp"),
  signIn("semgrep", "Semgrep", "Scan code for security issues.", "https://mcp.semgrep.ai/mcp"),
  signIn("circleci", "CircleCI", "Pipelines, builds and their failures.", "https://mcp.circleci.com/v1/mcp"),
  signIn("postman", "Postman", "Collections, requests and APIs.", "https://mcp.postman.com/minimal"),
  signIn("prisma", "Prisma Postgres", "Prisma Postgres databases.", "https://mcp.prisma.io/mcp"),
  signIn(
    "cloudinary",
    "Cloudinary",
    "Images and videos of your media library.",
    "https://asset-management.mcp.cloudinary.com/mcp",
  ),
  signIn("craft", "Craft", "Your Craft documents.", "https://mcp.craft.do/my/mcp"),
  signIn("webflow", "Webflow", "Sites, pages and CMS collections.", "https://mcp.webflow.com/mcp"),
  signIn("gamma", "Gamma", "Presentations and documents.", "https://mcp.gamma.app/mcp"),
];

/** The secret a field of an integration is kept under. */
export const integrationSecret = (id: string, field: string) => `${id}-${field}`;

/** The server of an entry with the owner's values in: secrets by reference, the rest as typed. */
export function serverFor(e: IntegrationEntry, values: Record<string, string>, refused = false) {
  const fill = (s: string, trim = false) =>
    s.replace(/\{([a-z]+)\}/g, (_m, name: string) => {
      const f = e.fields.find((x) => x.name === name);
      if (!f) return "";
      if (f.secret) return `secret://${integrationSecret(e.id, name)}`;
      const v = values[name] ?? "";
      // An address typed with its trailing slash still joins its path ("…:8123/" + "/api/mcp").
      return trim ? v.replace(/\/+$/, "") : v;
    });
  const filled = (r: Record<string, string>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, fill(v)]));
  const server = refused && e.fallback ? e.fallback : e.server;
  if ("url" in server) return { url: fill(server.url, true), headers: filled(server.headers) };
  return { command: server.command, args: server.args.map((a) => fill(a)), env: filled(server.env) };
}

/**
 * Whether a remote server refuses the owner's account (401/403 to an MCP initialize): `headers` carry the real values.
 * Anything else (it answers, it cannot be reached in time) is not a refusal: the entry keeps its own server.
 */
export async function refusesAccount(
  url: string,
  headers: Record<string, string>,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const r = await fetchFn(url, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "apx", version: "2" } },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    await r.body?.cancel();
    return r.status === 401 || r.status === 403;
  } catch {
    return false;
  }
}
