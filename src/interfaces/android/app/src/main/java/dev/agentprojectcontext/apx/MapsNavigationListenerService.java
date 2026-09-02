package dev.agentprojectcontext.apx;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import java.util.Locale;

public final class MapsNavigationListenerService extends NotificationListenerService {
    static final String ACTION_TRAVEL_STATE_CHANGED = "dev.agentprojectcontext.apx.TRAVEL_STATE_CHANGED";
    private static final String TAG = "APXTravel";
    private static final String CHANNEL = "apx_travel_detection";
    private static final int ACTIVE_NOTIFICATION = 7200;
    private static final long REMOVAL_DEBOUNCE_MS = 4_000L;
    private static final long ROUTE_POLL_INTERVAL_MS = 3_000L;
    // Maps can leave its foreground navigation notification alive after the
    // route is cancelled in Android Auto. Treat a notification that stopped
    // producing updates as stale instead of keeping APX in a trip forever.
    private static final long NAVIGATION_SIGNAL_TIMEOUT_MS = 120_000L;

    private ApxPreferences preferences;
    private long lastNavigationSignalElapsedMs;
    private boolean daemonNotificationPending;
    // The two independent reasons APX believes the owner is driving. They
    // start and stop on their own schedules — a route can finish with the
    // phone still docked, and the cable can come out mid-route — so the trip
    // only ends when both are false.
    private boolean mapsNavigating;
    private boolean autoConnected;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable verifyEnded = this::refreshFromActiveNotifications;
    private final Runnable verifySignalFreshness = () -> {
        if (lastNavigationSignalElapsedMs == 0L) return;
        long age = SystemClock.elapsedRealtime() - lastNavigationSignalElapsedMs;
        if (age >= NAVIGATION_SIGNAL_TIMEOUT_MS) {
            Log.i(TAG, "Google Maps navigation signal became stale");
            lastNavigationSignalElapsedMs = 0L;
            setTravelActive(false, "");
            return;
        }
        scheduleFreshnessCheck(NAVIGATION_SIGNAL_TIMEOUT_MS - age);
    };
    private final Runnable notifyDaemon = () -> {
        daemonNotificationPending = false;
        if (!preferences.travelActive()
            || preferences.travelEventSent()) return;
        String destination = preferences.travelDestination();
        long now = System.currentTimeMillis();
        if (TravelEventGate.coolingDown(
            now,
            destination,
            preferences.travelLastSentAt(),
            preferences.travelLastSentDestination()
        )) {
            scheduleDaemonNotification(notificationDelay(destination), true);
            Log.i(TAG, "Mobility event suppressed by cooldown");
            return;
        }
        preferences.recordTravelEventSent(destination);
        DaemonClient.notifyTripStarted(
            preferences.daemonUrl(),
            preferences.token(),
            preferences.travelTripId(),
            preferences.travelDestination(),
            DeviceLocation.latest(this)
        );
        if (destination.isBlank()) {
            CarMessageNotification.showDestinationRequest(this);
        }
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
        if (AndroidAutoDetector.isAutoPackage(item.getPackageName())) {
            // Android Auto replaces its own notification as the session
            // changes state, so a single posted notification is never enough
            // to conclude it disconnected — re-read what is actually on screen.
            refreshFromActiveNotifications();
            return;
        }
        if (!matchesActiveRoute(item)) {
            if (MapsNavigationDetector.MAPS_PACKAGE.equals(item.getPackageName())
                && preferences.travelActive()) {
                main.removeCallbacks(verifyEnded);
                main.postDelayed(verifyEnded, REMOVAL_DEBOUNCE_MS);
            }
            return;
        }
        main.removeCallbacks(verifyEnded);
        lastNavigationSignalElapsedMs = SystemClock.elapsedRealtime();
        scheduleFreshnessCheck(NAVIGATION_SIGNAL_TIMEOUT_MS);
        observeNavigation(destination(item));
        scheduleRoutePoll();
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification item) {
        boolean auto = AndroidAutoDetector.isAutoPackage(item.getPackageName());
        if (!auto && !MapsNavigationDetector.MAPS_PACKAGE.equals(item.getPackageName())) return;
        main.removeCallbacks(verifyEnded);
        main.postDelayed(verifyEnded, REMOVAL_DEBOUNCE_MS);
    }

