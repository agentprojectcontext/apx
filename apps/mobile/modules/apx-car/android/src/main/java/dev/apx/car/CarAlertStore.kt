package dev.apx.car

/**
 * The offers waiting for an answer, shared by the location service, the phone's notifications and the car app (one
 * process). Bounded: a car screen is read at speed, and past a handful nobody is choosing.
 */
object CarAlertStore {
  private const val MAX = 5
  private val alerts = LinkedHashMap<String, CarAlert>()
  private val listeners = mutableListOf<(added: List<CarAlert>) -> Unit>()

  /** New offers (from a position) or the core's current list (from car.trip, `quiet`: no car alert pops up). */
  fun put(incoming: List<CarAlert>, quiet: Boolean = false): List<CarAlert> {
    val added = mutableListOf<CarAlert>()
    synchronized(this) {
      for (alert in incoming) {
        if (alert.answered) continue
        if (!alerts.containsKey(alert.id)) added += alert
        alerts.remove(alert.id)
        alerts[alert.id] = alert
      }
      while (alerts.size > MAX) alerts.remove(alerts.keys.first())
    }
    notifyListeners(if (quiet) emptyList() else added)
    return added
  }

  fun remove(id: String) {
    val removed = synchronized(this) { alerts.remove(id) != null }
    if (removed) notifyListeners(emptyList())
  }

  fun clear() {
    val had = synchronized(this) { alerts.isNotEmpty().also { alerts.clear() } }
    if (had) notifyListeners(emptyList())
  }

  /** Newest first. */
  fun all(): List<CarAlert> = synchronized(this) { alerts.values.reversed() }

  fun get(id: String): CarAlert? = synchronized(this) { alerts[id] }

  fun latest(): CarAlert? = synchronized(this) { alerts.values.lastOrNull() }

  fun addListener(listener: (List<CarAlert>) -> Unit) {
    synchronized(listeners) { listeners.add(listener) }
  }

  fun removeListener(listener: (List<CarAlert>) -> Unit) {
    synchronized(listeners) { listeners.remove(listener) }
  }

  private fun notifyListeners(added: List<CarAlert>) {
    val current = synchronized(listeners) { listeners.toList() }
    for (listener in current) {
      try {
        listener(added)
      } catch (_: RuntimeException) {
        // A screen that went away must not stop the next one from being told.
      }
    }
  }
}
