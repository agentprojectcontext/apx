import "../styles/screens.css";
import { Button, EmptyState, Icons, Spinner } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { useT } from "../i18n/index.ts";

const NAMES: Record<string, string> = {
  "google-calendar": "Google Calendar",
  gmail: "Gmail",
  "google-drive": "Google Drive",
};

// Loaded only on /oauth/google. What Google sent is read once: the code leaves the address bar right away, and
// StrictMode's second mount reuses the same call instead of spending the code twice.
const params = new URLSearchParams(window.location.search);
if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
let finishing: Promise<{ id: string; also?: string[] | undefined; account?: string | undefined }> | undefined;
function finish() {
  const code = params.get("code");
  const state = params.get("state");
  const denied = params.get("error");
  if (denied) return Promise.reject(new Error(denied));
  if (!code || !state) return undefined;
  finishing ??= client.call("integrations.oauth_finish", { code, state });
  return finishing;
}

/** Hands the code to the core and says how it went; the panel that started it notices by itself. */
export function OAuthReturn() {
  const t = useT();
  const [state, setState] = useState<
    | { kind: "working" }
    | { kind: "done"; id: string; also?: string[] | undefined; account?: string | undefined }
    | { kind: "failed"; error: string }
    | { kind: "nothing" }
  >({ kind: "working" });
  useEffect(() => {
    const running = finish();
    if (!running) return setState({ kind: "nothing" });
    running.then(
      (r) => setState({ kind: "done", ...r }),
      (e: unknown) => setState({ kind: "failed", error: e instanceof Error ? e.message : String(e) }),
    );
  }, []);
  const open = (
    <Button size="sm" onClick={() => window.location.replace("/")}>
      {t("oauth.open")}
    </Button>
  );
  return (
    <div className="oauthreturn">
      {state.kind === "working" && <EmptyState icon={<Spinner size={18} />} title={t("oauth.working")} />}
      {state.kind === "done" && (
        <EmptyState
          icon={<Icons.CircleCheck />}
          title={
            state.also?.length
              ? t("oauth.doneTitleMany", {
                  names: [state.id, ...state.also].map((id) => NAMES[id] ?? id).join(", "),
                })
              : t("oauth.doneTitle", { name: NAMES[state.id] ?? state.id })
          }
          action={open}
        >
          {state.account ? `${t("int.signedInAs", { account: state.account })}. ` : ""}
          {t("oauth.doneBody")}
        </EmptyState>
      )}
      {state.kind === "failed" && (
        <EmptyState icon={<Icons.TriangleAlert />} title={t("oauth.failTitle")} action={open}>
          {state.error}
        </EmptyState>
      )}
      {state.kind === "nothing" && <EmptyState title={t("oauth.nothing")} action={open} />}
    </div>
  );
}
