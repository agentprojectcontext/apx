// What browser_do runs: steps that name a control by what the page shows ("button \"Send\""), found again on a fresh
// snapshot before each action, so a sequence learned once runs again without the model reading the page in between.
import { z } from "zod";

/** A control as the page's snapshot lists it: `role "name"`, or only the name. */
const Target = z.string().min(1).max(200);

export const BrowserStep = z.discriminatedUnion("do", [
  z.object({ do: z.literal("open"), url: z.string().min(1).max(2000) }).strict(),
  z
    .object({
      do: z.literal("click"),
      target: Target,
      within: Target.optional().describe("a dialog or region it is inside, when the name repeats"),
    })
    .strict(),
  z
    .object({
      do: z.literal("type"),
      target: Target,
      within: Target.optional(),
      text: z.string().max(10_000),
      submit: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      do: z.literal("wait"),
      text: z.string().min(1).max(500).describe("text the page must show (or stop showing, with gone)"),
      gone: z.boolean().optional(),
      timeout_s: z.number().int().min(1).max(60).optional(),
    })
    .strict(),
]);
export type BrowserStep = z.infer<typeof BrowserStep>;

/** A step as the tool takes it: one flat object, so every call carries a small schema; `toSteps` checks it. */
export const StepArg = z.object({
  do: z.enum(["open", "click", "type", "wait"]),
  target: z.string().optional().describe('click/type: `button "Send"` or a name'),
  within: z.string().optional().describe("the dialog it is in, when names repeat"),
  text: z.string().optional().describe("type: the text; wait: text to wait for"),
  url: z.string().optional().describe("open"),
  submit: z.boolean().optional().describe("type: press Enter after"),
  gone: z.boolean().optional().describe("wait until the text is gone"),
  timeout_s: z.number().optional().describe("wait: seconds (default 10, up to 60)"),
});
export type StepArg = z.infer<typeof StepArg>;

const KEYS: Record<StepArg["do"], readonly (keyof StepArg)[]> = {
  open: ["url"],
  click: ["target", "within"],
  type: ["target", "within", "text", "submit"],
  wait: ["text", "gone", "timeout_s"],
};

/** The tool's steps as BrowserSteps, or what is wrong with the first that does not fit. */
export function toSteps(args: readonly StepArg[]): { steps: BrowserStep[] } | { error: string } {
  const steps: BrowserStep[] = [];
  for (const [i, a] of args.entries()) {
    const picked = Object.fromEntries(
      [["do", a.do], ...KEYS[a.do].map((k) => [k, a[k]])].filter(([, v]) => v !== undefined),
    );
    const r = BrowserStep.safeParse(picked);
    if (!r.success) {
      const issue = r.error.issues[0];
      return {
        error: `step ${i + 1} (${a.do}): ${issue?.path.join(".") || "step"} ${issue?.message ?? "does not fit"}`,
      };
    }
    steps.push(r.data);
  }
  return { steps };
}

/** How long a click or a typing waits for its control to show up before the step fails. */
const FIND_TIMEOUT_S = 10;
const POLL_MS = 400;

/** One control line of a snapshot: `  - button "Send" <url> [e12] = "value"`. */
type Control = { line: number; depth: number; role: string; name: string; ref?: string };

