import { DefaultRouterCard } from "../../components/settings/DefaultRouterCard";
import { EnginesPanel } from "../../components/settings/EnginesPanel";

// Base "Models" page: general default router (no per-task cases) on top of the
// provider list. EnginesPanel is reused as-is from Settings.
export function ModelsTab() {
  return (
    <div className="space-y-6">
      <DefaultRouterCard />
      <EnginesPanel />
    </div>
  );
}
