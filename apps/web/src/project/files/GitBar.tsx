import type { Result } from "@apx/protocol";
import { Button, Dialog, Field, IconButton, Icons, Input, Menu, type MenuEntry, Select } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../../data/client.ts";
import { notify } from "../../data/notices.ts";
import { useT } from "../../i18n/index.ts";
import type { At, FilesView } from "./GitFiles.tsx";

type Status = Result<"git.status">;
type Action = "pull" | "push" | "fetch" | "stash" | "stash_pop" | "undo_commit" | "merge_abort" | "rebase_abort";
type BranchOp = "merge" | "rebase" | "rename" | "delete" | "delete_remote";
/** A dialog the bar opens: a new branch (maybe from another), a rename, or a confirmation before something drastic. */
type Asking =
  | { kind: "new"; from?: boolean }
  | { kind: "rename" }
  | { kind: "confirm"; op: BranchOp; branch: string; force?: boolean };

/**
 * The repository's bar: the branch (a menu to switch or make one), how far it is from its upstream, the files' view
 * (list or tree), the history column, refresh, and the rest — commit, branch, remote and stash — in a menu.
 */
export function GitBar({
  at,
  status,
  view,
  onView,
  history,
  onHistory,
  onRefresh,
  onCommit,
  act,
}: {
  at: At;
  status: Status;
  view: FilesView;
  onView(view: FilesView): void;
  history: boolean;
  onHistory(): void;
  onRefresh(): void;
  /** Commits with the message box's words (what is staged, or all), or amends the last commit. */
  onCommit(opts: { all?: boolean; amend?: boolean }): void;
  /** Runs a change, says git's refusal, and reads the repository again. */
  act(run: () => Promise<unknown>): Promise<void>;
}) {
  const t = useT();
  const [branches, setBranches] = useState<Result<"git.branches">>();
  const [asking, setAsking] = useState<Asking>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new branch (or a switch) lists them again.
  useEffect(() => {
    client.call("git.branches", at).then(setBranches, () => setBranches(undefined));
  }, [at, status.branch]);

  const said = (output: string) => notify(output.split("\n").slice(-2).join(" ") || t("git.done"), "info");
  const checkout = (branch: string, create = false, from?: string) =>
    act(() => client.call("git.checkout", { ...at, branch, create, ...(from ? { from } : {}) }));
  const run = (action: Action) => act(async () => said((await client.call("git.run", { ...at, action })).output));
  const branchOp = (op: BranchOp, branch: string, force = false) =>
    act(async () => said((await client.call("git.branch", { ...at, op, branch, force })).output));
  const all = (staged: boolean) => {
    const files = staged ? status.staged : status.unstaged;
    if (!files.length) return;
    const paths = files.map((f) => f.path);
    return act(() => client.call(staged ? "git.unstage" : "git.stage", { ...at, paths }));
  };

  const current = branches?.current;
  const others = (branches?.local ?? []).filter((b) => b !== current);
  const remotes = branches?.remote ?? [];
  /** A submenu of branches, or a disabled line saying there are none. */
  const pickBranch = (list: string[], onPick: (b: string) => void): MenuEntry[] =>
    list.length
      ? list.map((b) => ({ label: b, onSelect: () => onPick(b) }))
      : [{ label: t("git.branches.none"), disabled: true }];
  const dirty = status.staged.length + status.unstaged.length > 0;

  const branchItems: MenuEntry[] = [
    { type: "label", label: t("git.branches.local") },
    ...(branches?.local ?? []).map((b) => ({
      label: b,
      icon: <Icons.GitBranch />,
      checked: b === current,
      onSelect: () => void (b === current ? undefined : checkout(b)),
    })),
    ...(remotes.length
      ? [
          {
            type: "submenu" as const,
            label: t("git.branches.remote"),
            icon: <Icons.Globe />,
            items: remotes.map((b) => ({ label: b, onSelect: () => void checkout(b) })),
          },
        ]
      : []),
    { type: "separator" },
    { label: t("git.branches.new"), icon: <Icons.Plus />, onSelect: () => setAsking({ kind: "new" }) },
  ];
  const actionItems: MenuEntry[] = [
    {
      type: "submenu",
      label: t("git.menu.commit"),
      icon: <Icons.GitCommitHorizontal />,
      items: [
        { label: t("git.commit"), disabled: !status.staged.length, onSelect: () => onCommit({}) },
        { label: t("git.commitAll"), disabled: !dirty, onSelect: () => onCommit({ all: true }) },
        { type: "separator" },
        { label: t("git.amend"), onSelect: () => onCommit({ amend: true }) },
        { label: t("git.amendAll"), onSelect: () => onCommit({ all: true, amend: true }) },
        { type: "separator" },
        { label: t("git.undoCommit"), icon: <Icons.RotateCcw />, onSelect: () => void run("undo_commit") },
      ],
    },
    {
      type: "submenu",
      label: t("git.menu.changes"),
      icon: <Icons.ListChecks />,
      items: [
        {
          label: t("git.stageAll"),
          icon: <Icons.Plus />,
          disabled: !status.unstaged.length,
          onSelect: () => void all(false),
        },
        {
          label: t("git.unstageAll"),
          icon: <Icons.Minus />,
          disabled: !status.staged.length,
          onSelect: () => void all(true),
        },
      ],
    },
    {
      type: "submenu",
      label: t("git.menu.remote"),
      icon: <Icons.Globe />,
      items: [
        { label: t("git.pull"), icon: <Icons.ArrowDown />, onSelect: () => void run("pull") },
        { label: t("git.push"), icon: <Icons.ArrowUp />, onSelect: () => void run("push") },
        { label: t("git.fetch"), icon: <Icons.RefreshCw />, onSelect: () => void run("fetch") },
      ],
    },
    {
      type: "submenu",
      label: t("git.menu.branch"),
      icon: <Icons.GitBranch />,
      items: [
        {
          type: "submenu",
          label: t("git.branch.merge"),
          icon: <Icons.GitMerge />,
          items: pickBranch([...others, ...remotes], (b) => void branchOp("merge", b)),
        },
        {
          type: "submenu",
          label: t("git.branch.rebase"),
          items: pickBranch([...others, ...remotes], (b) => setAsking({ kind: "confirm", op: "rebase", branch: b })),
        },
        { type: "separator" },
        { label: t("git.branches.new"), icon: <Icons.Plus />, onSelect: () => setAsking({ kind: "new" }) },
        { label: t("git.branches.newFrom"), onSelect: () => setAsking({ kind: "new", from: true }) },
        { type: "separator" },
        { label: t("git.branch.rename"), disabled: !current, onSelect: () => setAsking({ kind: "rename" }) },
        {
          type: "submenu",
          label: t("git.branch.delete"),
          items: pickBranch(others, (b) => setAsking({ kind: "confirm", op: "delete", branch: b })),
        },
        {
          type: "submenu",
          label: t("git.branch.deleteRemote"),
          items: pickBranch(remotes, (b) => setAsking({ kind: "confirm", op: "delete_remote", branch: b })),
        },
        { type: "separator" },
        {
          label: t("git.branch.publish"),
          icon: <Icons.Upload />,
          disabled: !current,
          onSelect: () => void run("push"),
        },
        { type: "separator" },
        { label: t("git.mergeAbort"), onSelect: () => void run("merge_abort") },
        { label: t("git.rebaseAbort"), onSelect: () => void run("rebase_abort") },
      ],
    },
    {
      type: "submenu",
      label: t("git.menu.stash"),
      icon: <Icons.Archive />,
      items: [
        { label: t("git.stash"), icon: <Icons.Archive />, disabled: !dirty, onSelect: () => void run("stash") },
        { label: t("git.stashPop"), icon: <Icons.ArchiveRestore />, onSelect: () => void run("stash_pop") },
      ],
    },
  ];

  return (
    <div className="git__bar">
      <Menu
        trigger={
          <Button size="sm" variant="ghost" className="git__branchbtn" leadingIcon={<Icons.GitBranch size={14} />}>
            <span className="git__branchname">{status.branch ?? t("git.detached")}</span>
            <Icons.ChevronDown size={12} />
          </Button>
        }
        items={branchItems}
      />
      {status.upstream && (
        <span className="git__sync" title={status.upstream}>
          {status.ahead ? (
            <span title={t("git.ahead", { n: status.ahead })}>
              <Icons.ArrowUp size={12} />
              {status.ahead}
            </span>
          ) : null}
          {status.behind ? (
            <span title={t("git.behind", { n: status.behind })}>
              <Icons.ArrowDown size={12} />
              {status.behind}
            </span>
          ) : null}
        </span>
      )}
      <span className="files__spacer" />
      <IconButton
        size="sm"
        label={view === "tree" ? t("git.viewList") : t("git.viewTree")}
        icon={view === "tree" ? <Icons.List size={14} /> : <Icons.FolderTree size={14} />}
        onClick={() => onView(view === "tree" ? "list" : "tree")}
      />
      <IconButton
        size="sm"
        label={history ? t("git.historyHide") : t("git.historyShow")}
        icon={<Icons.Clock size={14} />}
        active={history}
        onClick={onHistory}
      />
      <IconButton size="sm" label={t("git.refresh")} icon={<Icons.RefreshCw size={14} />} onClick={onRefresh} />
      <Menu
        align="end"
        trigger={<IconButton size="sm" label={t("git.more.actions")} icon={<Icons.Ellipsis size={14} />} />}
        items={actionItems}
      />
      {asking?.kind === "new" && (
        <NameDialog
          title={asking.from ? t("git.branches.newFrom") : t("git.branches.new")}
          body={t("git.branches.newBody")}
          action={t("git.branches.make")}
          {...(asking.from ? { from: [...(branches?.local ?? []), ...remotes] } : {})}
          onClose={() => setAsking(undefined)}
          onDone={(name, from) => {
            setAsking(undefined);
            void checkout(name, true, from);
          }}
        />
      )}
      {asking?.kind === "rename" && (
        <NameDialog
          title={t("git.branch.rename")}
          action={t("git.branch.renameDo")}
          initial={current ?? ""}
          onClose={() => setAsking(undefined)}
          onDone={(name) => {
            setAsking(undefined);
            void branchOp("rename", name);
          }}
        />
      )}
      {asking?.kind === "confirm" && (
        <Dialog
          open
          onOpenChange={(o) => !o && setAsking(undefined)}
          title={t(`git.confirm.${asking.op}` as "git.confirm.delete", { branch: asking.branch })}
          description={t(`git.confirm.${asking.op}Body` as "git.confirm.deleteBody", { branch: asking.branch })}
          footer={
            <>
              <Button variant="secondary" onClick={() => setAsking(undefined)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant={asking.op === "rebase" ? "primary" : "danger"}
                onClick={() => {
                  setAsking(undefined);
                  void branchOp(asking.op, asking.branch, asking.op === "delete");
                }}
              >
                {t(`git.confirm.${asking.op}Do` as "git.confirm.deleteDo")}
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}

/** A branch name to type (spaces become dashes, as a branch has none), and maybe where it starts. */
function NameDialog({
  title,
  body,
  action,
  initial = "",
  from,
  onClose,
  onDone,
}: {
  title: string;
  body?: string;
  action: string;
  initial?: string;
  /** Offered starting points: shown as a choice when given. */
  from?: string[];
  onClose(): void;
  onDone(name: string, from?: string): void;
}) {
  const t = useT();
  const [name, setName] = useState(initial);
  const [start, setStart] = useState(from?.[0] ?? "");
  const clean = name.trim().replace(/\s+/g, "-");
  const done = () => clean && onDone(clean, from ? start : undefined);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      {...(body ? { description: body } : {})}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!clean || clean === initial} onClick={done}>
            {action}
          </Button>
        </>
      }
    >
      <div className="newproject">
        <Field label={t("git.branches.name")}>
          {(id) => (
            <Input
              id={id}
              autoFocus
              className="is-mono"
              placeholder="feat/new-checkout"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && done()}
            />
          )}
        </Field>
        {from && (
          <Field label={t("git.branches.from")}>
            <Select
              label={t("git.branches.from")}
              value={start}
              onValueChange={(v) => v && setStart(v)}
              options={from.map((b) => ({ value: b, label: b }))}
            />
          </Field>
        )}
      </div>
    </Dialog>
  );
}