const LINE = /^(\s*)- (\S+)(?: "(.*?)")?(?= <| \[| = "| \(|$)/;
const REF = / \[(e\d+|dialog-(?:ok|cancel|text))\]/;

function controls(tree: string): Control[] {
  const out: Control[] = [];
  for (const [i, text] of tree.split("\n").entries()) {
    const m = LINE.exec(text);
    if (!m) continue;
    const ref = REF.exec(text)?.[1];
    out.push({
      line: i,
      depth: (m[1] ?? "").length,
      role: m[2] ?? "",
      name: m[3] ?? "",
      ...(ref ? { ref } : {}),
    });
  }
  return out;
}

/** `button "Send"` → role and name; `Send` or `"Send"` → only the name. */
function parseTarget(target: string): { role?: string; name: string } {
  const m = /^(\S+) "(.*)"$/.exec(target.trim());
  if (m) return { role: m[1] ?? "", name: m[2] ?? "" };
  return { name: target.trim().replace(/^"(.*)"$/, "$1") };
}

const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();
const holds = (a: string, b: string) => a.toLocaleLowerCase().includes(b.toLocaleLowerCase());

/** The controls a target names: exact names first, else the ones whose name contains it. */
function matching(list: Control[], target: string): Control[] {
  const t = parseTarget(target);
  const roleOk = (c: Control) => !t.role || same(c.role, t.role);
  const exact = list.filter((c) => roleOk(c) && same(c.name, t.name));
  return exact.length ? exact : list.filter((c) => roleOk(c) && t.name !== "" && holds(c.name, t.name));
}

/** The lines inside a control: the ones after it, deeper, until the indentation comes back. */
function inside(all: Control[], parent: Control): Control[] {
  const out: Control[] = [];
  for (const c of all) {
    if (c.line <= parent.line) continue;
    if (c.depth <= parent.depth) break;
    out.push(c);
  }
  return out;
}

export type Found = { ref: string } | { missing: true } | { many: string[] };

/** The one control with a ref the target names (inside `within`, when given). */
export function find(tree: string, target: string, within?: string): Found {
  const all = controls(tree);
  let pool = all;
  if (within) {
    const parents = matching(all, within);
    if (!parents.length) return { missing: true };
    pool = parents.flatMap((p) => inside(all, p));
  }
  const hits = matching(
    pool.filter((c) => c.ref),
    target,
  );
  const [only] = hits;
  if (hits.length === 1 && only?.ref) return { ref: only.ref };
  if (!hits.length) return { missing: true };
  return { many: hits.slice(0, 5).map((c) => `${c.role} "${c.name}"`) };
}

/** Whether the page shows a text (in any control's name or value, or a line of the snapshot). */
const shows = (tree: string, text: string) => holds(tree, text);

const VAR = /\{\{\s*([a-zA-Z_][\w-]*)\s*\}\}/g;

/** The variables steps use, in order, once each. */
export function variablesOf(steps: readonly BrowserStep[]): string[] {
  const names = new Set<string>();
  for (const s of steps)
    for (const v of Object.values(s)) if (typeof v === "string") for (const m of v.matchAll(VAR)) names.add(m[1] ?? "");
  return [...names];
}

/** Steps with `{{name}}` filled from vars; names with no value are returned, nothing is half-filled. */
export function fill(
  steps: readonly BrowserStep[],
  vars: Readonly<Record<string, string>>,
): { steps: BrowserStep[] } | { missing: string[] } {
  const missing = variablesOf(steps).filter((n) => vars[n] === undefined);
  if (missing.length) return { missing };
  const put = (v: string) => v.replace(VAR, (_, n: string) => vars[n] ?? "");
  return {
    steps: steps.map(
      (s) =>
        Object.fromEntries(
          Object.entries(s).map(([k, v]) => [k, k !== "do" && typeof v === "string" ? put(v) : v]),
        ) as BrowserStep,
    ),
  };
}

/** A step in a few words, for the log and the card: `click button "Send"`, `type «hello» in Message`. */
export function stepText(s: BrowserStep): string {
  const where = (t: string, w?: string) => (w ? `${t} in ${w}` : t);
  switch (s.do) {
    case "open":
      return `open ${s.url}`;
    case "click":
      return `click ${where(s.target, s.within)}`;
    case "type":
      return `type «${s.text.slice(0, 30)}${s.text.length > 30 ? "…" : ""}» in ${where(s.target, s.within)}${s.submit ? " + Enter" : ""}`;
    case "wait":
      return `wait ${s.gone ? "until gone" : "for"} «${s.text.slice(0, 40)}»`;
  }
}

/** What the steps need from the browser: the router's browser methods, as this agent. */
export type StepPage = {
  snapshot(): Promise<string>;
  /** The page's visible text, for what the snapshot leaves out (a status line, plain text in a list). */
  text(): Promise<string>;
  click(ref: string): Promise<void>;
  type(ref: string, text: string, submit: boolean): Promise<void>;
  open(url: string): Promise<void>;
  sleep(ms: number): Promise<void>;
  /** The clock waits are measured on (injected, so tests never depend on real time). */
  now(): number;
};

export type StepsOutcome = { done: string[]; failed?: { step: number; why: string; tree?: string } };

/** Runs steps in order and stops at the first that fails, saying which and why. */
export async function runSteps(steps: readonly BrowserStep[], page: StepPage): Promise<StepsOutcome> {
  const done: string[] = [];
  /** Snapshots until `ready` says the page is there, up to `s` seconds; the last tree either way. */
  const poll = async <T>(
    s: number,
    ready: (tree: string) => T | undefined,
    look: () => Promise<string> = page.snapshot,
  ): Promise<{ hit?: T; tree: string }> => {
    const until = page.now() + s * 1000;
    for (;;) {
      const tree = await look();
      const hit = ready(tree);
      if (hit !== undefined || page.now() >= until) return { ...(hit !== undefined ? { hit } : {}), tree };
      await page.sleep(POLL_MS);
    }
  };
  for (const [i, s] of steps.entries()) {
    const n = i + 1;
    try {
      const failed = await one(s, n);
      if (failed) return { done, failed };
    } catch (e) {
      return { done, failed: { step: n, why: e instanceof Error ? e.message : String(e) } };
    }
    done.push(`${n}. ${stepText(s)}`);
  }
  return { done };

  async function one(s: BrowserStep, n: number): Promise<StepsOutcome["failed"]> {
    if (s.do === "open") {
      await page.open(s.url);
      return undefined;
    }
    if (s.do === "wait") {
      const seen = async () => {
        const tree = await page.snapshot();
        return shows(tree, s.text) ? tree : `${tree}\n${await page.text()}`;
      };
      const r = await poll(
        s.timeout_s ?? FIND_TIMEOUT_S,
        (t) => (shows(t, s.text) !== !!s.gone ? true : undefined),
        seen,
      );
      return r.hit
        ? undefined
        : { step: n, why: `${s.gone ? "still shows" : "never showed"} «${s.text}»`, tree: r.tree };
    }
    let last = { missing: true } as Found;
    const r = await poll(FIND_TIMEOUT_S, (t) => {
      last = find(t, s.target, s.within);
      return "ref" in last ? last.ref : undefined;
    });
    if (!r.hit) {
      const why =
        "many" in last
          ? `${s.target} matches more than one control (${last.many.join(", ")}); name it fully or add within`
          : `no control ${s.target}${s.within ? ` in ${s.within}` : ""} on the page`;
      return { step: n, why, tree: r.tree };
    }
    if (s.do === "click") await page.click(r.hit);
    else await page.type(r.hit, s.text, s.submit ?? false);
    return undefined;
  }
}
