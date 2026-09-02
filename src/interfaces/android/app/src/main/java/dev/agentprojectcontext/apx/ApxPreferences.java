package dev.agentprojectcontext.apx;

import android.content.Context;
import android.content.SharedPreferences;

final class ApxPreferences {
    static final String SOURCE_MAPS = "maps";
    static final String SOURCE_ANDROID_AUTO = "android_auto";

    private static final String NAME = "apx_android";
    private static final String URL = "daemon_url";
    private static final String TOKEN = "client_token";
    private static final String MASCOT = "mascot_enabled";
    private static final String SOUND = "message_sound_enabled";
    private static final String MASCOT_AVATAR = "mascot_avatar";
    private static final String TRAVEL_ACTIVE = "maps_travel_active";
    private static final String TRAVEL_CHANGED_AT = "maps_travel_changed_at";
    private static final String TRAVEL_DESTINATION = "maps_travel_destination";
    private static final String TRAVEL_TRIP_ID = "maps_travel_trip_id";
    private static final String TRAVEL_SOURCE = "maps_travel_source";
    private static final String TRAVEL_EVENT_SENT = "maps_travel_event_sent";
    private static final String TRAVEL_LAST_SENT_AT = "maps_travel_last_sent_at";
    private static final String TRAVEL_LAST_SENT_DESTINATION = "maps_travel_last_sent_destination";
    private static final String X = "mascot_x";
    private static final String Y = "mascot_y";

    private final SharedPreferences prefs;

    ApxPreferences(Context context) {
        prefs = context.getSharedPreferences(NAME, Context.MODE_PRIVATE);
    }

    String daemonUrl() { return prefs.getString(URL, ""); }
    String token() { return prefs.getString(TOKEN, ""); }
    boolean paired() { return !daemonUrl().isBlank() && !token().isBlank(); }
    boolean mascotEnabled() { return prefs.getBoolean(MASCOT, true); }
    boolean soundEnabled() { return prefs.getBoolean(SOUND, true); }
    String mascotAvatar() { return prefs.getString(MASCOT_AVATAR, MascotBlobCatalog.DEFAULT_KEY); }
    boolean travelActive() { return prefs.getBoolean(TRAVEL_ACTIVE, false); }
    long travelChangedAt() { return prefs.getLong(TRAVEL_CHANGED_AT, 0L); }
    String travelDestination() { return prefs.getString(TRAVEL_DESTINATION, ""); }
    String travelTripId() { return prefs.getString(TRAVEL_TRIP_ID, ""); }
    /**
     * What put APX in a trip: {@link #SOURCE_MAPS} (a Google Maps route) or
     * {@link #SOURCE_ANDROID_AUTO} (the phone is projecting to a head unit).
     * The two arrive independently and end independently — a route can finish
     * while the car is still connected, and Auto can disconnect mid-route — so
     * the trip only ends when NEITHER is live.
     */
    String travelSource() { return prefs.getString(TRAVEL_SOURCE, ""); }
    boolean travelEventSent() { return prefs.getBoolean(TRAVEL_EVENT_SENT, false); }
    long travelLastSentAt() {
        return prefs.getLong(
            TRAVEL_LAST_SENT_AT,
            travelEventSent() ? travelChangedAt() : 0L
        );
    }
    String travelLastSentDestination() {
        return prefs.getString(
            TRAVEL_LAST_SENT_DESTINATION,
            travelEventSent() ? travelDestination() : ""
        );
    }
    int mascotX(int fallback) { return prefs.getInt(X, fallback); }
    int mascotY(int fallback) { return prefs.getInt(Y, fallback); }

    void savePairing(String url, String token) {
        prefs.edit().putString(URL, url).putString(TOKEN, token).apply();
    }

    void clearPairing() {
        prefs.edit().remove(URL).remove(TOKEN).apply();
    }

    void setMascotEnabled(boolean enabled) {
        prefs.edit().putBoolean(MASCOT, enabled).apply();
    }

    void setSoundEnabled(boolean enabled) {
        prefs.edit().putBoolean(SOUND, enabled).apply();
    }

    void setMascotAvatar(String key) {
        prefs.edit().putString(MASCOT_AVATAR, MascotBlobCatalog.forKey(key).key).apply();
    }

    /** Keeps whatever source is already recorded (voice destination replies). */
    void setTravelState(boolean active, String destination, String tripId) {
        setTravelState(active, destination, tripId, travelSource());
    }

    void setTravelState(boolean active, String destination, String tripId, String source) {
        prefs.edit()
            .putBoolean(TRAVEL_ACTIVE, active)
            .putLong(TRAVEL_CHANGED_AT, System.currentTimeMillis())
            .putString(TRAVEL_DESTINATION, active && destination != null ? destination : "")
            .putString(TRAVEL_TRIP_ID, active && tripId != null ? tripId : "")
            .putString(TRAVEL_SOURCE, active && source != null ? source : "")
            .putBoolean(TRAVEL_EVENT_SENT, active && travelEventSent())
            .apply();
    }

    void setTravelEventSent(boolean sent) {
        prefs.edit().putBoolean(TRAVEL_EVENT_SENT, sent).apply();
    }

    void recordTravelEventSent(String destination) {
        prefs.edit()
            .putBoolean(TRAVEL_EVENT_SENT, true)
            .putLong(TRAVEL_LAST_SENT_AT, System.currentTimeMillis())
            .putString(TRAVEL_LAST_SENT_DESTINATION, destination == null ? "" : destination.trim())
            .apply();
    }

    void saveMascotPosition(int x, int y) {
        prefs.edit().putInt(X, x).putInt(Y, y).apply();
    }
}
