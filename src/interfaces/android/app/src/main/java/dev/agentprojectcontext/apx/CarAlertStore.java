package dev.agentprojectcontext.apx;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The alerts the head unit should be showing, right now.
 *
 * A process-wide holder rather than a bound service, because both ends already
 * live in this process: MascotOverlayService owns the socket to the daemon and
 * the car app is started by Android Auto in the same app. Binding them would
 * add a lifecycle to synchronise for no data that is not already here.
 *
 * BOUNDED AND KEYED BY ALERT ID. Two errands can come into range on one GPS
 * sample and both are real, but a car screen is read at 110 km/h — past a
 * handful nobody is choosing, and an unbounded list would grow for the whole
 * drive because the car app has no reason to ever forget on its own.
 *
 * Answering removes the alert here as well as on the daemon: the head unit must
 * not still be offering "Navegar ahora" for a place the driver already answered
 * about on the phone.
 */
final class CarAlertStore {
    /** What a head-unit screen can usefully offer at a glance. */
    private static final int MAX_ALERTS = 5;

    private static final Map<String, MessageFrameParser.MobilityAlert> alerts = new LinkedHashMap<>();
    private static final List<Runnable> listeners = new ArrayList<>();

    private CarAlertStore() {}

    static synchronized void put(MessageFrameParser.MobilityAlert alert) {
        if (alert == null) return;
        alerts.remove(alert.id());          // re-insert so the newest is last
        alerts.put(alert.id(), alert);
        while (alerts.size() > MAX_ALERTS) {
            alerts.remove(alerts.keySet().iterator().next());
        }
        notifyListeners();
    }

    static synchronized void remove(String alertId) {
        if (alertId != null && alerts.remove(alertId) != null) notifyListeners();
    }

    static synchronized void clear() {
        if (alerts.isEmpty()) return;
        alerts.clear();
        notifyListeners();
    }

    /** Newest last — the same order the driver was told about them. */
    static synchronized List<MessageFrameParser.MobilityAlert> all() {
        return new ArrayList<>(alerts.values());
    }

    static synchronized MessageFrameParser.MobilityAlert get(String alertId) {
        return alertId == null ? null : alerts.get(alertId);
    }

    /**
     * Called whenever the set changes, so an open car screen can invalidate.
     * Listeners are held for the life of the screen and removed by it.
     */
    static synchronized void addListener(Runnable listener) {
        if (listener != null && !listeners.contains(listener)) listeners.add(listener);
    }

    static synchronized void removeListener(Runnable listener) {
        listeners.remove(listener);
    }

    private static void notifyListeners() {
        for (Runnable listener : new ArrayList<>(listeners)) {
            try {
                listener.run();
            } catch (Exception ignored) {
                // A screen that has gone away must not stop the next one being told.
            }
        }
    }
}
