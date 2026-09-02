package dev.agentprojectcontext.apx;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.IBinder;
import android.os.SystemClock;
import android.util.Log;

/**
 * Streams the phone's position to the paired daemon while a trip is running.
 *
 * A foreground service, and not a timer inside the notification listener, for
 * one reason: from Android 10 on, an app that is not in the foreground gets no
 * location at all without ACCESS_BACKGROUND_LOCATION — and a foreground
 * service typed `location` grants exactly the while-in-use access this needs
 * without asking the owner for the far broader always-on permission. The
 * ongoing notification it is obliged to show is a feature here, not a cost:
 * the phone says out loud that APX is following the trip, and tapping it opens
 * the app to stop.
 *
 * Nothing about a route is uploaded. Each sample is a point plus its accuracy,
 * the daemon answers it with at most a proximity reminder, and no location
 * history is written anywhere — see rules/android.md.
 */
public final class TripLocationService extends Service {
    private static final String TAG = "APXTravel";
    private static final String CHANNEL = "apx_trip_location";
    private static final int NOTIFICATION_ID = 7300;
    static final String EXTRA_TRIP_ID = "trip_id";

    // 30 s / 150 m. Fast enough that a 2 km geofence cannot be crossed and
    // left between two samples at city speed, slow enough that a whole drive
    // costs a couple of hundred requests rather than a couple of thousand.
    private static final long MIN_INTERVAL_MS = 30_000L;
    private static final float MIN_DISTANCE_M = 150f;
    // The provider can hand us a fix more often than we asked; this is the
    // floor on what actually leaves the phone.
    private static final long MIN_UPLOAD_INTERVAL_MS = 25_000L;

    private ApxPreferences preferences;
    private LocationManager locations;
    private String tripId = "";
    private long lastUploadElapsedMs;

    private final LocationListener listener = new LocationListener() {
        @Override
        public void onLocationChanged(Location location) {
            publish(location);
        }

        // Required on API < 30; harmless above it.
        @Override
        public void onProviderEnabled(String provider) {}

        @Override
        public void onProviderDisabled(String provider) {}
    };

    /**
     * Begin reporting for `tripId`. Safe to call again for the same trip — the
     * service just re-reads the id. Returns false when Android refused the
     * start (a background foreground-service start is not always allowed), so
     * the caller can log it rather than assume tracking is live.
     */
    static boolean start(Context context, String tripId) {
        Intent intent = new Intent(context, TripLocationService.class).putExtra(EXTRA_TRIP_ID, tripId);
        try {
            context.startForegroundService(intent);
            return true;
        } catch (RuntimeException refused) {
            Log.w(TAG, "Could not start trip location tracking", refused);
            return false;
        }
    }

    static void stop(Context context) {
        try {
            context.stopService(new Intent(context, TripLocationService.class));
        } catch (RuntimeException ignored) {
            // Already gone; nothing to stop.
        }
    }

