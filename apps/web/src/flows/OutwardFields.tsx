// Settings of the steps that act outside APX: a message sent as the owner, a call to another service. Who gets the
// message is picked from the owner's own channels and contacts, never typed (DECISIONS.md#d-169).
import { Button, ChannelIcon, Field, Input, SegmentedControl, Select, Switch } from "@apx/ui";
import { useEffect, useState } from "react";
import { loadChannels, useChannels } from "../data/channels.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { destinationOf, hostOf } from "./data.ts";
import type { FlowNode } from "./steps.tsx";
import { Template, type Values } from "./Template.tsx";

type Notify = Extract<FlowNode, { kind: "notify" }>;
type Http = Extract<FlowNode, { kind: "http" }>;

export function NotifyFields({ n, update, values }: { n: Notify; update: (n: FlowNode) => void; values: Values }) {
  const t = useT();
  const ready = useChannels((s) => s.ready);
  const channels = useChannels((s) => s.channels).filter((c) => c.enabled);
  const persons = useChannels((s) => s.persons);
  useEffect(() => {
    if (!ready) void loadChannels();
  }, [ready]);
  // One chat app: it is the channel, nothing to choose.
  const only = channels.length === 1 ? channels[0]?.id : undefined;
  useEffect(() => {
    if (only && !n.channel) update({ ...n, channel: only });
  }, [only, n, update]);
  if (ready && !channels.length)
    return (
      <>
        <p className="fe-note">{t("flow.f.noChannels")}</p>
        <Button variant="secondary" size="sm" onClick={() => go.config("channels")}>
          {t("flow.f.connectChannel")}
        </Button>
      </>
    );
  const channel = channels.find((c) => c.id === n.channel);
  const people = channel
    ? persons
        .filter((p) => p.role !== "blocked" && p.addresses.some((a) => a.channel === channel.id))
        .sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner") || a.name.localeCompare(b.name))
    : [];
  const rooms = channel?.rooms?.rooms ?? [];
  const to = n.to.kind === "room" ? `room:${n.to.room}` : n.to.person ? `contact:${n.to.person}` : null;
  const pickChannel = (id: string | null) => update({ ...n, channel: id ?? "", to: { kind: "contact", person: "" } });
  const dest = destinationOf(n, { channels, persons });
  return (
    <>
      <Field label={t("flow.f.channel")}>
        {() =>
          channels.length <= 3 ? (
            <SegmentedControl
              size="sm"
              label={t("flow.f.channel")}
              value={n.channel}
              onValueChange={pickChannel}
              options={channels.map((c) => ({ value: c.id, label: c.label }))}
            />
          ) : (
            <Select
              label={t("flow.f.channel")}
              value={n.channel || null}
              placeholder={t("flow.f.choose")}
              onValueChange={pickChannel}
              options={channels.map((c) => ({
                value: c.id,
                label: c.label,
                icon: <ChannelIcon channel={c.type} size={14} />,
              }))}
            />
          )
        }
      </Field>
      <Field label={t("flow.f.to")}>
        {() =>
          channel && !people.length && !rooms.length ? (
            <span className="fe-ins__muted">{t("flow.f.nobodyThere", { channel: channel.label })}</span>
          ) : (
            <Select
              label={t("flow.f.to")}
              value={to}
              placeholder={t("flow.f.choose")}
              onValueChange={(v) => {
                const [kind, id = ""] = (v ?? "").split(/:(.*)/s);
                update({ ...n, to: kind === "room" ? { kind: "room", room: id } : { kind: "contact", person: id } });
              }}
              options={[
                ...people.map((p) => ({
                  value: `contact:${p.id}`,
                  label: p.role === "owner" ? t("flow.f.toYou") : p.name,
                  group: t("flow.f.toPeople"),
                })),
                ...rooms.map((r) => ({
                  value: `room:${r.id}`,
                  label: `#${r.name || r.id}`,
                  group: t("flow.f.toRooms"),
                })),
              ]}
            />
          )
        }
      </Field>
      <Field label={t("flow.f.message")} hint={t("flow.f.messageHint")}>
        {(id) => (
          <Template
            id={id}
            field="message"
            values={values}
            rows={4}
            maxLength={4000}
            value={n.text}
            onValueChange={(text) => update({ ...n, text })}
          />
        )}
      </Field>
      <Switch
        size="sm"
        checked={n.onlyIfContent}
        onCheckedChange={(onlyIfContent) => update({ ...n, onlyIfContent })}
        label={t("flow.f.onlyIf")}
        description={t("flow.f.onlyIfHint")}
      />
      <p className="fe-note">
        {dest
          ? dest.owner
            ? t("flow.f.sendsYou", { channel: dest.channel.label })
            : t("flow.f.sendsAs", { to: dest.to, channel: dest.channel.label })
          : t("flow.f.sendsPick")}
      </p>
    </>
  );
}

