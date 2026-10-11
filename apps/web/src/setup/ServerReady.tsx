import { Button, Input } from "@apx/ui";
import { useState } from "react";
import { useT } from "../i18n/index.ts";

/**
 * APX was just installed on a server over SSH: the screen says so before the server's own setup opens, and when the
 * user's services would stop at every disconnect (no linger) it offers to fix that with sudo, or the command to run.
 */
export function ServerReady({
  target,
  linger,
}: {
  target: string;
  /** The SSH user, when it does not linger. */
  linger?: string;
}) {
  const t = useT();
  const [lingers, setLingers] = useState(!linger);
  const [how, setHow] = useState<"ask" | "forMe" | "byHand">("ask");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const turnOn = async () => {
    setBusy(true);
    setFailed(false);
    const r = await window.apxConnect?.lingerSsh(target, password);
    setBusy(false);
    setPassword("");
    if (r?.ok) setLingers(true);
    else setFailed(true);
  };

  return (
    <div id="server-ready" className="connect__ready">
      <span className="wiz__hintline is-ok">{t("connect.ready")}</span>
      {lingers && linger && <span className="wiz__hintline is-ok">{t("connect.lingerOn")}</span>}
      {!lingers && (
        <>
          <span className="wiz__hintline">{t("connect.lingerAsk")}</span>
          {how === "ask" && (
            <div className="connect__ready-actions">
              <Button id="linger-for-me" variant="secondary" onClick={() => setHow("forMe")}>
                {t("connect.lingerForMe")}
              </Button>
              <Button id="linger-by-hand" variant="ghost" onClick={() => setHow("byHand")}>
                {t("connect.lingerByHand")}
              </Button>
            </div>
          )}
          {how === "forMe" && (
            <form
              className="connect__ready-actions"
              onSubmit={(e) => {
                e.preventDefault();
                if (password && !busy) void turnOn();
              }}
            >
              <Input
                id="sudo-password"
                type="password"
                autoComplete="off"
                autoFocus
                aria-label={t("connect.sudoLabel")}
                placeholder={t("connect.sudoLabel")}
                value={password}
                invalid={failed}
                onChange={(e) => setPassword(e.currentTarget.value)}
              />
              <Button id="linger-go" type="submit" variant="secondary" loading={busy} disabled={!password}>
                {t("connect.lingerGo")}
              </Button>
            </form>
          )}
          {how === "forMe" && (
            <span className={`wiz__hintline${failed ? " is-error" : ""}`} role={failed ? "alert" : undefined}>
              {t(failed ? "connect.error.sudoFailed" : "connect.sudoHint")}
            </span>
          )}
          {how === "byHand" && (
            <>
              <span className="wiz__hintline">{t("connect.lingerHint")}</span>
              <pre className="connect__install">{`sudo loginctl enable-linger ${linger}`}</pre>
            </>
          )}
        </>
      )}
    </div>
  );
}
