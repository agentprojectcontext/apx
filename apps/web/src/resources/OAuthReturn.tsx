import "../styles/screens.css";
import { Button, EmptyState, Icons, Spinner } from "@apx/ui";
import { useEffect, useState } from "react";
import { accountError } from "../data/account.ts";
import { client } from "../data/client.ts";
import { isSignInWindow, tellSignInDone } from "../data/signInWindow.ts";
import { useT } from "../i18n/index.ts";

const NAMES: Record<string, string> = {
  "google-calendar": "Google Calendar",
  gmail: "Gmail",
  "google-drive": "Google Drive",
  openrouter: "OpenRouter",
  account: "APX",
};

// Loaded only on /oauth/google and /oauth/openrouter. What Google sent is read once: the code leaves the address bar right away, and
// StrictMode's second mount reuses the same call instead of spending the code twice.
const params = new URLSearchParams(window.location.search);
if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
const ACCOUNT = window.location.pathname === "/oauth/account";
const DESKTOP_ACCOUNT = ACCOUNT && Boolean(params.get("state")?.startsWith("desktop."));
let finishing: Promise<{ id: string; also?: string[] | undefined; account?: string | undefined }> | undefined;
function finish() {
  const code = params.get("code");
  const state = params.get("state");
  const denied = params.get("error");
  if (denied) return Promise.reject(new Error(denied));
  if (!code || !state || DESKTOP_ACCOUNT) return undefined;
  if (ACCOUNT) finishing ??= client.call("account.finish", { code, state }).then(() => ({ id: "account" }));
  if (window.location.pathname === "/oauth/openrouter")
    finishing ??= client.call("openrouter.finish", { code, state }).then(() => ({ id: "openrouter" }));
  finishing ??= client.call("integrations.oauth_finish", { code, state });
  return finishing;
}

/** A window the panel opened for this sign-in: the panel is told, and this window says to close it (and tries to). */
const POPUP = window.opener != null || isSignInWindow();
/** How long "connected" shows before the window tries to close. */
const CLOSE_MS = 1500;

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
      (r) => {
        setState({ kind: "done", ...r });
        tellSignInDone(r.id);
        if (POPUP) window.setTimeout(() => window.close(), CLOSE_MS);
      },
      (e: unknown) => setState({ kind: "failed", error: e instanceof Error ? e.message : String(e) }),
    );
  }, []);
  const open = POPUP ? (
    <Button size="sm" onClick={() => window.close()}>
      {t("oauth.closeWindow")}
    </Button>
  ) : (
    <Button size="sm" onClick={() => window.location.replace("/")}>
      {t("oauth.open")}
    </Button>
  );
  if (DESKTOP_ACCOUNT && params.get("code") && !params.get("error")) {
    const link = `apx://account/callback?${new URLSearchParams({ code: params.get("code") ?? "", state: params.get("state") ?? "" })}`;
    return (
      <div className="oauthreturn">
        <EmptyState
          title={t("account.returnTitle")}
          action={<Button onClick={() => window.location.assign(link)}>{t("account.returnAction")}</Button>}
        >
          {t("account.returnHint")}
        </EmptyState>
      </div>
    );
  }
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
          {t(POPUP ? "oauth.closing" : "oauth.doneBody")}
        </EmptyState>
      )}
      {state.kind === "failed" && (
        <EmptyState icon={<Icons.TriangleAlert />} title={t("oauth.failTitle")} action={open}>
          {ACCOUNT ? accountError(t, new Error(state.error)) : state.error}
        </EmptyState>
      )}
      {state.kind === "nothing" && <EmptyState title={t("oauth.nothing")} action={open} />}
    </div>
  );
}