/** Header lines as people write them, `Name: value`; a line it can't read is kept in the box, not in the step. */
const parseHeaders = (text: string) => {
  const headers: Http["headers"] = [];
  let bad = false;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const m = /^\s*([!#$%&'*+.^_`|~0-9A-Za-z-]{1,100})\s*:\s?(.*)$/.exec(line);
    if (m?.[1] && headers.length < 16) headers.push({ name: m[1], value: (m[2] ?? "").trimEnd() });
    else bad = true;
  }
  return { headers, bad };
};
const headerText = (headers: Http["headers"]) => headers.map((h) => `${h.name}: ${h.value}`).join("\n");

export function HttpFields({ n, update, values }: { n: Http; update: (n: FlowNode) => void; values: Values }) {
  const t = useT();
  const [text, setText] = useState(() => headerText(n.headers));
  // Another step chosen: its own headers.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the step changes, not on each keystroke
  useEffect(() => setText(headerText(n.headers)), [n.id]);
  const { bad } = parseHeaders(text);
  return (
    <>
      <div className="fe-presets">
        <span className="fe-ins__label">{t("flow.f.method")}</span>
        <SegmentedControl
          size="sm"
          label={t("flow.f.method")}
          value={n.method}
          onValueChange={(v) => update({ ...n, method: v as Http["method"] })}
          options={(["GET", "POST", "PUT"] as const).map((m) => ({ value: m, label: m }))}
        />
      </div>
      <Field label={t("flow.f.address")}>
        {(id) => (
          <Input
            id={id}
            value={n.url}
            maxLength={2000}
            className="fe-mono"
            spellCheck={false}
            inputMode="url"
            onChange={(e) => update({ ...n, url: e.target.value })}
          />
        )}
      </Field>
      <Field label={t("flow.f.headers")} hint={bad ? t("flow.f.headersBad") : t("flow.f.headersHint")}>
        {(id) => (
          <Template
            id={id}
            field="header"
            values={values}
            rows={3}
            className="fe-mono"
            spellCheck={false}
            value={text}
            placeholder="Authorization: Bearer secret://name"
            onValueChange={(next) => {
              setText(next);
              update({ ...n, headers: parseHeaders(next).headers });
            }}
          />
        )}
      </Field>
      {n.method !== "GET" && (
        <Field label={t("flow.f.body")} hint={t("flow.f.bodyHint")}>
          {(id) => (
            <Template
              id={id}
              field="body"
              values={values}
              rows={4}
              className="fe-mono"
              spellCheck={false}
              maxLength={16000}
              placeholder="{ }"
              value={n.body}
              onValueChange={(body) => update({ ...n, body })}
            />
          )}
        </Field>
      )}
      <p className="fe-note">
        {t("flow.f.callsNote", { host: /^https?:\/\/[^/\s]+/.test(n.url) ? hostOf(n.url) : "…", step: n.id })}
      </p>
    </>
  );
}
