import type { ExtensionInfo } from "@apx/protocol";
import { Button, Icons } from "@apx/ui";
import { installArtifact } from "../data/artifacts.ts";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { createAgent } from "../data/team.ts";
import { useT } from "../i18n/index.ts";
import { attempt } from "../resources/InstalledExtension.tsx";

// The ready-made agents and the widgets or apps an installed extension brings: none is added by itself, each waits
// for the owner's Add.

export function Brought({ e }: { e: ExtensionInfo }) {
  const t = useT();
  const addAgent = async (a: ExtensionInfo["agents"][number]) => {
    const made = await createAgent({ name: a.name, description: a.description, prompt: a.prompt });
    if (made) notify(t("mkt.agentAdded", { name: made.name }), "info");
  };
  const addApp = async (file: string) => {
    const bundle = await attempt(() => client.call("extensions.app_bundle", { id: e.id, file }), t);
    if (bundle) await installArtifact(bundle, undefined, true);
  };
  return (
    <>
      {e.agents.length > 0 && (
        <section className="extpage__sec">
          <h4>{t("mkt.agents")}</h4>
          {e.agents.map((a) => (
            <div key={a.id} className="mkt-brought">
              <Icons.Bot size={18} />
              <span className="mkt-brought__main">
                <b>{a.name}</b>
                {a.description && <span>{a.description}</span>}
              </span>
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={<Icons.Plus size={14} />}
                onClick={() => void addAgent(a)}
              >
                {t("mkt.addAgent")}
              </Button>
            </div>
          ))}
        </section>
      )}
      {e.apps.length > 0 && (
        <section className="extpage__sec">
          <h4>{t("mkt.apps")}</h4>
          {e.apps.map((a) => (
            <div key={a.file} className="mkt-brought">
              <Icons.LayoutGrid size={18} />
              <span className="mkt-brought__main">
                <b>
                  {a.name ??
                    a.file
                      .split("/")
                      .at(-1)
                      ?.replace(/\.apxart$/i, "")}
                </b>
              </span>
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={<Icons.Plus size={14} />}
                onClick={() => void addApp(a.file)}
              >
                {t("mkt.addApp")}
              </Button>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
