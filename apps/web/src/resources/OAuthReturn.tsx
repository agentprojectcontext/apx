import "../styles/screens.css";
import { Button, ConnectSignal, EngineIcon, GoogleMark, IntegrationIcon } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { loadMarks } from "../data/models.ts";
import { isSignInWindow, tellSignInDone } from "../data/signInWindow.ts";
import { useT } from "../i18n/index.ts";
import { ApxMark } from "../marketplace/ConnectHead.tsx";
import { AccountReturn } from "./AccountReturn.tsx";

const NAMES: Record<string, string> = {
  "google-calendar": "Google Calendar",
  gmail: "Gmail",
  "google-drive": "Google Drive",
  openrouter: "OpenRouter",
};

// Loaded only on /oauth/google, /oauth/openrouter and /oauth/account (the APX account: AccountReturn.tsx). What Google sent is read once: the code leaves the address bar right away, and
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
  if (ACCOUNT && denied === "access_denied" && state) {
    finishing ??= client.call("account.finish", { error: "access_denied", state }).then(() => ({ id: "account" }));
    finishing.catch(() => {});
    return finishing;
  }
  if (denied) return Promise.reject(new Error(denied));
  if (!code || !state) return undefined;
  if (ACCOUNT) finishing ??= client.call("account.finish", { code, state }).then(() => ({ id: "account" }));
  // Started while rendering: its outcome is read in AccountReturn's effect, which may come after it settled.
  finishing?.catch(() => {});
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
  const running = ACCOUNT ? finish() : undefined;
  return running ? <AccountReturn running={running} desktop={DESKTOP_ACCOUNT} /> : <IntegrationReturn />;
}

/** The service at the far end of the link: its own mark, or Google's when one sign-in connected several of its parts. */
function ServiceMark({ id, many }: { id: string | undefined; many: boolean }) {
  if (!id || id === "account") return <GoogleMark size={28} />;
  if (id === "openrouter") return <EngineIcon engine="openrouter" size={30} tile />;
  if (many) return <GoogleMark size={28} />;
  return <IntegrationIcon id={id} name={NAMES[id] ?? id} size={30} />;
}

/** Where a service's sign-in comes back: APX joined to it by the connect dots, as the APX account's return shows. */
function IntegrationReturn() {
  const t = useT();
  const [state, setState] = useState<
    | { kind: "working" }
    | { kind: "done"; id: string; also?: string[] | undefined; account?: string | undefined }
    | { kind: "failed"; error: string }
    | { kind: "nothing" }
  >({ kind: "working" });
  useEffect(() => {
    loadMarks();
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
  const back = POPUP ? (
    <Button onClick={() => window.close()}>{t("oauth.closeWindow")}</Button>
  ) : (
    <Button onClick={() => window.location.replace("/")}>{t("oauth.open")}</Button>
  );
  // Which service this was is known from where Google came back to until the core answers.
  const id =
    state.kind === "done" ? state.id : window.location.pathname === "/oauth/openrouter" ? "openrouter" : undefined;
  const many = state.kind === "done" && Boolean(state.also?.length);
  const signal = state.kind === "done" ? "connected" : state.kind === "working" ? "connecting" : "broken";
  return (
    <div className="oauthreturn">
      <div className="signin-return">
        <ConnectSignal
          from={<ApxMark />}
          to={<ServiceMark id={id} many={many} />}
          state={signal}
          label={state.kind === "done" ? t("account.returnConnected") : undefined}
        />
        {state.kind === "working" && <h1>{t("oauth.working")}</h1>}
        {state.kind === "done" && (
          <>
            <h1>
              {state.also?.length
                ? t("oauth.doneTitleMany", {
                    names: [state.id, ...state.also].map((x) => NAMES[x] ?? x).join(", "),
                  })
                : t("oauth.doneTitle", { name: NAMES[state.id] ?? state.id })}
            </h1>
            <p>
              {state.account ? `${t("int.signedInAs", { account: state.account })}. ` : ""}
              {t(POPUP ? "oauth.closing" : "oauth.doneBody")}
            </p>
            {back}
          </>
        )}
        {state.kind === "failed" && (
          <>
            <h1>{t("oauth.failTitle")}</h1>
            <p role="alert">{state.error}</p>
            {back}
          </>
        )}
        {state.kind === "nothing" && (
          <>
            <h1>{t("oauth.nothing")}</h1>
            {back}
          </>
        )}
      </div>
    </div>
  );
}
