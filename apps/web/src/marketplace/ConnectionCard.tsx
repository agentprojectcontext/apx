import { Badge, Button, Card } from "@apx/ui";
import type { ReactNode } from "react";
import { useT } from "../i18n/index.ts";

const TONES = {
  off: "neutral",
  disconnected: "neutral",
  connecting: "info",
  connected: "brand",
  saved: "neutral",
  setup: "warning",
  reconnect: "warning",
  error: "danger",
} as const;

export type ConnectionState = keyof typeof TONES;

export function ConnectionCard({
  state,
  hint,
  error,
  onRetry,
  children,
}: {
  state: ConnectionState;
  hint?: string | undefined;
  error?: string | undefined;
  onRetry?(): void;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <Card role="region" aria-label={t("mkt.connection.title")} className="mkt-connection" variant="outline">
      <div className="mkt-connection__row">
        <div className="mkt-connection__copy" role="status">
          <div className="mkt-connection__state">
            <h3>{t("mkt.connection.title")}</h3>
            <Badge tone={TONES[state]} dot>
              {t(`mkt.connection.${state}`)}
            </Badge>
          </div>
          {hint && <p>{hint}</p>}
        </div>
        <div className="mkt-connection__actions">{children}</div>
      </div>
      {error && (
        <div className="mkt-connection__error">
          <span role="alert">{error}</span>
          {onRetry && (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              {t("box.retry")}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
