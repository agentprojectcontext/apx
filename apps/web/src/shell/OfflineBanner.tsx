import { Button, Icons } from "@apx/ui";
import { retryNow } from "../data/live.ts";
import { useData } from "../data/state.ts";

/** Thin strip under the topbar while the core is unreachable. */
export function OfflineBanner() {
  const connection = useData((s) => s.connection);
  const error = useData((s) => s.error);
  const ready = useData((s) => s.ready);
  if (connection !== "offline") return null;
  return (
    <div className="offline" role="alert">
      <Icons.WifiOff size={14} />
      <span className="offline__text">
        {ready ? "Sin conexión con el core. Mostrando lo último que vimos." : "No se pudo conectar con el core."}
        {error && <span className="offline__detail"> {error}</span>}
      </span>
      <Button size="sm" variant="secondary" leadingIcon={<Icons.RefreshCw size={12} />} onClick={retryNow}>
        Reintentar
      </Button>
    </div>
  );
}
