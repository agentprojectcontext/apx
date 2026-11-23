import type { Part } from "@apx/protocol";
import { Button, Icons, Input } from "@apx/ui";
import { useState } from "react";
import { respond } from "../../data/actions.ts";
import { client } from "../../data/client.ts";
import { notify } from "../../data/notices.ts";
import { useT } from "../../i18n/index.ts";
import { siteHost } from "./input-words.ts";

type LoginPart = Extract<Part, { type: "input" }> & { login: NonNullable<Extract<Part, { type: "input" }>["login"]> };

/**
 * An agent needs to sign in and the owner has nothing saved for the site: they type a username and password here,
 * for this time or to keep. What they type goes to APX, never to the agent.
 */
export function SignInCard({ part }: { part: LoginPart }) {
  const t = useT();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"save" | "once" | "no">();
  const needsUser = part.login.kind === "username";
  const ready = password.length > 0 && (!needsUser || username.trim().length > 0);
  const give = async (save: boolean) => {
    setBusy(save ? "save" : "once");
    try {
      await client.call("secrets.provide_login", { input: part.input_id, username, password, save });
    } catch (e) {
      notify(t("error.save", { error: e instanceof Error ? e.message : String(e) }));
      setBusy(undefined);
    }
  };
  return (
    <div className="inputcard is-pending" role="alert">
      <div className="inputcard__head">
        <Icons.KeyRound size={16} />
        <span className="inputcard__title">{t("input.signInTitle", { site: siteHost(part.login.origin) })}</span>
      </div>
      <p className="inputcard__prompt">{part.prompt}</p>
      <form
        className="pform"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !busy) void give(true);
        }}
      >
        <div className="pform__field">
          <span className="pform__label">{t("input.signInUser")}</span>
          <Input
            aria-label={t("input.signInUser")}
            autoComplete="off"
            value={username}
            placeholder={needsUser ? undefined : t("input.signInUserOptional")}
            disabled={Boolean(busy)}
            onChange={(e) => setUsername(e.currentTarget.value)}
          />
        </div>
        <div className="pform__field">
          <span className="pform__label">{t("input.signInPassword")}</span>
          <Input
            aria-label={t("input.signInPassword")}
            type="password"
            autoComplete="off"
            value={password}
            disabled={Boolean(busy)}
            onChange={(e) => setPassword(e.currentTarget.value)}
          />
        </div>
        <p className="resd__note">{t("input.signInHelp")}</p>
        <div className="inputcard__actions">
          <Button size="sm" type="submit" disabled={!ready || Boolean(busy)} loading={busy === "save"}>
            {t("input.signInSave")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!ready || Boolean(busy)}
            loading={busy === "once"}
            onClick={() => void give(false)}
          >
            {t("input.signInOnce")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={Boolean(busy)}
            onClick={() => {
              setBusy("no");
              void respond(part.input_id, { text: t("input.signInNo") });
            }}
          >
            {t("input.signInNo")}
          </Button>
        </div>
      </form>
    </div>
  );
}
