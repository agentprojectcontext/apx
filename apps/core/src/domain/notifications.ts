// The attention tray's notices. A notice about something (an input, a task) replaces the unread one about the same
// thing, and is marked read once that thing no longer needs the owner.
import type { Notification, NotificationKind } from "@apx/protocol";
import type { Selectable } from "kysely";
import type { Bus } from "../bus.ts";
import type { NotificationsTable } from "../db/schema.ts";
import { newId, now, opt, qb, type Sql } from "./sql.ts";

/** Read notices are dropped after this long. */
const KEEP_READ_MS = 30 * 24 * 3600_000;

const toNotification = (r: Selectable<NotificationsTable>): Notification => ({
  id: r.id,
  kind: r.kind as NotificationKind,
  level: r.level as Notification["level"],
  title: r.title,
  body: r.body,
  ...opt("thread_id", r.thread_id),
  ...opt("ref", r.ref),
  created_at: r.created_at,
  ...opt("read_at", r.read_at),
});

export type NewNotification = {
  kind: NotificationKind;
  level?: Notification["level"];
  title: string;
  body?: string;
  thread_id?: string | undefined;
  ref?: string | undefined;
};

export function notificationsRepo({ one, all, run, tx }: Sql, bus: Bus) {
  const get = (id: string) => {
    const r = one(qb.selectFrom("notifications").selectAll().where("id", "=", id));
    return r ? toNotification(r) : undefined;
  };
  const emit = (id: string) => {
    const n = get(id);
    if (n) bus.emit({ type: "notification.updated", notification: n });
  };
  const unreadIds = (q = qb.selectFrom("notifications").select("id").where("read_at", "is", null)) =>
    all(q).map((r) => r.id);
  const markRead = (ids: string[]) => {
    if (!ids.length) return;
    run(qb.updateTable("notifications").set({ read_at: now() }).where("id", "in", ids));
    for (const id of ids) emit(id);
  };

  return {
    get,
    add(n: NewNotification): Notification {
      const at = now();
      const id = tx(() => {
        run(qb.deleteFrom("notifications").where("read_at", "<", new Date(Date.now() - KEEP_READ_MS).toISOString()));
        const same = n.ref
          ? one(
              qb
                .selectFrom("notifications")
                .select("id")
                .where("kind", "=", n.kind)
                .where("ref", "=", n.ref)
                .where("read_at", "is", null),
            )
          : undefined;
        const fields = {
          level: n.level ?? "info",
          title: n.title,
          body: n.body ?? "",
          thread_id: n.thread_id ?? null,
          created_at: at,
        };
        if (same) {
          run(qb.updateTable("notifications").set(fields).where("id", "=", same.id));
          return same.id;
        }
        const fresh = newId("ntf");
        run(qb.insertInto("notifications").values({ id: fresh, kind: n.kind, ref: n.ref ?? null, ...fields }));
        return fresh;
      });
      emit(id);
      return get(id) as Notification;
    },
    list(o: { unreadOnly: boolean; limit: number }): Notification[] {
      let q = qb.selectFrom("notifications").selectAll();
      if (o.unreadOnly) q = q.where("read_at", "is", null);
      return all(q.orderBy("created_at", "desc").limit(o.limit)).map(toNotification);
    },
    unread(): number {
      return Number(
        one(
          qb
            .selectFrom("notifications")
            .select((eb) => eb.fn.countAll().as("n"))
            .where("read_at", "is", null),
        )?.n ?? 0,
      );
    },
    /** Marks these (or every unread notice) read. */
    read(ids?: string[]): void {
      markRead(ids ?? unreadIds());
    },
    /** The thing a notice is about no longer needs the owner (answered, moved on). */
    resolve(kind: NotificationKind, ref: string): void {
      markRead(
        unreadIds(
          qb
            .selectFrom("notifications")
            .select("id")
            .where("kind", "=", kind)
            .where("ref", "=", ref)
            .where("read_at", "is", null),
        ),
      );
    },
    /** The owner opened the conversation: its news is seen (a pending question stays until answered). */
    readThread(threadId: string): void {
      markRead(
        unreadIds(
          qb
            .selectFrom("notifications")
            .select("id")
            .where("thread_id", "=", threadId)
            .where("kind", "!=", "input")
            .where("read_at", "is", null),
        ),
      );
    },
  };
}
