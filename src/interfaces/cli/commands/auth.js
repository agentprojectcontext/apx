// apx auth — plan OAuth logins owned by APX (separate from CLI token families).
import {
  chatgptCodexAuthPath,
  clearApxCodexAuth,
  readApxCodexAuth,
  runCodexDeviceLoginInteractive,
  resolveApxCodexCreds,
} from "#core/engines/codex-plus-oauth.js";
import {
  claudeSubscriptionAuthPath,
  clearApxClaudeAuth,
  readApxClaudeAuth,
  runClaudePkceLoginInteractive,
  resolveApxClaudeCreds,
} from "#core/engines/claude-subscription-oauth.js";

function die(msg) {
  throw new Error(msg);
}

export async function cmdAuthChatgptCodex(args) {
  const sub = args._[0] || "status";
  if (sub === "login") {
    console.log("APX ChatGPT/Codex login (tokens saved under ~/.apx — Codex CLI stays untouched).");
    const done = await runCodexDeviceLoginInteractive({ openBrowser: !args.flags?.["no-open"] });
    console.log("");
    console.log(`✓ Logged in. Saved to ${done.path}`);
    if (done.account_id) console.log(`  account ${done.account_id}`);
    console.log("  Super-agent model: chatgpt-codex:gpt-5.6-luna");
    return;
  }
  if (sub === "logout" || sub === "clear") {
    clearApxCodexAuth();
    console.log(`✓ Cleared ${chatgptCodexAuthPath()}`);
    return;
  }
  if (sub === "status" || sub === "show") {
    const stored = readApxCodexAuth();
    if (!stored) {
      console.log(`ChatGPT/Codex: not logged in (APX).`);
      console.log(`  Run: apx auth chatgpt-codex login`);
      console.log(`  Path: ${chatgptCodexAuthPath()}`);
      return;
    }
    try {
      const creds = await resolveApxCodexCreds();
      const left = creds.expires_at
        ? Math.max(0, creds.expires_at - Math.floor(Date.now() / 1000))
        : null;
      console.log("ChatGPT/Codex: logged in (APX OAuth)");
      console.log(`  path:    ${creds.auth_path}`);
      console.log(`  account: ${creds.account_id}`);
      console.log(`  source:  ${stored.source || "apx"}`);
      if (left != null) console.log(`  token:   ~${Math.round(left / 3600)}h left (auto-refresh)`);
    } catch (e) {
      console.log(`ChatGPT/Codex: stored login broken — ${e.message}`);
      console.log(`  Run: apx auth chatgpt-codex login`);
    }
    return;
  }
  die(`apx auth chatgpt-codex: unknown subcommand "${sub}" (login | status | logout)`);
}

export async function cmdAuthClaude(args) {
  const sub = args._[0] || "status";
  if (sub === "login") {
    console.log("APX Claude Max login (PKCE → ~/.apx — Claude Code CLI untouched).");
    console.log("Requires Max + extra usage credits (Pro alone will not work).");
    const done = await runClaudePkceLoginInteractive({ openBrowser: !args.flags?.["no-open"] });
    console.log("");
    console.log(`✓ Logged in. Saved to ${done.path}`);
    console.log("  Model: claude-subscription:claude-sonnet-4-5");
    return;
  }
  if (sub === "logout" || sub === "clear") {
    clearApxClaudeAuth();
    console.log(`✓ Cleared ${claudeSubscriptionAuthPath()}`);
    return;
  }
  if (sub === "status" || sub === "show") {
    const stored = readApxClaudeAuth();
    if (!stored) {
      console.log("Claude: not logged in (APX).");
      console.log("  Run: apx auth claude login");
      console.log(`  Path: ${claudeSubscriptionAuthPath()}`);
      return;
    }
    try {
      const creds = await resolveApxClaudeCreds();
      const leftMs = creds.expires_at_ms
        ? Math.max(0, creds.expires_at_ms - Date.now())
        : null;
      console.log("Claude: logged in (APX OAuth / Max credits)");
      console.log(`  path:   ${creds.auth_path}`);
      console.log(`  source: ${stored.source || "apx"}`);
      if (leftMs != null) console.log(`  token:  ~${Math.round(leftMs / 3600_000)}h left (auto-refresh)`);
    } catch (e) {
      console.log(`Claude: stored login broken — ${e.message}`);
      console.log("  Run: apx auth claude login");
    }
    return;
  }
  die(`apx auth claude: unknown subcommand "${sub}" (login | status | logout)`);
}

export async function cmdAuth(args) {
  const target = args._[0];
  const rest = { ...args, _: args._.slice(1) };
  if (!target || target === "help") {
    console.log("apx auth — plan OAuth owned by APX\n");
    console.log("  apx auth chatgpt-codex login     ChatGPT/Codex Plus (device code)");
    console.log("  apx auth chatgpt-codex status");
    console.log("  apx auth chatgpt-codex logout");
    console.log("");
    console.log("  apx auth claude login            Claude Max + extra credits (PKCE)");
    console.log("  apx auth claude status");
    console.log("  apx auth claude logout");
    return;
  }
  if (target === "chatgpt-codex" || target === "codex" || target === "codex-plus") {
    await cmdAuthChatgptCodex(rest);
    return;
  }
  if (target === "claude" || target === "claude-subscription" || target === "anthropic-oauth") {
    await cmdAuthClaude(rest);
    return;
  }
  die(`apx auth: unknown target "${target}" (chatgpt-codex | claude)`);
}