    @Override
    public void onListenerDisconnected() {
        main.removeCallbacks(verifyEnded);
        main.removeCallbacks(verifySignalFreshness);
        lastNavigationSignalElapsedMs = 0L;
        mapsNavigating = false;
        autoConnected = false;
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
        StatusBarNotification route = null;
        long routeAgeMs = 0L;
        boolean projecting = false;
        if (active != null) {
            for (StatusBarNotification item : active) {
                if (matchesProjection(item)) {
                    projecting = true;
                    continue;
                }
                if (route != null || !matchesActiveRoute(item)) continue;
                long age = Math.max(0L, System.currentTimeMillis() - item.getPostTime());
                if (age >= NAVIGATION_SIGNAL_TIMEOUT_MS) continue;
                route = item;
                routeAgeMs = age;
            }
        }
        // Order matters: record the car BEFORE deciding what to do about the
        // route, so a route that just ended can hand the trip over to Android
        // Auto instead of closing a drive that is still happening.
        observeProjection(projecting);
        if (route != null) {
            lastNavigationSignalElapsedMs = SystemClock.elapsedRealtime() - routeAgeMs;
            scheduleFreshnessCheck(NAVIGATION_SIGNAL_TIMEOUT_MS - routeAgeMs);
            observeNavigation(destination(route));
            scheduleRoutePoll();
            return;
        }
        endMapsNavigation();
    }

    private boolean matchesProjection(StatusBarNotification item) {
        Notification notification = item.getNotification();
        Bundle extras = notification.extras == null ? Bundle.EMPTY : notification.extras;
        // Either flag counts — see isProjectionActive: the real session
        // notification carries FOREGROUND_SERVICE without ONGOING_EVENT.
        int persistentFlags = Notification.FLAG_ONGOING_EVENT | Notification.FLAG_FOREGROUND_SERVICE;
        return AndroidAutoDetector.isProjectionActive(
            item.getPackageName(),
            (notification.flags & persistentFlags) != 0,
            extras.getCharSequence(Notification.EXTRA_TITLE),
            extras.getCharSequence(Notification.EXTRA_TEXT)
        );
    }

    /**
     * The car came or went. Connecting opens a trip on its own — the owner is
     * driving whether or not they asked Maps for a route — and disconnecting
     * closes one only when no route is still running.
     */
    private void observeProjection(boolean projecting) {
        if (autoConnected == projecting) return;
        autoConnected = projecting;
        if (projecting) {
            Log.i(TAG, "Android Auto session detected");
            if (!preferences.travelActive()) setTravelActive(true, "", ApxPreferences.SOURCE_ANDROID_AUTO);
            return;
        }
        Log.i(TAG, "Android Auto session ended");
        if (!mapsNavigating) setTravelActive(false, "");
    }

    /**
     * Maps has no active route any more. That ends the trip only when the
     * phone is not still plugged into the car; otherwise the same drive
     * continues under the other source, keeping its trip id so the daemon
     * does not see two journeys where there was one.
     */
    private void endMapsNavigation() {
        boolean wasNavigating = mapsNavigating;
        mapsNavigating = false;
        if (autoConnected && preferences.travelActive()) {
            // Only when a route was actually running: this runs on every poll,
            // and re-announcing a hand-over that already happened turns the
            // log into noise exactly where it needs to be readable.
            if (!wasNavigating || ApxPreferences.SOURCE_ANDROID_AUTO.equals(preferences.travelSource())) return;
            preferences.setTravelState(
                true,
                preferences.travelDestination(),
                preferences.travelTripId(),
                ApxPreferences.SOURCE_ANDROID_AUTO
            );
            Log.i(TAG, "Maps route ended; the Android Auto session keeps the trip open");
            return;
        }
        setTravelActive(false, "");
    }

    private void scheduleFreshnessCheck(long delayMs) {
        main.removeCallbacks(verifySignalFreshness);
        main.postDelayed(verifySignalFreshness, Math.max(1L, delayMs));
    }

