// apx clients: outside apps (Claude Code, Codex…) that talk to APX with their own token.
import type { ClientScope } from "@apx/protocol";
import type { ApxClient } from "@apx/protocol/client";

const USAGE = `apx clients                              Connected apps
apx clients add <name> [--scopes chat,browser]   A token for one (shown once)
apx clients rm <id>`;

export async function clients(client: ApxClient, [sub, arg]: string[], opts: { scopes?: string | undefined }) {
  if (sub === "add" && arg) {
    const scopes = (opts.scopes ?? "chat").split(",").map((s) => s.trim()) as ClientScope[];
    const r = await client.call("clients.create", { name: arg, scopes });
    console.log(`${r.client.id}  ${r.client.name}  · ${r.client.scopes.join(", ")}`);
    console.log("\nToken (shown only now; it lets this app act as a model within its scopes, never as you):");
    console.log(r.token);
    console.log("\nFor Claude Code:");
    console.log(`  claude mcp add apx -e APX_CLIENT_TOKEN=<token> -- apx mcp`);
    return;
  }
  if (sub === "rm" && arg) {
    console.log((await client.call("clients.revoke", { id: arg })).revoked ? "revoked" : "no such client");
    return;
  }
  if (sub) throw new Error(USAGE);
  const { clients: list } = await client.call("clients.list", {});
  for (const c of list)
    console.log(
      `${c.id}  ${c.name}  · ${c.scopes.join(", ")}  · ${c.last_used_at ? `used ${new Date(c.last_used_at).toLocaleString()}` : "never used"}`,
    );
  if (!list.length) console.log(`(no connected apps)\n\n${USAGE}`);
}
