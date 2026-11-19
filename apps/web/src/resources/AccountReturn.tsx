import { Button, GoogleMark } from "@apx/ui";
import { useEffect, useState } from "react";
import { GoogleSignal } from "../common/GoogleSignal.tsx";
import { accountError } from "../data/account.ts";
import { client } from "../data/client.ts";
import { tellSignInDone } from "../data/signInWindow.ts";
import { useT } from "../i18n/index.ts";

const cancelled = (error: unknown) =>
  error instanceof Error && (error.message === "sign_in_cancelled" || error.message === "access_denied");

type State = { kind: "working" } | { kind: "done"; name: string } | { kind: "failed"; error: unknown };

/**
 * The tab Google returns to after signing in to the APX account. It says done only once the core has the session and
 * reads it back (account.get), so "signed in" here always means APX is signed in too.
 */
export function AccountReturn({ running, desktop }: { running: Promise<unknown>; desktop: boolean }) {
  const t = useT();
  const [state, setState] = useState<State>({ kind: "working" });
  const [closeBlocked, setCloseBlocked] = useState(false);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    let live = true;
    running
      .then(() => client.call("account.get", {}))
      .then(
        (status) => {
          if (!live) return;
          setState(
            status.profile
              ? { kind: "done", name: status.profile.name }
              : { kind: "failed", error: new Error("session_not_saved") },
          );
        },
        (error: unknown) => {
          if (live) setState({ kind: "failed", error });
        },
      )
      .finally(() => tellSignInDone("account"));
    return () => {
      live = false;
    };
  }, [running]);
  const close = () => {
    window.close();
    // A tab the browser did not open by script stays open; then only the words remain.
    window.setTimeout(() => {
      if (!window.closed) setCloseBlocked(true);
    }, 300);
  };
  const retry = async () => {
    setRetrying(true);
    try {
      const { url } = await client.call("account.start", { desktop });
      window.location.assign(url);
    } catch (error) {
      setState({ kind: "failed", error });
      setRetrying(false);
    }
  };
  const signal = state.kind === "working" ? "connecting" : state.kind === "done" ? "connected" : ("broken" as const);
  return (
    <div className="oauthreturn">
      <div className="signin-return">
        <GoogleSignal state={signal} label={state.kind === "done" ? t("account.returnConnected") : undefined} />
        {state.kind === "working" && (
          <>
            <h1>{t("account.returnWorking")}</h1>
            <p>{t("account.returnWait")}</p>
          </>
        )}
        {state.kind === "done" && (
          <>
            <h1>{t("account.returnDone", { name: state.name })}</h1>
            <p>{t(closeBlocked ? "account.closeBlocked" : "account.returnClose")}</p>
            {!closeBlocked && <Button onClick={close}>{t("account.closeTab")}</Button>}
          </>
        )}
        {state.kind === "failed" && (
          <>
            <h1>{t("account.returnFailed")}</h1>
            <p role="alert">{cancelled(state.error) ? t("account.returnCancelled") : accountError(t, state.error)}</p>
            <Button leadingIcon={<GoogleMark />} loading={retrying} onClick={() => void retry()}>
              {t("account.retry")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
