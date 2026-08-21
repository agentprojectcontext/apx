package dev.agentprojectcontext.apx;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;

final class DeviceLocation {
    record Snapshot(double latitude, double longitude, float accuracyMeters, long ageMs) {}

    private DeviceLocation() {}

    static Snapshot latest(Context context) {
        boolean coarse = context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean fine = context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        if (!coarse && !fine) return null;

        LocationManager manager = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
        Location newest = null;
        try {
            for (String provider : manager.getProviders(true)) {
                Location candidate = manager.getLastKnownLocation(provider);
                if (candidate == null) continue;
                if (newest == null || candidate.getTime() > newest.getTime()) newest = candidate;
            }
        } catch (SecurityException ignored) {
            return null;
        }
        if (newest == null) return null;
        return new Snapshot(
            newest.getLatitude(),
            newest.getLongitude(),
            newest.hasAccuracy() ? newest.getAccuracy() : -1f,
            Math.max(0L, System.currentTimeMillis() - newest.getTime())
        );
    }
}
