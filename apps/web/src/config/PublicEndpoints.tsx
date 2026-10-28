import type { PublicEndpointInfo } from "@apx/protocol";
import { Badge, Button, EmptyState, IconButton, Icons, Input, SettingRow, Skeleton } from "@apx/ui";
import { useCallback, useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { usePack, useT } from "../i18n/index.ts";
import { SubHead } from "./SectionHead.tsx";

export function PublicEndpoints() {
  const ready = usePack("ingress");
  const t = useT();
  const [routes, setRoutes] = useState<PublicEndpointInfo[]>();
  const [base, setBase] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [credential, setCredential] = useState<{ path: string; value: string }>();
  const fail = useCallback(
    (e: unknown) => notify(t("hooks.failed", { error: e instanceof Error ? e.message : String(e) })),
    [t],
  );
  const load = useCallback(async () => {
    try {
      const [list, address] = await Promise.all([
        client.call("public_routes.list", {}),
        client.call("webhooks.get", {}),
      ]);
      setRoutes(list.routes);
      setBase(address.url);
    } catch (e) {
      fail(e);
    }
  }, [fail]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => clearInterval(timer);
  }, [load]);
  const change = async (path: string, rotate: boolean) => {
    if (busy) return;
    setBusy(true);
    setCredential(undefined);
    try {
      if (rotate) {
        const entry = await client.call("public_routes.rotate", { path });
        await load();
        const { value } = await client.call("secrets.reveal", { name: entry.secret_ref.slice(9) });
        setCredential({ path, value });
      } else {
        await client.call("public_routes.revoke", { path });
        await load();
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify(t("ingress.copied"), "info");
    } catch (e) {
      fail(e);
    }
  };
  if (!ready) return <Skeleton width="100%" height={80} />;
  return (
    <>
      <SubHead>{t("ingress.routes")}</SubHead>
      <p className="config__lead">{t("ingress.routesHint")}</p>
      {!routes && <Skeleton width="100%" height={80} />}
      {routes?.length === 0 && (
        <EmptyState variant="dashed" size="sm" icon={<Icons.Globe />}>
          {t("ingress.noRoutes")}
        </EmptyState>
      )}
      {routes?.map((route) => (
        <SettingRow key={route.path} title={route.label} description={<code>{route.path}</code>}>
          <div className="config__headactions">
            <Badge tone={route.enabled ? "brand" : "neutral"}>
              {t(route.enabled ? "ingress.enabled" : "ingress.revoked")}
            </Badge>
            {base && (
              <IconButton
                size="sm"
                label={t("ingress.copyUrl")}
                icon={<Icons.Copy size={14} />}
                disabled={busy}
                onClick={() => void copy(`${base}${route.path}`)}
              />
            )}
            {route.enabled ? (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void change(route.path, false)}>
                {t("ingress.revoke")}
              </Button>
            ) : (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void change(route.path, true)}>
                {t("ingress.create")}
              </Button>
            )}
          </div>
        </SettingRow>
      ))}
      {credential && (
        <SettingRow title={t("ingress.tokenTitle")} description={t("ingress.tokenHint")}>
          <div className="config__headactions">
            <Input readOnly aria-label={t("ingress.tokenTitle")} value={credential.value} />
            <IconButton
              size="sm"
              label={t("ingress.copyToken")}
              icon={<Icons.Copy size={14} />}
              onClick={() => void copy(credential.value)}
            />
            <Button size="sm" variant="secondary" onClick={() => setCredential(undefined)}>
              {t("ingress.hideToken")}
            </Button>
          </div>
        </SettingRow>
      )}
    </>
  );
}
