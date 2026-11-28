export type LocationPrivacy = { location: boolean; revision: string };
export type PhonePosition = { lat: number; lon: number; accuracy_m?: number };

type Deps = {
  privacy(): Promise<LocationPrivacy>;
  permitted(): Promise<boolean>;
  watch(receive: (position: PhonePosition) => void): Promise<{ remove(): void }>;
  poll: (check: () => void) => () => void;
  deadline: (stop: () => void) => () => void;
  onStop?: (stop: () => void) => () => void;
};

/** Consent is rechecked before returning a fix; a revocation or lost connection removes the live watcher. */
export async function capturePhoneLocation(d: Deps): Promise<PhonePosition | undefined> {
  const initial = await d.privacy();
  if (!initial.location || !(await d.permitted())) return undefined;
  return new Promise((resolve) => {
    let ended = false;
    let checking = false;
    let watcher: { remove(): void } | undefined;
    let stopEvery: (() => void) | undefined;
    let stopDeadline: (() => void) | undefined;
    let unsubscribe: (() => void) | undefined;
    const finish = (position?: PhonePosition) => {
      if (ended) return;
      ended = true;
      watcher?.remove();
      stopEvery?.();
      stopDeadline?.();
      unsubscribe?.();
      resolve(position);
    };
    unsubscribe = d.onStop?.(() => finish());
    if (ended) {
      unsubscribe?.();
      return;
    }
    const valid = (p: LocationPrivacy) => p.location && p.revision === initial.revision;
    stopEvery = d.poll(() => {
      if (checking || ended) return;
      checking = true;
      void d
        .privacy()
        .then(
          (p) => {
            if (!valid(p)) finish();
          },
          () => finish(),
        )
        .finally(() => {
          checking = false;
        });
    });
    stopDeadline = d.deadline(() => finish());
    void d
      .watch((position) => {
        if (ended) return;
        void Promise.all([d.privacy(), d.permitted()]).then(
          ([p, permitted]) => finish(valid(p) && permitted ? position : undefined),
          () => finish(),
        );
      })
      .then(
        (subscription) => {
          watcher = subscription;
          if (ended) subscription.remove();
        },
        () => finish(),
      );
  });
}
