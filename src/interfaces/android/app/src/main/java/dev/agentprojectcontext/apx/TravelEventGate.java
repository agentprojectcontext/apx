package dev.agentprojectcontext.apx;

import java.util.Locale;

final class TravelEventGate {
    static final long KNOWN_DESTINATION_SETTLE_MS = 45_000L;
    static final long UNKNOWN_DESTINATION_SETTLE_MS = 10 * 60_000L;
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