    /** Do we have the permission this service exists to use? */
    static boolean canTrack(Context context) {
        return context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        preferences = new ApxPreferences(this);
        locations = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        ensureChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String requested = intent == null ? "" : String.valueOf(intent.getStringExtra(EXTRA_TRIP_ID));
        if (requested != null && !requested.isBlank() && !"null".equals(requested)) tripId = requested;
        // Permission first. startForeground() with the `location` type THROWS
        // when the app may not use location, and this used to run before the
        // check — so the whole app died with a SecurityException at the exact
        // moment a trip began.
        if (!canTrack(this)) {
            Log.w(TAG, "Trip tracking asked for without location permission");
            stopSelf();
            return START_NOT_STICKY;
        }
        boolean foreground = startForegroundCompat();
        // Announced either way: a trip we cannot FOLLOW is still a trip, and
        // the daemon already has an origin to reason about.
        announceTrip();
        if (!foreground) {
            stopSelf();
            return START_NOT_STICKY;
        }
        requestUpdates();
        // Send the fix we already have so the daemon can evaluate proximity
        // immediately instead of waiting up to 30 s for the first update.
        publish(newestFix());
        // START_STICKY: a trip outlives a low-memory kill, and the listener
        // service is what ends it — not the system.
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        try {
            locations.removeUpdates(listener);
        } catch (RuntimeException ignored) {
            // Never registered (missing permission) — nothing to remove.
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void requestUpdates() {
        for (String provider : new String[] { LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER }) {
            try {
                if (!locations.isProviderEnabled(provider)) continue;
                locations.requestLocationUpdates(provider, MIN_INTERVAL_MS, MIN_DISTANCE_M, listener);
            } catch (SecurityException | IllegalArgumentException unavailable) {
                Log.w(TAG, "Provider " + provider + " unavailable: " + unavailable.getMessage());
            }
        }
    }

    private Location newestFix() {
        try {
            Location newest = null;
            for (String provider : locations.getProviders(true)) {
                Location candidate = locations.getLastKnownLocation(provider);
                if (candidate == null) continue;
                if (newest == null || candidate.getTime() > newest.getTime()) newest = candidate;
            }
            return newest;
        } catch (SecurityException denied) {
            return null;
        }
    }

    private void announceTrip() {
        String trip = tripId.isBlank() ? preferences.travelTripId() : tripId;
        if (trip.isBlank()) return;
        DaemonClient.notifyTripContext(
            preferences.daemonUrl(),
            preferences.token(),
            trip,
            preferences.travelDestination(),
            DeviceLocation.latest(this)
        );
    }

    private void publish(Location location) {
        if (location == null) return;
        if (!preferences.travelActive()) {
            // The trip ended between two fixes. Stop rather than report a
            // position for a journey the daemon has already closed.
            stopSelf();
            return;
        }
        long now = SystemClock.elapsedRealtime();
        if (lastUploadElapsedMs != 0L && now - lastUploadElapsedMs < MIN_UPLOAD_INTERVAL_MS) return;
        lastUploadElapsedMs = now;
        String trip = tripId.isBlank() ? preferences.travelTripId() : tripId;
        if (trip.isBlank()) return;
        DaemonClient.reportPosition(preferences.daemonUrl(), preferences.token(), trip, location);
    }

    /**
     * Go foreground, or say why not.
     *
     * Holding ACCESS_FINE_LOCATION is not sufficient on its own: it is a
     * while-in-use permission, so Android also requires the app to be in an
     * "eligible state" to start a `location`-typed foreground service — and it
     * refuses with a SecurityException when it is not. The refusal is routine
     * rather than exceptional: the notification listener that detects a trip
     * runs in the background, which is exactly the ineligible case, and this
     * threw straight through onStartCommand and killed the app every time a
     * drive began with APX not on screen.
     *
     * Losing the GPS stream is a real cost — no proximity reminders on this
     * leg — but it is recoverable and a crash is not: MainActivity retries the
     * start on resume, when the app IS eligible, and "APX menu → Remove battery
     * restriction" makes the background start succeed on its own.
     */
    private boolean startForegroundCompat() {
        Notification notice = buildNotification();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(NOTIFICATION_ID, notice, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(NOTIFICATION_ID, notice);
            }
            return true;
        } catch (RuntimeException refused) {
            // SecurityException (not eligible) and
            // ForegroundServiceStartNotAllowedException are both RuntimeException.
            Log.w(TAG, "Android refused the trip tracking service: " + refused.getMessage());
            return false;
        }
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class).putExtra(MainActivity.EXTRA_SETTINGS, true);
        PendingIntent pending = PendingIntent.getActivity(
            this,
            8,
            open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        String destination = preferences.travelDestination();
        return new Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_apx_notification)
            .setContentTitle(getString(R.string.trip_tracking_title))
            .setContentText(destination.isBlank()
                ? getString(R.string.trip_tracking_text)
                : getString(R.string.trip_tracking_text_destination, destination))
            .setContentIntent(pending)
            .setOngoing(true)
            .build();
    }

    private void ensureChannel() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(
            CHANNEL,
            getString(R.string.trip_tracking_channel),
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription(getString(R.string.trip_tracking_channel_description));
        manager.createNotificationChannel(channel);
    }
}
