import type { ObserverCommand } from "./owned-observer.ts";

type ObjectValue = Record<string, unknown>;
export type WindowDescriptor = { handle: string; title?: string; ambiguous: boolean };
export type ObservedNode = { ref: string; role: string; title?: string; redacted: boolean; children: ObservedNode[] };
export type ValidatedResult =
  | { kind: "error"; code: string }
  | { kind: "listing"; session: string; generation: string; windows: WindowDescriptor[] }
  | { kind: "observation"; session: string; generation: string; handle: string; nodes: ObservedNode[] };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const uuid = new RegExp(`^${UUID}$`, "i");
const failures = new Set([
  "INVALID_REQUEST",
  "IDENTITY_MISMATCH",
  "BROWSER_DENIED",
  "UNAVAILABLE",
  "WINDOW_UNRESOLVED",
  "LIMIT_EXCEEDED",
  "DEADLINE_EXCEEDED",
  "UNSUPPORTED",
]);
const roles = new Set([
  "AXWindow",
  "AXGroup",
  "AXButton",
  "AXCheckBox",
  "AXRadioButton",
  "AXStaticText",
  "AXTextField",
  "AXTextArea",
  "AXComboBox",
  "AXSecureTextField",
  "AXScrollArea",
  "AXSplitGroup",
  "AXTabGroup",
  "AXToolbar",
  "AXTable",
  "AXRow",
  "AXColumn",
  "AXCell",
  "AXSlider",
  "AXImage",
  "AXProgressIndicator",
  "AXValueIndicator",
  "AXUnknown",
]);
const textRoles = new Set(["AXTextField", "AXTextArea", "AXComboBox", "AXSecureTextField"]);
const titleRoles = new Set(["AXButton", "AXCheckBox", "AXRadioButton", "AXStaticText"]);

function requireThat(condition: unknown): asserts condition {
  if (!condition) throw new Error("OBSERVER_INVALID_RESULT");
}
function object(value: unknown): ObjectValue {
  requireThat(value && typeof value === "object" && !Array.isArray(value));
  return value as ObjectValue;
}
function keys(value: ObjectValue, required: readonly string[], optional: readonly string[] = []) {
  requireThat(required.every((key) => Object.hasOwn(value, key)));
  requireThat(Object.keys(value).every((key) => required.includes(key) || optional.includes(key)));
}
function identifier(value: unknown): string {
  requireThat(typeof value === "string" && uuid.test(value));
  return value;
}
function title(value: ObjectValue): string | undefined {
  if (!Object.hasOwn(value, "title")) return undefined;
  requireThat(typeof value.title === "string" && value.title.length > 0 && Buffer.byteLength(value.title) <= 128);
  requireThat(!/[\p{Cc}\p{Cf}]/u.test(value.title));
  return value.title;
}
function identity(value: ObjectValue, command: ObserverCommand) {
  requireThat(value.pid === command.pid);
  const launch = object(value.launchIdentity);
  keys(launch, ["seconds", "microseconds"]);
  requireThat(
    launch.seconds === command.launchIdentity.seconds && launch.microseconds === command.launchIdentity.microseconds,
  );
}
function validateCommand(command: ObserverCommand) {
  const input = object(command);
  requireThat(command.op === "listWindows" || command.op === "observeSelected");
  keys(
    input,
    command.op === "listWindows" ? ["op", "pid", "launchIdentity"] : ["op", "pid", "launchIdentity", "handle"],
  );
  requireThat(Number.isSafeInteger(command.pid) && command.pid > 0 && command.pid <= 2_147_483_647);
  const launch = object(command.launchIdentity);
  keys(launch, ["seconds", "microseconds"]);
  requireThat(Number.isSafeInteger(launch.seconds) && Number(launch.seconds) > 0);
  requireThat(
    Number.isSafeInteger(launch.microseconds) &&
      Number(launch.microseconds) >= 0 &&
      Number(launch.microseconds) < 1_000_000,
  );
}
function nodes(value: unknown, session: string, generation: string): ObservedNode[] {
  requireThat(Array.isArray(value) && value.length === 1);
  const refs = new Set<string>();
  const prefix = `${session}:${generation}:`;
  const visit = (raw: unknown, depth: number): ObservedNode => {
    requireThat(depth <= 16 && refs.size < 256);
    const node = object(raw);
    keys(node, ["ref", "role", "redacted", "children"], ["title"]);
    requireThat(typeof node.ref === "string" && node.ref.startsWith(prefix));
    const index = node.ref.slice(prefix.length);
    requireThat(/^(0|[1-9][0-9]{0,2})$/.test(index) && Number(index) < 256 && !refs.has(node.ref));
    refs.add(node.ref);
    requireThat(typeof node.role === "string" && roles.has(node.role) && typeof node.redacted === "boolean");
    requireThat(!textRoles.has(node.role) || node.redacted);
    requireThat(Array.isArray(node.children) && node.children.length <= 256);
    const label = title(node);
    requireThat(label === undefined || (!node.redacted && titleRoles.has(node.role)));
    requireThat(!node.redacted || node.children.length === 0);
    return {
      ref: node.ref,
      role: node.role,
      redacted: node.redacted,
      ...(label === undefined ? {} : { title: label }),
      children: node.children.map((child) => visit(child, depth + 1)),
    };
  };
  const roots = value.map((raw) => visit(raw, 0));
  requireThat(roots[0]?.role === "AXWindow" && roots[0].redacted === false);
  return roots;
}

