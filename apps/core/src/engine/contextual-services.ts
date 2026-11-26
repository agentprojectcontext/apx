import { createActivityReview } from "./activity-review.ts";
import { createDiscovery } from "./discovery.ts";
import type { NotifyOwner } from "./discovery-deliver.ts";
import type { DiscoveryWeb } from "./discovery-research.ts";

export function contextualServices(
  deps: Parameters<typeof createActivityReview>[0] & {
    web?: DiscoveryWeb | undefined;
    onEnabled?: () => void;
    notifyOwner?: NotifyOwner;
  },
) {
  const activityReview = createActivityReview(deps);
  const discovery = createDiscovery(deps);
  return {
    activityReview,
    discovery,
    checks: [activityReview.check, discovery.check],
    async close() {
      await Promise.all([activityReview.close(), discovery.close()]);
    },
  };
}