    private void scheduleRoutePoll() {
        main.removeCallbacks(verifyEnded);
        main.postDelayed(verifyEnded, ROUTE_POLL_INTERVAL_MS);
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

    private boolean matchesActiveRoute(StatusBarNotification item) {
        if (!matches(item)) return false;
        Notification notification = item.getNotification();
        Bundle extras = notification.extras == null ? Bundle.EMPTY : notification.extras;
        String template = extras.getString(Notification.EXTRA_TEMPLATE, "");
        if (template.endsWith("ProgressStyle")) return true;
        if (!destination(item).isBlank()) return true;
        if (notification.actions == null) return false;
        for (Notification.Action action : notification.actions) {
            String label = action.title == null
                ? ""
                : action.title.toString().toLowerCase(Locale.ROOT);
            boolean navigation = label.contains("naveg") || label.contains("navigation");
            boolean exit = label.contains("salir") || label.contains("detener")
                || label.contains("finalizar") || label.contains("exit")
                || label.contains("stop") || label.contains("end")
                || label.contains("cancel");
            if (navigation && exit) return true;
        }
        Log.i(TAG, "Ignoring stale Maps navigation shell without active-route controls");
        return false;
    }

    private String destination(StatusBarNotification item) {
        Bundle extras = item.getNotification().extras;
        if (extras == null) return "";
        return MapsNavigationDetector.destinationFrom(
            extras.getCharSequence("android.ongoingActivityNoti.secondaryInfo"),
            extras.getCharSequence("android.ongoingActivityNoti.nowbarSecondaryInfo")
        );
    }

    private void observeNavigation(String destination) {
        mapsNavigating = true;
        if (destination == null || destination.isBlank()) {
            if (!preferences.travelActive()) {
                setTravelActive(true, "", ApxPreferences.SOURCE_MAPS);
            } else if (preferences.travelDestination().isBlank() && !preferences.travelEventSent()) {
                scheduleDaemonNotification(notificationDelay(""), false);
            }
            Log.i(TAG, "Google Maps navigation active; sharing location without inventing destination");
            return;
        }
        setTravelActive(true, destination, ApxPreferences.SOURCE_MAPS);
    }

    /** Ending a trip has no source; starting one always does. */
    private void setTravelActive(boolean active, String destination) {
        setTravelActive(active, destination, active ? ApxPreferences.SOURCE_MAPS : "");
    }

    private void setTravelActive(boolean active, String destination, String source) {
        boolean wasActive = preferences.travelActive();
        String previousDestination = preferences.travelDestination();
        String previousTripId = preferences.travelTripId();
        boolean previousEventSent = preferences.travelEventSent();
        String resolvedDestination = !active ? "" : destination == null ? "" : destination.trim();
        if (wasActive == active && previousDestination.equals(resolvedDestination)) return;
        boolean routeChanged = wasActive
            && !previousDestination.isBlank()
            && !previousDestination.equals(resolvedDestination);
        boolean destinationResolved = wasActive
            && previousDestination.isBlank()
            && !resolvedDestination.isBlank();
        String tripId = active
            ? wasActive && !routeChanged && !previousTripId.isBlank()
                ? previousTripId
                : java.util.UUID.randomUUID().toString()
            : "";
        preferences.setTravelState(active, resolvedDestination, tripId, source);
        // GPS follows the trip, not the notification: started here so both
        // sources get tracking, stopped below so neither leaks a foreground
        // service past the drive.
        if (active) TripLocationService.start(this, tripId);
        else TripLocationService.stop(this);
        if (active) {
            DaemonClient.notifyTripContext(
                preferences.daemonUrl(),
                preferences.token(),
                tripId,
                resolvedDestination,
                DeviceLocation.latest(this)
            );
        }
        sendBroadcast(new Intent(ACTION_TRAVEL_STATE_CHANGED).setPackage(getPackageName()));
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (!active) {
            cancelDaemonNotification();
            main.removeCallbacks(verifyEnded);
            main.removeCallbacks(verifySignalFreshness);
            manager.cancel(ACTIVE_NOTIFICATION);
            CarMessageNotification.cancel(this);
            if (!previousTripId.isBlank()) {
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
        if (routeChanged) {
            cancelDaemonNotification();
            if (!previousTripId.isBlank()) {
                DaemonClient.notifyTripEnded(preferences.daemonUrl(), preferences.token(), previousTripId);
            }
            preferences.setTravelEventSent(false);
            scheduleDaemonNotification(notificationDelay(resolvedDestination), true);
            Log.i(TAG, "Google Maps destination changed; APX started a new trip");
        } else if (!wasActive) {
            Log.i(TAG, "Trip started (source: " + (source.isBlank() ? "unknown" : source) + ")");
            preferences.setTravelEventSent(false);
            scheduleDaemonNotification(notificationDelay(resolvedDestination), true);
        } else if (destinationResolved) {
            Log.i(TAG, "Google Maps destination became available");
            preferences.setTravelEventSent(false);
            scheduleDaemonNotification(notificationDelay(resolvedDestination), true);
        }
    }

    private void scheduleDaemonNotification(long delayMs, boolean replace) {
        if (daemonNotificationPending && !replace) return;
        main.removeCallbacks(notifyDaemon);
        daemonNotificationPending = true;
        main.postDelayed(notifyDaemon, delayMs);
    }

    private long notificationDelay(String destination) {
        return TravelEventGate.delayMs(
            System.currentTimeMillis(),
            destination,
            preferences.travelLastSentAt(),
            preferences.travelLastSentDestination()
        );
    }

    private void cancelDaemonNotification() {
        main.removeCallbacks(notifyDaemon);
        daemonNotificationPending = false;
    }
}
