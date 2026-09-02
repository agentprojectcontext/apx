package dev.agentprojectcontext.apx;

import java.text.Normalizer;
import java.util.Locale;

/**
 * Recognises "the phone is projecting to Android Auto right now" from the
 * notification Android Auto itself posts while a session is live.
 *
 * Why the notification and not the Car App Library: CarConnection would mean
 * pulling androidx.car.app in for one boolean, and its content provider is
 * only queryable by apps the Auto host already knows about. APX is not a car
 * app — it is a phone app that wants to know the owner is driving — and it
 * ALREADY holds notification-listener access for the Google Maps trip
 * detector next door. One permission, two signals.
 *
 * The distinction that matters and is easy to get wrong: Android Auto posts
 * notifications when it is NOT running too ("tap to set up", "Android Auto is
 * available", update prompts). Those are invitations, not sessions. Treating
 * one as a connection would put APX in a trip while the phone sits on a desk,
 * so a match needs an ongoing notification whose text reads like a running
 * session rather than an offer to start one.
 */
final class AndroidAutoDetector {
    static final String AUTO_PACKAGE = "com.google.android.projection.gearhead";

    // A live session says it is running / connected / driving.
    private static final String[] RUNNING_TERMS = {
        "en ejecucion", "ejecutando", "esta corriendo", "conectado", "conectada",
        "modo conduccion", "modo de conduccion", "en el auto", "en el coche",
        "is running", "running", "connected", "driving mode", "in car", "car mode",
    };

    // An invitation says: do something to make a session happen.
    private static final String[] OFFER_TERMS = {
        "toca para", "tocar para", "presiona", "configur", "instal", "actualiz",
        "disponible", "prueba", "conecta tu", "conecta el",
        "tap to", "set up", "setup", "install", "update", "available", "try ",
        "connect your",
    };

    // Developer mode posts its own persistent notification while the head unit
    // SERVER is listening — "Programador de Android Auto · Servidor de unidad
    // principal en ejecución". A server waiting for a head unit is not a car,
    // and on a phone with developer mode left on it would otherwise hold APX
    // in a permanent trip. Found on a real device while testing against the
    // Desktop Head Unit, which is exactly when that notification exists.
    private static final String[] DEVELOPER_TERMS = {
        "programador", "developer", "servidor de unidad principal", "head unit server",
    };

    private AndroidAutoDetector() {}

    /** Every notification this app must inspect for a projection session. */
    static boolean isAutoPackage(String packageName) {
        return AUTO_PACKAGE.equals(packageName);
    }

    /**
     * True when this notification is Android Auto reporting a LIVE projection
     * session. An offer to set Auto up is never a session, no matter how it is
     * worded, so the offer check wins over the running check.
     *
     * `persistent` must be computed from BOTH FLAG_ONGOING_EVENT and
     * FLAG_FOREGROUND_SERVICE. A real session on a Galaxy A55 posts
     * "Android Auto · Conectado al vehículo" with flags NO_CLEAR |
     * FOREGROUND_SERVICE and no ONGOING_EVENT at all: gating on the ongoing
     * flag alone silently detected nothing, on the one signal this feature
     * exists for. A foreground-service notification is the stronger claim of
     * the two anyway — a service is actually running behind it.
     */
    static boolean isProjectionActive(
        String packageName,
        boolean persistent,
        CharSequence title,
        CharSequence text
    ) {
        if (!isAutoPackage(packageName)) return false;
        // A session notification cannot be swiped away while the car screen is
        // up. An announcement can.
        if (!persistent) return false;

        String content = normalize(String.valueOf(title) + " " + String.valueOf(text));
        if (containsAny(content, DEVELOPER_TERMS)) return false;
        if (containsAny(content, OFFER_TERMS)) return false;
        if (containsAny(content, RUNNING_TERMS)) return true;
        // Android Auto localises this notification into languages this list
        // does not cover, and an ongoing notification from the projection app
        // that is not an offer is a session in every one of them. Falling back
        // to "yes" here is deliberate: the alternative is a driver whose phone
        // never notices the car it is plugged into.
        return true;
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
