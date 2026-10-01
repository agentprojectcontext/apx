import type { ApiClient, ClientScope } from "@apx/protocol";
import { Badge, Button, Checkbox, IconButton, Icons, Input } from "@apx/ui";
import { useCallback, useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { SubHead } from "./SectionHead.tsx";

const SCOPES: ClientScope[] = ["chat", "browser"];

/** Outside apps (Claude Code, Codex…) with their own token: they act as a model within their scopes, never as you. */
export function ClientsBlock() {
  const t = useT();
  const [list, setList] = useState<ApiClient[]>();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ClientScope[]>(["chat"]);
  const [made, setMade] = useState<{ name: string; token: string }>();
  const fail = useCallback(
    (e: unknown) => notify(t("error.clients", { error: e instanceof Error ? e.message : String(e) })),
    [t],
  );
  const load = useCallback(async () => {
    try {
      setList((await client.call("clients.list", {})).clients);
    } catch (e) {
      fail(e);
    }
  }, [fail]);
  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    try {
      const r = await client.call("clients.create", { name: name.trim(), scopes });
      setMade({ name: r.client.name, token: r.token });
      setName("");
      await load();
    } catch (e) {
      fail(e);
    }
  };
  const revoke = async (id: string) => {
    try {
      await client.call("clients.revoke", { id });
      await load();
    } catch (e) {
      fail(e);
    }
  };

  return (
    <>
      <SubHead>{t("clients.title")}</SubHead>
      <p className="config__lead">{t("clients.lead")}</p>
      {list?.map((c) => (
        <div key={c.id} className="tgtoken">
          <span className="res__name">{c.name}</span>
          {c.scopes.map((s) => (
            <Badge key={s}>{t(`clients.scope.${s}`)}</Badge>
          ))}
          <span className="pcard__spacer" />
          <span className="pform__hint">
            {c.last_used_at
              ? t("clients.used", { when: new Date(c.last_used_at).toLocaleString() })
              : t("clients.never")}
          </span>
          <IconButton
            size="sm"
            label={t("clients.revoke")}
            icon={<Icons.Trash2 size={14} />}
            onClick={() => void revoke(c.id)}
          />
        </div>
      ))}
      <div className="tgtoken">
        <Input
          aria-label={t("clients.name")}
          placeholder={t("clients.namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        {SCOPES.map((s) => (
          <Checkbox
            key={s}
            label={t(`clients.scope.${s}`)}
            checked={scopes.includes(s)}
            onCheckedChange={(on) => setScopes(on ? [...scopes, s] : scopes.filter((x) => x !== s))}
          />
        ))}
        <Button size="sm" disabled={!name.trim() || !scopes.length} onClick={() => void create()}>
          {t("clients.create")}
        </Button>
      </div>
      {made && (
        <div className="pcard">
          <span className="res__name">{t("clients.tokenFor", { name: made.name })}</span>
          <code className="soon__code">{made.token}</code>
          <span className="pform__hint">{t("clients.tokenOnce")}</span>
          <code className="soon__code">{`claude mcp add apx -e APX_CLIENT_TOKEN=${made.token} -- apx2 mcp`}</code>
          <div className="pcard__actions">
            <span className="pcard__spacer" />
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<Icons.X size={14} />}
              onClick={() => setMade(undefined)}
            >
              {t("common.done")}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
