// The delivery grace sweep — the "notify unless he reads it first" timer.
//
// An ORDINARY (non-priority) delivery is not pinged at the moment it is created.
// It sits `pending` for a short grace window so Manu can open the agent's chat
// and reply — which marks it `answered` and cancels the notify (answerDeliveries,
// wired into the agent-chat endpoint). If the window passes and it is still
// pending, this sweep has Roby tell him.
//
// Priority/anchor deliveries do NOT come through here — the runner notifies those
// immediately. This is only the deferred half.
//
// Cheap by construction: it wakes on a plain interval, and a tick with nothing
// past its grace does no work and touches no model. A held send (quiet-hours,
// budget) is LEFT pending so a later tick retries once the budget allows —
// canNudge holds it before composing, so a retry costs nothing until it lands.
import { listDeliveries, markDelivery, DELIVERY_STATUS } from "#core/stores/deliveries.js";
import { notifyOwnerViaRoby } from "#core/routines/delivery.js";

const GRACE_MS = 60_000; // time to read/answer before Roby pings (ordinary only)
const SWEEP_MS = 30_000; // how often the daemon checks the queue

export function startDeliverySweep({ projects, plugins, registries, config } = {}) {
  async function tick() {
    const now = Date.now();
    for (const entry of projects?.list?.() || []) {
      let p;
      try { p = projects.get(entry.id); } catch { continue; }
      if (!p?.storagePath) continue;

      const due = listDeliveries(p.storagePath, { status: DELIVERY_STATUS.PENDING }).filter(
        (d) => d.priority !== true && d.created_at && now - Date.parse(d.created_at) >= GRACE_MS,
      );
      if (!due.length) continue;

      const globalConfig = p.config || config || {};
      const ctx = { project: p, plugins, registries, globalConfig };
      for (const d of due) {
        const gate = { severity: "normal", scheduled: false, unsolicited: true, project_id: entry.id };
        try {
          const r = await notifyOwnerViaRoby(ctx, {
            routine: { name: d.routine || "delivery", id: d.routine_id || "" },
            agent: { slug: d.agent, name: d.agent_name },
            text: d.notify,
            notify: d.notify,
            gate,
          });
          if (r?.sent) markDelivery(p.storagePath, d.id, DELIVERY_STATUS.NOTIFIED, { channel: "telegram" });
          // held / skipped → leave it pending; a later tick retries when the
          // budget allows or the telegram plugin comes back.
        } catch { /* best-effort — the delivery stays pending and is retried */ }
      }
    }
  }

  const timer = setInterval(() => { tick().catch(() => {}); }, SWEEP_MS);
  timer.unref?.();
  return function stop() { clearInterval(timer); };
}
