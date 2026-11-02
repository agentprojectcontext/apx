import { ObserverResults, type ValidatedResult } from "./observer-results.ts";
import { type ObserverCommand, OwnedObserver } from "./owned-observer.ts";

/** Private lab caller; executable provenance and target authorization remain the launcher's responsibility. */
export class ObserverReader {
  readonly #transport: OwnedObserver;
  readonly #results = new ObserverResults();
  #busy = false;

  constructor(config: ConstructorParameters<typeof OwnedObserver>[0]) {
    this.#transport = new OwnedObserver(config);
  }

  async request(command: ObserverCommand): Promise<ValidatedResult> {
    if (this.#busy) throw new Error("OBSERVER_BUSY");
    this.#busy = true;
    try {
      const stable = structuredClone(command);
      this.#results.prepare(stable);
      return this.#results.validate(stable, await this.#transport.request(stable));
    } catch {
      await this.stop();
      throw new Error("OBSERVER_READ_FAILED");
    } finally {
      this.#busy = false;
    }
  }

  async stop(): Promise<void> {
    this.#results.retire();
    await this.#transport.stop();
  }
}
