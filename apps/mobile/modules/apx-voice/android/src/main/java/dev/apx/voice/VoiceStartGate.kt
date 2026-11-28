package dev.apx.voice

/** Serializes cancellation with short side effects; network waits must stay outside the gate. */
internal class VoiceStartGate {
  data class Ticket internal constructor(val generation: Long, val wakeGeneration: Long?)
  private var generation = 0L
  private var wakeGeneration = 0L
  private var closed = false

  @Synchronized fun ticket(wake: Boolean = false): Ticket =
    Ticket(generation, if (wake) wakeGeneration else null)

  @Synchronized fun valid(ticket: Ticket): Boolean = !closed && ticket.generation == generation &&
    (ticket.wakeGeneration == null || ticket.wakeGeneration == wakeGeneration)

  @Synchronized fun run(ticket: Ticket, action: () -> Unit): Boolean {
    if (!valid(ticket)) return false
    action()
    return true
  }

  @Synchronized fun cancelWake() { wakeGeneration++ }
  @Synchronized fun cancel() { generation++ }
  @Synchronized fun close() { closed = true; generation++ }
}
