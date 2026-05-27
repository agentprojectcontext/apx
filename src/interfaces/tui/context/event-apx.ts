import type { ApxEvent } from "./sdk-apx"
import { useSDK } from "./sdk-apx"

export function useEvent() {
  const sdk = useSDK()

  function subscribe(handler: (event: ApxEvent) => void) {
    return sdk.event.on("event", (ev) => handler(ev))
  }

  function on<T extends ApxEvent["type"]>(
    type: T,
    handler: (event: Extract<ApxEvent, { type: T }>, _metadata?: unknown) => void,
  ) {
    return subscribe((event) => {
      if (event.type !== type) return
      handler(event as Extract<ApxEvent, { type: T }>)
    })
  }

  return { subscribe, on }
}
