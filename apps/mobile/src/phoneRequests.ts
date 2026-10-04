// What the core asks the phone as a node: where it is, and a picture the owner takes. Pure: the platform's location
// and camera come in as functions, so this runs under node:test.

export type PhoneDeps = {
  /** The phone's position, or nothing when the owner did not allow it. */
  location(): Promise<{ lat: number; lon: number; accuracy_m?: number } | undefined>;
  /** Asks the owner on screen for a picture; nothing when they decline. */
  photo(reason: string | undefined): Promise<{ mime: string; data: string } | undefined>;
  now?: () => Date;
};

export const PHONE_CAPS = ["location", "camera"] as const;

export async function handlePhoneRequest(method: string, params: unknown, deps: PhoneDeps): Promise<unknown> {
  if (method === "phone.location") {
    const at = (deps.now ?? (() => new Date()))().toISOString();
    const p = await deps.location();
    if (!p) throw new Error("the owner did not allow APX to know where the phone is");
    return { ...p, at };
  }
  if (method === "phone.photo") {
    const reason = (params as { reason?: unknown } | undefined)?.reason;
    const photo = await deps.photo(typeof reason === "string" ? reason : undefined);
    if (!photo) throw new Error("the owner did not take the picture");
    return photo;
  }
  throw new Error(`the phone does not serve ${method}`);
}
