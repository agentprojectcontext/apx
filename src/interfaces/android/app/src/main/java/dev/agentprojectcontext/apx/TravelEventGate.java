package dev.agentprojectcontext.apx;

import java.util.Locale;

final class TravelEventGate {
    static final long KNOWN_DESTINATION_SETTLE_MS = 45_000L;

    /**
     * How long to wait before telling the daemon about a trip whose destination
     * Maps has not published.
     *
     * WAS TEN MINUTES, and that was protecting the wrong thing. The long wait
     * was there so a destination arriving late would be used instead of firing
     * a "where are you going?" on a trip that was about to name itself — but
     * MapsNavigationListenerService already handles that case directly: when
     * the destination resolves it calls scheduleDaemonNotification(..., true),
     * which REPLACES the pending notification with a 45 s known-destination
     * one. The long settle never had to catch it.
     *
     * So on the case it actually governs — a drive with no route set, which is
     * most short local ones — ten minutes was pure delay, and the trip-start
     * message landed when the drive was half over. Three minutes still absorbs
     * Maps posting and removing its notification while a route is being set up
     * (the removal debounce covers the rest), and leaves the message useful.
     *
     * It does NOT gate proximity alerts. The state-only event and the GPS
     * service start the moment navigation is detected — see the class comment
     * in MapsNavigationListenerService and the rule in rules/android.md.
     */
    static final long UNKNOWN_DESTINATION_SETTLE_MS = 3 * 60_000L;
    static final long DIFFERENT_DESTINATION_COOLDOWN_MS = 5 * 60_000L;
    static final long SAME_DESTINATION_COOLDOWN_MS = 30 * 60_000L;

    private TravelEventGate() {}

    static long delayMs(long now, String destination, long lastSentAt, String lastDestination) {
        String normalized = normalize(destination);
        long settle = normalized.isBlank()
            ? UNKNOWN_DESTINATION_SETTLE_MS
            : KNOWN_DESTINATION_SETTLE_MS;
        if (lastSentAt <= 0L) return settle;

        long cooldown = normalized.equals(normalize(lastDestination))
            ? SAME_DESTINATION_COOLDOWN_MS
            : DIFFERENT_DESTINATION_COOLDOWN_MS;
        long remaining = Math.max(0L, lastSentAt + cooldown - now);
        return Math.max(settle, remaining);
    }

    static boolean coolingDown(long now, String destination, long lastSentAt, String lastDestination) {
        if (lastSentAt <= 0L) return false;
        String normalized = normalize(destination);
        long cooldown = normalized.equals(normalize(lastDestination))
            ? SAME_DESTINATION_COOLDOWN_MS
            : DIFFERENT_DESTINATION_COOLDOWN_MS;
        return now < lastSentAt + cooldown;
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }
}
