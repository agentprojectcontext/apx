import { Button, Icons, Menu, Select } from "@apx/ui";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { useReach } from "./ByProject.tsx";
import { useVariableNames } from "./useVariableNames.ts";

/**
 * Where one of the owner's servers lives (global, or one project: only its agents use it) and, for a global one, the
 * projects it is on in. Both are saved with the server, and the list and its detail show the same.
 */
export function McpAvailability({
  lives,
  onLives,
  offIn,
  onOffIn,
  values,
}: {
  /** "global" or the project it lives in. */
  lives: string;
  onLives(value: string): void;
  /** A global server: the projects it is turned off in. */
  offIn: string[];
  onOffIn(next: string[]): void;
  /** Its env/header values, to say which variables still need a value where it lives. */
  values: string[];
}) {
  const t = useT();
  const projects = useData((s) => s.projects).filter((p) => p.registered !== false);
  const reach = useReach(offIn);
  const references = [
    ...new Set(values.flatMap((text) => [...text.matchAll(/secret:\/\/([a-zA-Z0-9_.-]+)/g)].map((m) => m[1] ?? ""))),
  ];
  const { names } = useVariableNames(references.length > 0, lives === "global" ? undefined : lives);
  const missing = names ? references.filter((name) => !names.includes(name)) : [];
  const home = projects.find((p) => p.id === lives);
  return (
    <>
      <div className="pform__field">
        <span className="pform__label">{t("res.mcpLives")}</span>
        <Select
          label={t("res.mcpLives")}
          value={lives}
          onValueChange={(next) => next && onLives(next)}
          options={[
            { value: "global", label: t("res.scope.global"), icon: <Icons.Globe size={14} /> },
            ...projects.map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
      </div>
      <div className="pform__field">
        <span className="pform__label">{t("res.mcpAvailable")}</span>
        {home ? (
          <p className="resd__note">{t("res.mcpLivesHint", { name: home.name })}</p>
        ) : (
          <Menu
            align="start"
            trigger={
              <Button variant="secondary" className="mcp-editor__reach" trailingIcon={<Icons.ChevronDown size={14} />}>
                {reach.off.length ? t("res.mcpSome", { n: reach.on, total: reach.total }) : t("res.mcpEverywhere")}
              </Button>
            }
            items={[
              {
                label: t("res.mcpEverywhere"),
                checked: !reach.off.length,
                keepOpen: true,
                onSelect: () => onOffIn([]),
              },
              { type: "separator" },
              ...projects.map((p) => {
                const on = !offIn.includes(p.id);
                return {
                  label: p.name,
                  checked: on,
                  keepOpen: true,
                  onSelect: () => onOffIn(on ? [...offIn, p.id] : offIn.filter((id) => id !== p.id)),
                };
              }),
            ]}
          />
        )}
      </div>
      {missing.length > 0 && (
        <p role="status" className="resd__note">
          {t("res.mcpMissingVariables", { names: missing.join(", ") })}
        </p>
      )}
    </>
  );
}
