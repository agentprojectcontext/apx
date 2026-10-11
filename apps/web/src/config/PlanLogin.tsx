import type { ChatgptStatus } from "@apx/protocol";
import { Button, Dialog, EngineIcon, Icons } from "@apx/ui";
import { useEffect, useState } from "react";
import { chatgptChanged, chatgptConnect, chatgptDisconnect, chatgptStatus } from "../data/chatgpt.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";

/** Where ChatGPT turns on the device-code sign-in Codex uses; without it the code is never accepted. */
const SECURITY_SETTINGS = "https://chatgpt.com/#settings/Security";

/**
 * Connects the ChatGPT plan to APX's own loop, shown as Codex: a code typed at OpenAI's page (the core waits for it),
 * or APX v1's sign-in taken over. The setting ChatGPT may ask for first is a hint while waiting and the answer to a
 * refusal, never a gate. Codex CLI's own sign-in is never used.
 */
export function PlanLogin({ onClose }: { onClose(): void }) {
  const t = useT();
  const [s, setS] = useState<ChatgptStatus>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void chatgptStatus().then(setS);
  }, []);
  // While a code waits, ask every few seconds whether the owner finished.
  useEffect(() => {
    if (!s?.pending) return;
    const iv = setInterval(async () => {
      const next = await chatgptStatus();
      if (!next) return;
      setS(next);
      if (next.connected) void chatgptChanged();
    }, 3000);
    return () => clearInterval(iv);
  }, [s?.pending]);
  const act = async (fn: () => Promise<ChatgptStatus | undefined>) => {
    setBusy(true);
    const next = await fn();
    setBusy(false);
    if (next) setS(next);
    return next;
  };
  const start = async () => {
    const next = await act(() => chatgptConnect("device"));
    if (next?.pending) window.open(next.pending.verification_url, "_blank", "noopener");
  };
  const copy = (code: string) =>
    void navigator.clipboard.writeText(code).then(
      () => notify(t("plan.login.copied"), "info"),
      () => {},
    );

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("plan.login.title")}
      description={t("plan.login.lead")}
      footer={
        <>
          {s?.connected && (
            <Button variant="secondary" loading={busy} onClick={() => void act(chatgptDisconnect)}>
              {t("plan.login.disconnect")}
            </Button>
          )}
          <Button variant={s?.connected ? "primary" : "secondary"} onClick={onClose}>
            {t(s?.connected ? "common.done" : "common.cancel")}
          </Button>
        </>
      }
    >
      <div className="planlogin">
        {!s ? null : s.connected ? (
          <p className="chatgpt__ok">
            <Icons.CircleCheck size={16} />
            {s.account ? t("plan.login.connectedAs", { account: s.account }) : t("plans.connected")}
          </p>
        ) : s.pending ? (
          <div className="chatgpt__code">
            <p>{t("plan.login.step1")}</p>
            <a href={s.pending.verification_url} target="_blank" rel="noreferrer">
              {s.pending.verification_url}
            </a>
            <p>{t("plan.login.step2")}</p>
            <div className="planlogin__code">
              <code className="chatgpt__usercode">{s.pending.user_code}</code>
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={<Icons.Copy size={14} />}
                onClick={() => copy(s.pending?.user_code ?? "")}
              >
                {t("plan.login.copy")}
              </Button>
            </div>
            <p className="chatgpt__hint">{t("plan.login.waiting")}</p>
            <p className="chatgpt__hint">
              {t("plan.login.ifRefused")}{" "}
              <a href={SECURITY_SETTINGS} target="_blank" rel="noreferrer" className="planlogin__link">
                {t("plan.login.preLink")}
                <Icons.ExternalLink size={12} />
              </a>
            </p>
          </div>
        ) : (
          <div className="chatgpt__start">
            {/* Only after a refusal: the usual reason is ChatGPT's device-code setting being off. */}
            {s.error && (
              <div className="planlogin__pre">
                <div className="planlogin__pretitle">
                  <EngineIcon engine="codex" size={16} />
                  {t("plan.login.preTitle")}
                </div>
                <p>{t("plan.login.preBody")}</p>
                <a href={SECURITY_SETTINGS} target="_blank" rel="noreferrer" className="planlogin__link">
                  {t("plan.login.preLink")}
                  <Icons.ExternalLink size={12} />
                </a>
              </div>
            )}
            <Button loading={busy} onClick={() => void start()}>
              {t("plan.login.start")}
            </Button>
            {s.v1_available && (
              <div className="planlogin__v1">
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busy}
                  leadingIcon={<Icons.Download size={14} />}
                  onClick={() => void act(() => chatgptConnect("v1"))}
                >
                  {t("plan.login.fromV1")}
                </Button>
                <span className="chatgpt__hint">{t("plan.login.fromV1Hint")}</span>
              </div>
            )}
            {s.error && <p className="chatgpt__error">{t("plan.login.failed", { error: s.error })}</p>}
          </div>
        )}
      </div>
    </Dialog>
  );
}
