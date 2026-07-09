import { DefaultRouterCard } from "../../components/settings/DefaultRouterCard";
import { RoutingPanel } from "../../components/settings/RoutingPanel";
import { EnginesPanel } from "../../components/settings/EnginesPanel";

// Base "Models" page: default failover router + content-based routing on top of
// the provider list. EnginesPanel is reused as-is from Settings.
export function ModelsTab() {
  return (
    <div className="space-y-6">
      <DefaultRouterCard />
      <RoutingPanel />
      <EnginesPanel />
    </div>
  );
}
