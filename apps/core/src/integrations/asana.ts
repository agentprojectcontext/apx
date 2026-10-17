import type { ParsedParams, Result } from "@apx/protocol";
import type { Secrets } from "../secrets.ts";

export const ASANA_SECRET = "asana-token";
export const ASANA_FIELD = {
  name: "token",
  label: "Personal access token",
  secret: true,
  url: "https://app.asana.com/0/my-apps",
};

export function createAsana(deps: { secrets: Secrets; offIn: (project: string) => boolean; fetch?: typeof fetch }) {
  const connected = () => deps.secrets.has(`secret://${ASANA_SECRET}`);
  const usable = (project?: string) => connected() && (!project || !deps.offIn(project));
  async function call(
    path: string,
    method = "GET",
    body?: unknown,
    query?: Record<string, string | number | undefined>,
  ): Promise<Result<"asana.read">> {
    const token = deps.secrets.resolve(`secret://${ASANA_SECRET}`);
    if (!token) throw new Error("Asana is not connected; connect it in Resources › Integrations");
    const url = new URL(`https://app.asana.com/api/1.0/${path}`);
    for (const [key, value] of Object.entries(query ?? {}))
      if (value !== undefined) url.searchParams.set(key, String(value));
    const response = await (deps.fetch ?? fetch)(url, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify({ data: body }) }),
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
    });
    // Remote errors can echo credentials and request content; expose only the status.
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Asana: HTTP ${response.status}`);
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 1_000_000) {
            await reader.cancel();
            throw new Error("Asana response is too large");
          }
          chunks.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    const text = Buffer.concat(chunks).toString("utf8");
    let result: { data: unknown; next_page?: { offset?: string } | null };
    try {
      result = JSON.parse(text) as typeof result;
      if (!result || typeof result !== "object" || !("data" in result)) throw new Error("missing data");
      if (result.next_page?.offset !== undefined && typeof result.next_page.offset !== "string")
        throw new Error("invalid offset");
    } catch {
      throw new Error("Asana returned an invalid response");
    }
    return { data: result.data, ...(result.next_page?.offset ? { next_offset: result.next_page.offset } : {}) };
  }
  return {
    connected,
    usable,
    async validate(token: string) {
      const response = await (deps.fetch ?? fetch)("https://app.asana.com/api/1.0/users/me", {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20_000),
        redirect: "error",
      });
      await response.body?.cancel();
      if (!response.ok) throw new Error(`Asana: HTTP ${response.status}`);
    },
    read(request: ParsedParams<"asana.read">["request"]) {
      switch (request.operation) {
        case "workspaces":
          return call("workspaces", "GET", undefined, { limit: request.limit, offset: request.offset });
        case "projects":
          return call("projects", "GET", undefined, {
            workspace: request.workspace,
            opt_fields: "gid,name,color,archived,permalink_url",
            limit: request.limit,
            offset: request.offset,
          });
        case "tasks":
          return call(`projects/${request.project}/tasks`, "GET", undefined, {
            limit: request.limit,
            offset: request.offset,
            completed_since: request.completed ? undefined : "now",
            opt_fields:
              "gid,name,completed,due_on,assignee.name,notes,permalink_url,memberships.section.name,memberships.section.gid",
          });
        case "task":
          return call(`tasks/${request.task}`);
      }
    },
    write(request: ParsedParams<"asana.write">["request"]) {
      if (request.operation === "create_task") {
        const { operation: _, project, ...fields } = request;
        return call("tasks", "POST", { ...fields, ...(project ? { projects: [project] } : {}) });
      }
      const { operation: _, task, ...fields } = request;
      if (!Object.keys(fields).length) throw new Error("Asana needs at least one task field to update");
      return call(`tasks/${task}`, "PUT", fields);
    },
  };
}
export type Asana = ReturnType<typeof createAsana>;
