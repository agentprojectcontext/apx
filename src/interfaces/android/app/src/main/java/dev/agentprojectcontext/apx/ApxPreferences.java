package dev.agentprojectcontext.apx;

import android.content.Context;
import android.content.SharedPreferences;

final class ApxPreferences {
    private static final String NAME = "apx_android";
    private static final String URL = "daemon_url";
    private static final String TOKEN = "client_token";
    private static final String MASCOT = "mascot_enabled";
    private static final String SOUND = "message_sound_enabled";
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

    void saveMascotPosition(int x, int y) {
        prefs.edit().putInt(X, x).putInt(Y, y).apply();
    }
}
