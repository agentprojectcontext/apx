import type { ChatgptStatus } from "@apx/protocol";
import { Button, Dialog, Icons } from "@apx/ui";
import { useEffect, useState } from "react";
import { chatgptChanged, chatgptConnect, chatgptDisconnect, chatgptStatus } from "../data/chatgpt.ts";
import { useT } from "../i18n/index.ts";

/**
 * The ChatGPT plan as a model for APX's own loop: sign in with a code typed at OpenAI's address (the core waits for
 * it), or take APX v1's sign-in over. Codex's own sign-in is never used.
 */
export function ChatgptSignIn({ onClose }: { onClose(): void }) {
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
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("chatgpt.title")}
      description={t("chatgpt.lead")}
      footer={
        <>
          {s?.connected && (
            <Button variant="secondary" loading={busy} onClick={() => void act(chatgptDisconnect)}>
              {t("chatgpt.disconnect")}
            </Button>
          )}
          <Button variant={s?.connected ? "primary" : "secondary"} onClick={onClose}>
            {t(s?.connected ? "common.done" : "common.cancel")}
          </Button>
        </>
      }
    >
      <div className="chatgpt">
        {!s ? null : s.connected ? (
          <p className="chatgpt__ok">
            <Icons.CircleCheck size={16} />
            {s.account ? t("chatgpt.connectedAs", { account: s.account }) : t("chatgpt.connected")}
          </p>
        ) : s.pending ? (
          <div className="chatgpt__code">
            <p>{t("chatgpt.step1")}</p>
            <a href={s.pending.verification_url} target="_blank" rel="noreferrer">
              {s.pending.verification_url}
            </a>
            <p>{t("chatgpt.step2")}</p>
            <code className="chatgpt__usercode">{s.pending.user_code}</code>
            <p className="chatgpt__hint">{t("chatgpt.waiting")}</p>
          </div>
        ) : (
          <div className="chatgpt__start">
            {s.v1_available && (
              <Button
                loading={busy}
                leadingIcon={<Icons.Download size={14} />}
                onClick={() => void act(() => chatgptConnect("v1"))}
              >
                {t("chatgpt.fromV1")}
              </Button>
            )}
            <Button
              variant={s.v1_available ? "secondary" : "primary"}
              loading={busy}
              onClick={() => void act(() => chatgptConnect("device"))}
            >
              {t("chatgpt.signIn")}
            </Button>
            <p className="chatgpt__hint">{t("chatgpt.deviceHint")}</p>
            {s.error && <p className="chatgpt__error">{t("chatgpt.failed", { error: s.error })}</p>}
          </div>
        )}
      </div>
    </Dialog>
  );
}
