import { methods } from "@apx/protocol";
import { inlineName } from "./result.ts";
import { type Params, type Setting, type SettingsDeps, str } from "./settings-kit.ts";

function draftOf(p: Params, deps: SettingsDeps) {
  if (!deps.publications) throw new Error("public_artifact_unavailable");
  return deps.publications.describe(str(p.draft));
}

function says(p: Params, deps: SettingsDeps): string {
  const draft = draftOf(p, deps);
  const action =
    draft.action === "publish"
      ? "Publish a copy of"
      : draft.action === "update"
        ? "Update the public copy of"
        : "Stop publishing";
  return [
    `${action} “${inlineName(draft.title, 120)}”`,
    draft.url,
    ...(draft.action === "revoke"
      ? ["The link will stop working. Downloaded files and your local artifact will stay."]
      : [
          `${draft.bytes.toLocaleString("en")} bytes · ${draft.state_keys.length} state items included`,
          ...(draft.state_keys.length
            ? [`Included state: ${draft.state_keys.map((key) => JSON.stringify(key)).join(", ")}`]
            : ["No saved state included."]),
          "Anyone with the link can view and download this copy. Review the page and selected state before approving.",
        ]),
  ].join("\n");
}

export const PUBLIC_ARTIFACTS: Readonly<Record<string, Setting>> = {
  "surfaces.public_list": {
    does: "Lists the signed-in account's published copies. Account-wide reads stay with the global super-agent.",
    own: {
      reads: true,
      confirm: "never",
      args: methods["surfaces.public_list"].params,
      run: async (_, _deps, ctx) => JSON.stringify(await ctx.call("surfaces.public_list", {})),
    },
  },
  "surfaces.public_prepare": {
    does: "Prepares an immutable publish/update/revoke preview; never publishes. State is omitted unless state_keys is given. Pass the returned draft to surfaces.public_commit for the owner's mandatory review card.",
    own: {
      reads: true,
      confirm: "never",
      args: methods["surfaces.public_prepare"].params,
      run: async (p, _deps, ctx) => JSON.stringify(await ctx.call("surfaces.public_prepare", p as never)),
    },
  },
  "surfaces.public_commit": {
    does: "Publishes, updates or revokes the exact prepared draft, only after the owner's card in every mode. Expired or changed copies need a new preview and a new approval.",
    asks: "card",
    named: ["draft"],
    whole: true,
    says,
    refuse: (p, deps) => {
      try {
        draftOf(p, deps);
        return undefined;
      } catch {
        return "This review is no longer available. Prepare a new copy for the owner to review.";
      }
    },
  },
};
