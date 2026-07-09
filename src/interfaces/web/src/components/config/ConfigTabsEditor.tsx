import { useEffect, useMemo, useState } from "react";
import { Button, Field, Input, Switch, Textarea } from "../ui";
import { UiSelect } from "../UiSelect";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { getDotted, parseConfigJson } from "../../lib/config-values";
import { isSecretMarker, secretHint } from "../../lib/secrets";
import { t } from "../../i18n";

export type ConfigField = {
  path: string;
  label: string;
  kind?: "text" | "number" | "boolean" | "select" | "textarea" | "password";
  hint?: string;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
};

export type ConfigSection = {
  key: string;
  label: string;
  description?: string;
  fields: ConfigField[];
};

export function ConfigTabsEditor({
  sections,
  source,
  placeholderSource,
  jsonTitle,
  jsonDescription,
  saveLabel = t("common.save"),
  onSaveFields,
  onSaveJson,
  busy,
  hideJson = false,
}: {
  sections: ConfigSection[];
  source: Record<string, unknown>;
  placeholderSource?: Record<string, unknown>;
  jsonTitle: string;
  jsonDescription?: string;
  saveLabel?: string;
  onSaveFields: (set: Record<string, unknown>, unset: string[]) => Promise<void>;
  onSaveJson: (next: Record<string, unknown>) => Promise<void>;
  busy?: boolean;
  /** Hide the raw-JSON tab (used when JSON editing lives in its own top tab). */
  hideJson?: boolean;
}) {
  const firstKey = sections[0]?.key || "json";
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [raw, setRaw] = useState("");
  const [jsonError, setJsonError] = useState("");

  useEffect(() => {
    const next: Record<string, unknown> = {};
    for (const field of sections.flatMap((section) => section.fields)) {
      next[field.path] = getDotted(source, field.path) ?? "";
    }
    setDraft(next);
    setRaw(JSON.stringify(source || {}, null, 2));
    setJsonError("");
  }, [source, sections]);

  const fieldPaths = useMemo(
    () => new Set(sections.flatMap((section) => section.fields.map((field) => field.path))),
    [sections],
  );

  const saveFields = async () => {
    const set: Record<string, unknown> = {};
    const unset: string[] = [];
    for (const field of sections.flatMap((section) => section.fields)) {
      const value = draft[field.path];
      if (isSecretMarker(value)) continue;
      if (value === "" || value === undefined || value === null) {
        unset.push(field.path);
        continue;
      }
      if (field.kind === "number") {
        const n = Number(value);
        if (Number.isFinite(n)) set[field.path] = n;
      } else {
        set[field.path] = value;
      }
    }
    await onSaveFields(set, unset.filter((key) => fieldPaths.has(key)));
  };

  const saveJson = async () => {
    setJsonError("");
    try {
      await onSaveJson(parseConfigJson(raw));
    } catch (e) {
      setJsonError((e as Error).message);
    }
  };

  const sectionBody = (section: ConfigSection) => (
    <div className="space-y-4">
      {section.description && <p className="text-sm text-muted-fg">{section.description}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {section.fields.map((field) => (
          <ConfigFieldControl
            key={field.path}
            field={field}
            value={draft[field.path]}
            inherited={getDotted(placeholderSource, field.path)}
            onChange={(value) => setDraft((prev) => ({ ...prev, [field.path]: value }))}
          />
        ))}
      </div>
      <Button variant="primary" loading={busy} onClick={saveFields}>{saveLabel}</Button>
    </div>
  );

  // Single section with no JSON tab → render the fields flat (no inner tab bar),
  // so the parent's top-level tab is the only tab the user sees.
  if (hideJson && sections.length <= 1) {
    return sections[0] ? sectionBody(sections[0]) : null;
  }

  return (
    <Tabs defaultValue={firstKey} className="space-y-4">
      <TabsList className="flex flex-wrap">
        {sections.map((section) => (
          <TabsTrigger key={section.key} value={section.key}>{section.label}</TabsTrigger>
        ))}
        {!hideJson && <TabsTrigger value="json">JSON</TabsTrigger>}
      </TabsList>

      {sections.map((section) => (
        <TabsContent key={section.key} value={section.key}>
          {sectionBody(section)}
        </TabsContent>
      ))}

      {!hideJson && (
        <TabsContent value="json">
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-medium">{jsonTitle}</h3>
              {jsonDescription && <p className="text-xs text-muted-fg">{jsonDescription}</p>}
            </div>
            <Textarea
              rows={18}
              className="font-mono text-xs"
              value={raw}
              onChange={(event) => setRaw(event.target.value)}
            />
            {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
            <Button variant="primary" loading={busy} onClick={saveJson}>{t("settings_ui.save_json")}</Button>
          </div>
        </TabsContent>
      )}
    </Tabs>
  );
}

function ConfigFieldControl({
  field,
  value,
  inherited,
  onChange,
}: {
  field: ConfigField;
  value: unknown;
  inherited: unknown;
  onChange: (value: unknown) => void;
}) {
  const placeholder = field.placeholder || formatInherited(inherited) || (isSecretMarker(value) ? secretHint(value) : "");
  const hint = field.hint || (inherited !== undefined ? `Heredado: ${formatInherited(inherited)}` : undefined);

  if (field.kind === "boolean") {
    return (
      <div className="flex items-end pb-1">
        <Switch checked={value === true} onChange={onChange} label={field.label} />
      </div>
    );
  }

  return (
    <Field label={field.label} hint={hint}>
      {field.kind === "select" ? (
        <UiSelect
          value={String(value || "")}
          onChange={onChange}
          placeholder={placeholder || "(sin override)"}
          options={[
            { value: "", label: placeholder || "(sin override)" },
            ...(field.options || []).map((option) => ({ value: String(option.value), label: option.label })),
          ]}
        />
      ) : field.kind === "textarea" ? (
        <Textarea
          rows={4}
          value={String(value || "")}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          type={field.kind === "password" ? "password" : field.kind === "number" ? "number" : "text"}
          value={String(isSecretMarker(value) ? "" : value || "")}
          placeholder={field.kind === "password" && isSecretMarker(value) ? secretHint(value) : field.kind === "password" && isSecretMarker(inherited) ? secretHint(inherited) : placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

function formatInherited(value: unknown) {
  if (value === undefined || value === null || value === "") return "";
  if (isSecretMarker(value)) return secretHint(value);
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