/** Lab-only semantic validation, not evidence of native provenance, browser policy or truthful redaction. */
export class ObserverResults {
  #session: string | undefined;
  #generations = new Set<string>();
  #selection: { target: string; handles: Set<string> } | undefined;
  #terminal = false;

  retire() {
    this.#terminal = true;
    this.#selection = undefined;
  }

  prepare(command: ObserverCommand): void {
    try {
      requireThat(!this.#terminal && this.#generations.size < 4096);
      validateCommand(command);
      const target = JSON.stringify([command.pid, command.launchIdentity.seconds, command.launchIdentity.microseconds]);
      if (command.op === "observeSelected")
        requireThat(this.#selection?.target === target && this.#selection.handles.has(command.handle));
    } catch {
      this.retire();
      throw new Error("OBSERVER_INVALID_RESULT");
    }
  }

  validate(command: ObserverCommand, raw: unknown): ValidatedResult {
    try {
      this.prepare(command);
      const target = JSON.stringify([command.pid, command.launchIdentity.seconds, command.launchIdentity.microseconds]);
      const response = object(raw);
      requireThat(response.version === 1);
      const generation = identifier(response.generation);
      requireThat(!this.#generations.has(generation) && this.#generations.size < 4096);
      if (Object.hasOwn(response, "error")) {
        keys(response, ["version", "generation", "error"]);
        requireThat(typeof response.error === "string" && failures.has(response.error));
        this.#selection = undefined;
        this.#generations.add(generation);
        return { kind: "error", code: response.error };
      }
      const field = command.op === "listWindows" ? "listing" : "selectedObservation";
      keys(response, ["version", "generation", field]);
      const payload = object(response[field]);
      identity(payload, command);
      const session = identifier(payload.session);
      requireThat(this.#session === undefined || session === this.#session);
      requireThat(payload.generation === generation);
      if (command.op === "listWindows") {
        keys(payload, ["session", "generation", "pid", "launchIdentity", "windows"]);
        requireThat(Array.isArray(payload.windows) && payload.windows.length <= 64);
        const handles = new Set<string>();
        const prefix = `${session}:${generation}:`;
        const windows = payload.windows.map((rawWindow): WindowDescriptor => {
          const window = object(rawWindow);
          keys(window, ["handle", "ambiguous"], ["title"]);
          requireThat(typeof window.handle === "string" && window.handle.startsWith(prefix));
          identifier(window.handle.slice(prefix.length));
          requireThat(!handles.has(window.handle) && typeof window.ambiguous === "boolean");
          handles.add(window.handle);
          const label = title(window);
          requireThat(label === undefined || label.trim() === label);
          return {
            handle: window.handle,
            ambiguous: window.ambiguous,
            ...(label === undefined ? {} : { title: label }),
          };
        });
        for (const window of windows)
          requireThat(
            window.ambiguous ===
              (window.title === undefined || windows.filter((other) => other.title === window.title).length > 1),
          );
        this.#selection = { target, handles };
        this.#session = session;
        this.#generations.add(generation);
        return { kind: "listing", session, generation, windows };
      }
      keys(payload, ["session", "generation", "pid", "launchIdentity", "handle", "association", "nodes"]);
      requireThat(payload.handle === command.handle && payload.association === "ax-only-no-capture-or-coordinates");
      const tree = nodes(payload.nodes, session, generation);
      this.#generations.add(generation);
      return { kind: "observation", session, generation, handle: command.handle, nodes: tree };
    } catch {
      this.retire();
      throw new Error("OBSERVER_INVALID_RESULT");
    }
  }
}
