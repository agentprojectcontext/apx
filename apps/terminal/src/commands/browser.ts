// apx2 browser …: the embedded browser, by hand. The same methods the agents use.
import type { ApxClient } from "@apx/protocol/client";

export async function browser(
  client: ApxClient,
  values: { by?: string | undefined; profile?: string | undefined; submit?: boolean | undefined },
  [sub, a, b, c]: string[],
): Promise<void> {
  const by = values.by ?? "terminal";
  const need = (v: string | undefined, what: string): string => {
    if (!v) throw new Error(`missing ${what} (see apx2 --help)`);
    return v;
  };
  switch (sub) {
    case "tabs": {
      const { tabs } = await client.call("browser.tabs", {});
      for (const t of tabs)
        console.log(`${t.tab}\t${t.profile}\t${t.control.kind === "agent" ? t.control.by : t.control.kind}\t${t.url}`);
      if (!tabs.length) console.log("(no tabs)");
      return;
    }
    case "open": {
      const t = await client.call("browser.open", {
        url: need(a, "url"),
        ...(values.profile ? { profile: values.profile } : {}),
        by,
      });
      console.log(`${t.tab} · ${t.profile} · ${t.title || t.url}`);
      return;
    }
    case "nav": {
      const r = await client.call("browser.navigate", { tab: need(a, "tab"), url: need(b, "url"), by });
      console.log(`${r.title} · ${r.url}`);
      return;
    }
    case "snapshot": {
      const s = await client.call("browser.snapshot", { tab: need(a, "tab") });
      console.log(s.tree);
      console.log(`\n${s.refs} refs${s.truncated ? " (truncated)" : ""} · ${s.url}`);
      return;
    }
    case "click": {
      const r = await client.call("browser.click", { tab: need(a, "tab"), ref: need(b, "ref"), by });
      console.log(`ok · ${r.url}`);
      return;
    }
    case "type": {
      const r = await client.call("browser.type", {
        tab: need(a, "tab"),
        ref: need(b, "ref"),
        text: need(c, "text"),
        submit: values.submit ?? false,
        by,
      });
      console.log(`ok · ${r.url}`);
      return;
    }
    case "shot": {
      const r = await client.call("browser.screenshot", { tab: need(a, "tab") });
      const { writeFileSync } = await import("node:fs");
      writeFileSync(need(b, "file"), Buffer.from(r.data, "base64"));
      console.log(`wrote ${b} (${r.bytes} bytes)`);
      return;
    }
    case "cookies": {
      if (!a) {
        const { sources } = await client.call("browser.cookie_sources", {});
        for (const x of sources) console.log(`${x.id}\t${x.family}`);
        return;
      }
      const { domains } = await client.call("browser.cookie_domains", { source: a, filter: b ?? "" });
      for (const d of domains.slice(0, 30)) console.log(`${String(d.count).padStart(5)}  ${d.domain}`);
      return;
    }
    case "import": {
      const r = await client.call("browser.import_cookies", {
        source: need(a, "source"),
        domains: need(b, "domains").split(","),
        ...(values.profile ? { profile: values.profile } : {}),
      });
      console.log(`imported ${r.imported} · skipped ${r.skipped} (expired) · failed ${r.failed}`);
      return;
    }
    case "control": {
      const mode = need(b, "mode");
      if (mode !== "user" && mode !== "idle" && mode !== "done") throw new Error("mode must be user, idle or done");
      const t = await client.call("browser.control", { tab: need(a, "tab"), mode });
      console.log(`${t.tab} · ${t.control.kind}`);
      return;
    }
    case "close":
      await client.call("browser.close", { tab: need(a, "tab") });
      console.log("closed");
      return;
    default:
      throw new Error(`unknown browser command: ${sub ?? "(none)"} (see apx2 --help)`);
  }
}
