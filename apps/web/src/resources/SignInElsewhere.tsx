import type { McpServerStatus } from "@apx/protocol";
import { Button, Icons, Input } from "@apx/ui";
import { useState } from "react";
import { finishMcpSignIn } from "../data/resources.ts";
import { useT } from "../i18n/index.ts";

/**
 * A sign-in page opened in a browser that is not on the machine running APX returns to an address only that machine
 * answers: the owner pastes it here and APX opens it there. With `page`, also the link to open the sign-in page.
 */
export function SignInElsewhere({
  server,
  page,
  onDone,
}: {
  server: Pick<McpServerStatus, "scope" | "name" | "project_id">;
  page?: string | undefined;
  onDone(): void;
}) {
  const t = useT();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const finish = async () => {
    setBusy(true);
    setFailed(false);
    const done = await finishMcpSignIn(server, url.trim());
    setBusy(false);
    if (!done) return setFailed(true);
    setUrl("");
    onDone();
  };
  return (
    <div className="signin-elsewhere">
      {page && (
        <a href={page} target="_blank" rel="noreferrer">
          {t("res.signInOpenPage")} <Icons.ExternalLink size={12} />
        </a>
      )}
      <p>{t("res.signInPasteHint")}</p>
      <div className="tgtoken">
        <Input
          aria-label={t("res.signInPasteLabel")}
          placeholder="http://localhost:…"
          value={url}
          onChange={(ev) => setUrl(ev.currentTarget.value)}
        />
        <Button size="sm" variant="secondary" loading={busy} disabled={!url.trim()} onClick={() => void finish()}>
          {t("res.signInFinish")}
        </Button>
      </div>
      {failed && <p className="signin-elsewhere__failed">{t("res.signInPasteFailed")}</p>}
    </div>
  );
}
