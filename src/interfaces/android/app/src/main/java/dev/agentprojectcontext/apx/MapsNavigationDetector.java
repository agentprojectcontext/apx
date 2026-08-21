package dev.agentprojectcontext.apx;

import java.text.Normalizer;
import java.util.Locale;

final class MapsNavigationDetector {
    static final String MAPS_PACKAGE = "com.google.android.apps.maps";

    private MapsNavigationDetector() {}

    static boolean isLikelyNavigation(
        String packageName,
        String category,
        boolean ongoing,
        CharSequence title,
        CharSequence text
    ) {
        if (!MAPS_PACKAGE.equals(packageName) || !ongoing) return false;
        if ("navigation".equals(category)) return true;

        String content = normalize(String.valueOf(title) + " " + String.valueOf(text));
        return containsAny(content,
            "naveg", "gira", "continua", "salida", "llegada", "destino",
            "turn", "continue", "exit", "arrival", "destination",
            " km", " min"
        );
    }

    static String destinationFrom(CharSequence... candidates) {
        for (CharSequence candidate : candidates) {
            if (candidate == null) continue;
            String raw = candidate.toString().trim();
            if (raw.isBlank()) continue;
            String normalized = normalize(raw);
            String[] prefixes = {
                "en direccion a ", "en camino a ", "hacia ",
                "heading to ", "on the way to ", "toward ", "towards "
            };
            for (String prefix : prefixes) {
                if (!normalized.startsWith(prefix)) continue;
                int words = prefix.trim().split("\\s+").length;
                String[] originalWords = raw.split("\\s+");
                if (originalWords.length <= words) continue;
                String destination = String.join(" ", java.util.Arrays.copyOfRange(originalWords, words, originalWords.length)).trim();
                return destination.length() <= 120 ? destination : destination.substring(0, 120).trim();
            }
        }
        return "";
    }

    private static boolean containsAny(String value, String... needles) {
        for (String needle : needles) {
            if (value.contains(needle)) return true;
        }
        return false;
    }

    private static String normalize(String value) {
        String lower = value.toLowerCase(Locale.ROOT);
        return Normalizer.normalize(lower, Normalizer.Form.NFD).replaceAll("\\p{M}+", "");
    }
}
