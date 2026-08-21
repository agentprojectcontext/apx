package dev.agentprojectcontext.apx;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

public final class MapsNavigationListenerService extends NotificationListenerService {
    static final String ACTION_TRAVEL_STATE_CHANGED = "dev.agentprojectcontext.apx.TRAVEL_STATE_CHANGED";
    private static final String TAG = "APXTravel";
    private static final String CHANNEL = "apx_travel_detection";
    private static final int ACTIVE_NOTIFICATION = 7200;
    private static final long REMOVAL_DEBOUNCE_MS = 4_000L;
    private static final long EVENT_DELAY_MS = 8_000L;
    private static final long DESTINATION_SETTLE_MS = 1_000L;

    private ApxPreferences preferences;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable verifyEnded = this::refreshFromActiveNotifications;
    private final Runnable notifyDaemon = () -> {
        if (!preferences.travelActive() || preferences.travelEventSent()) return;
        preferences.setTravelEventSent(true);
        DaemonClient.notifyTripStarted(
            preferences.daemonUrl(),
            preferences.token(),
            preferences.travelTripId(),
            preferences.travelDestination(),
            DeviceLocation.latest(this)
        );
    };

    @Override
    public void onCreate() {
        super.onCreate();
        preferences = new ApxPreferences(this);
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        NotificationChannel channel = new NotificationChannel(
            CHANNEL,
            "Detección de viajes APX",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Confirma cuándo APX detecta navegación activa en Google Maps.");
        manager.createNotificationChannel(channel);
    }

    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        refreshFromActiveNotifications();
    }

    @Override
    public void onNotificationPosted(StatusBarNotification item) {
        if (!matches(item)) return;
        main.removeCallbacks(verifyEnded);
        setTravelActive(true, destination(item));
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification item) {
        if (!MapsNavigationDetector.MAPS_PACKAGE.equals(item.getPackageName())) return;
        main.removeCallbacks(verifyEnded);
        main.postDelayed(verifyEnded, REMOVAL_DEBOUNCE_MS);
    }

    @Override
    public void onListenerDisconnected() {
        main.removeCallbacks(verifyEnded);
        setTravelActive(false, "");
        super.onListenerDisconnected();
    }

    @Override
    public void onDestroy() {
        main.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    private void refreshFromActiveNotifications() {
        StatusBarNotification[] active;
        try {
            active = getActiveNotifications();
        } catch (RuntimeException unavailable) {
            Log.w(TAG, "Could not inspect active notifications", unavailable);
            return;
        }
        if (active != null) {
            for (StatusBarNotification item : active) {
                if (matches(item)) {
                    setTravelActive(true, destination(item));
                    return;
                }
            }
        }
        setTravelActive(false, "");
    }

    private boolean matches(StatusBarNotification item) {
        Notification notification = item.getNotification();
        Bundle extras = notification.extras == null ? Bundle.EMPTY : notification.extras;
        boolean ongoing = (notification.flags & Notification.FLAG_ONGOING_EVENT) != 0;
        boolean match = MapsNavigationDetector.isLikelyNavigation(
            item.getPackageName(),
            notification.category,
            ongoing,
            extras.getCharSequence(Notification.EXTRA_TITLE),
            extras.getCharSequence(Notification.EXTRA_TEXT)
        );
        if (MapsNavigationDetector.MAPS_PACKAGE.equals(item.getPackageName())) {
            Log.i(TAG, "Maps notification observed category=" + notification.category + " ongoing=" + ongoing + " navigation=" + match);
        }
        return match;
    }

    private String destination(StatusBarNotification item) {
        Bundle extras = item.getNotification().extras;
        if (extras == null) return "";
        return MapsNavigationDetector.destinationFrom(
            extras.getCharSequence("android.ongoingActivityNoti.secondaryInfo"),
            extras.getCharSequence("android.ongoingActivityNoti.nowbarSecondaryInfo")
        );
    }

    private void setTravelActive(boolean active, String destination) {
        boolean wasActive = preferences.travelActive();
        String previousDestination = preferences.travelDestination();
        String previousTripId = preferences.travelTripId();
        boolean previousEventSent = preferences.travelEventSent();
        String resolvedDestination = !active
            ? ""
            : destination != null && !destination.isBlank() ? destination : previousDestination;
        if (wasActive == active && previousDestination.equals(resolvedDestination)) return;
        String tripId = active
            ? wasActive && !previousTripId.isBlank() ? previousTripId : java.util.UUID.randomUUID().toString()
            : "";
        preferences.setTravelState(active, resolvedDestination, tripId);
        sendBroadcast(new Intent(ACTION_TRAVEL_STATE_CHANGED).setPackage(getPackageName()));
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (!active) {
            main.removeCallbacks(notifyDaemon);
            manager.cancel(ACTIVE_NOTIFICATION);
            if (previousEventSent && !previousTripId.isBlank()) {
                DaemonClient.notifyTripEnded(preferences.daemonUrl(), preferences.token(), previousTripId);
            }
            Log.i(TAG, "Google Maps navigation ended");
            return;
        }

        Intent open = new Intent(this, MainActivity.class)
            .putExtra(MainActivity.EXTRA_SETTINGS, true);
        android.app.PendingIntent pending = android.app.PendingIntent.getActivity(
            this,
            6,
            open,
            android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE
        );
        Notification notice = new Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_apx_notification)
            .setContentTitle("Viaje detectado")
            .setContentText(resolvedDestination.isBlank()
                ? "APX detectó navegación activa en Google Maps"
                : "En camino a " + resolvedDestination)
            .setContentIntent(pending)
            .setOngoing(true)
            .build();
        manager.notify(ACTIVE_NOTIFICATION, notice);
        if (!wasActive) {
            Log.i(TAG, "Google Maps navigation started");
            preferences.setTravelEventSent(false);
            main.removeCallbacks(notifyDaemon);
            main.postDelayed(notifyDaemon, EVENT_DELAY_MS);
        } else if (!previousDestination.equals(resolvedDestination)) {
            Log.i(TAG, "Google Maps destination resolved");
            if (!preferences.travelEventSent()) {
                main.removeCallbacks(notifyDaemon);
                main.postDelayed(notifyDaemon, DESTINATION_SETTLE_MS);
            }
        }
    }
}
