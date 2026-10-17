// Where telemetry goes. The default is the APX project's Firestore, written through its REST API with no account: its
// security rules (firebase/firestore.rules) accept only these shapes, stamp the time themselves and allow no reads.
// A plain https URL takes the same events as JSON instead (a backend of our own later, a test's fake one now).
import type { TelemetryEvent } from "@apx/protocol";

/** Sends one event; throws when it did not land, so the step is tried again later. */
export type TelemetrySink = (event: TelemetryEvent) => Promise<void>;

/** The default sink: "firestore:<project id>". */
export const TELEMETRY_SINK = "firestore:apx-agents";

const TIMEOUT_MS = 15_000;

export function telemetrySink(spec: string, fetchImpl: typeof fetch = fetch): TelemetrySink {
  if (spec.startsWith("firestore:")) return firestoreSink(spec.slice("firestore:".length), fetchImpl);
  if (/^https?:\/\//.test(spec)) return jsonSink(spec, fetchImpl);
  throw new Error(`unknown telemetry sink: ${spec}`);
}

function jsonSink(url: string, fetchImpl: typeof fetch): TelemetrySink {
  return async (event) => {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "apx-telemetry" },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`telemetry: HTTP ${res.status}`);
  };
}

type Value = { stringValue: string } | { booleanValue: boolean } | { integerValue: string };
const str = (s: string): Value => ({ stringValue: s });
const now = (fieldPath: string) => ({ fieldPath, setToServerValue: "REQUEST_TIME" });

/** The Firestore commit that records one event (exported for tests). */
export function firestoreWrite(project: string, event: TelemetryEvent) {
  const root = `projects/${project}/databases/(default)/documents/installs/${event.install_id}`;
  if (event.kind === "usage") {
    const fields: Record<string, Value> = { version: str(event.version) };
    for (const [k, v] of Object.entries(event.stats)) fields[k] = { integerValue: String(v) };
    // One report per day: a second one for the same day is refused, and counts as sent.
    return {
      update: { name: `${root}/days/${event.day}`, fields },
      updateTransforms: [now("at")],
      currentDocument: { exists: false },
    };
  }
  const fields: Record<string, Value> = {
    version: str(event.info.version),
    os: str(event.info.os),
    arch: str(event.info.arch),
    channel: str(event.info.channel),
  };
  if (event.usage !== undefined) fields.usage = { booleanValue: event.usage };
  if (event.stage === "installed") {
    fields.first_version = str(event.info.version);
    return {
      update: { name: root, fields },
      updateTransforms: [now("created"), now("updated_at"), now("stages.installed")],
      currentDocument: { exists: false },
    };
  }
  // Only these fields change: the steps already stamped stay as they were.
  return {
    update: { name: root, fields },
    updateMask: { fieldPaths: Object.keys(fields) },
    updateTransforms: [now("updated_at"), now(`stages.${event.stage}`)],
    currentDocument: { exists: true },
  };
}

function firestoreSink(project: string, fetchImpl: typeof fetch): TelemetrySink {
  const url = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents:commit`;
  return async (event) => {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "apx-telemetry" },
      body: JSON.stringify({ writes: [firestoreWrite(project, event)] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) return;
    const body = (await res.json().catch(() => ({}))) as { error?: { status?: string; message?: string } };
    const status = body.error?.status ?? "";
    // Already there: an `installed` sent before (a reinstall over the same home) or today's report.
    const once = event.kind === "usage" || event.stage === "installed";
    if (once && (status === "FAILED_PRECONDITION" || status === "ALREADY_EXISTS")) return;
    throw new Error(`telemetry: HTTP ${res.status} ${status} ${body.error?.message ?? ""}`.trim());
  };
}
