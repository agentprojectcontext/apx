import type { Result } from "@apx/protocol";
import { Button, Dialog, Field, IconButton, Icons, Input, Menu, type MenuEntry } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../../data/client.ts";
import { notify } from "../../data/notices.ts";
import { useT } from "../../i18n/index.ts";

type Status = Result<"git.status">;
type Action = "pull" | "push" | "fetch" | "stash" | "stash_pop" | "undo_commit";

/**
 * The repository's bar: the branch (a menu to switch or make one), how far it is from its upstream, and the actions —
 * the history column, refresh, and the rest (pull, push, stash…) in a menu.
 */
export function GitBar({
  projectId,
  status,
  history,
  onHistory,
  onRefresh,
  act,
}: {
  projectId: string;
  status: Status;
  history: boolean;
  onHistory(): void;
  onRefresh(): void;
  /** Runs a change, says git's refusal, and reads the repository again. */
  act(run: () => Promise<unknown>): Promise<void>;
}) {
  const t = useT();
  const [branches, setBranches] = useState<Result<"git.branches">>();
  const [making, setMaking] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new branch (or a switch) lists them again.
  useEffect(() => {
    client.call("git.branches", { project: projectId }).then(setBranches, () => setBranches(undefined));
  }, [projectId, status.branch]);

  const checkout = (branch: string, create = false) =>
    act(() => client.call("git.checkout", { project: projectId, branch, create }));
  const run = (action: Action) =>
    act(async () => {
      const r = await client.call("git.run", { project: projectId, action });
      notify(r.output.split("\n").slice(-2).join(" ") || t("git.done"), "info");
    });
  const all = (staged: boolean) => {
    const files = staged ? status.staged : status.unstaged;
    if (!files.length) return;
    const paths = files.map((f) => f.path);
    return act(() => client.call(staged ? "git.unstage" : "git.stage", { project: projectId, paths }));
  };

  const branchItems: MenuEntry[] = [
    { type: "label", label: t("git.branches.local") },
    ...(branches?.local ?? []).map((b) => ({
      label: b,
      icon: <Icons.GitBranch />,
      checked: b === branches?.current,
      onSelect: () => void (b === branches?.current ? undefined : checkout(b)),
    })),
    ...(branches?.remote.length
      ? [
          {
            type: "submenu" as const,
            label: t("git.branches.remote"),
            icon: <Icons.Globe />,
            items: branches.remote.map((b) => ({ label: b, onSelect: () => void checkout(b) })),
          },
        ]
      : []),
    { type: "separator" },
    { label: t("git.branches.new"), icon: <Icons.Plus />, onSelect: () => setMaking(true) },
  ];
  const actionItems: MenuEntry[] = [
    { label: t("git.pull"), icon: <Icons.ArrowDown />, onSelect: () => void run("pull") },
    { label: t("git.push"), icon: <Icons.ArrowUp />, onSelect: () => void run("push") },
    { label: t("git.fetch"), icon: <Icons.RefreshCw />, onSelect: () => void run("fetch") },
    { type: "separator" },
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
    { type: "separator" },
    {
      label: t("git.stash"),
      icon: <Icons.Archive />,
      disabled: !status.staged.length && !status.unstaged.length,
      onSelect: () => void run("stash"),
    },
    { label: t("git.stashPop"), icon: <Icons.ArchiveRestore />, onSelect: () => void run("stash_pop") },
    { type: "separator" },
    { label: t("git.undoCommit"), icon: <Icons.RotateCcw />, onSelect: () => void run("undo_commit") },
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
      {making && (
        <NewBranch
          onClose={() => setMaking(false)}
          onMake={async (name) => {
            setMaking(false);
            await checkout(name, true);
          }}
        />
      )}
    </div>
  );
}

function NewBranch({ onClose, onMake }: { onClose(): void; onMake(name: string): void }) {
  const t = useT();
  const [name, setName] = useState("");
  // Spaces become dashes as they are typed: a branch name has none.
  const clean = name.trim().replace(/\s+/g, "-");
  const make = () => clean && onMake(clean);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("git.branches.new")}
      description={t("git.branches.newBody")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!clean} onClick={make}>
            {t("git.branches.make")}
          </Button>
        </>
      }
    >
      <Field label={t("git.branches.name")}>
        {(id) => (
          <Input
            id={id}
            autoFocus
            className="is-mono"
            placeholder="feat/new-checkout"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && make()}
          />
        )}
      </Field>
    </Dialog>
  );
}
