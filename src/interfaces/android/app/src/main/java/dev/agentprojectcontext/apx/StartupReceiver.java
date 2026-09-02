package dev.agentprojectcontext.apx;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

/**
 * Brings the socket back after the two moments that silently kill it.
 *
 * MascotOverlayService is what holds the connection to the daemon and raises
 * every bubble, sound and Android Auto card. Nothing but MainActivity used to
 * start it, so the phone went quiet in two cases where the owner has no reason
 * to suspect anything is wrong:
 *
 *  - a REBOOT: nothing runs until an app is opened, and APX was never opened;
 *  - an UPDATE: installing an APK force-stops the package, and the service does
 *    not come back on its own. Measured on both phones — zero ServiceRecords
 *    right after `adb install -r`, back the instant MainActivity ran.
 *
 * "Notifications stopped working" and "I have not opened APX since Tuesday" are
 * the same sentence, and only one of them is visible from the outside.
 */
public final class StartupReceiver extends BroadcastReceiver {
    private static final String TAG = "APX";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
            && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            return;
        }
        // An unpaired install has nothing to connect to. The service would
        // stopSelf() the moment it looked, so the cheaper answer is not to
        // start it — and a phone that never finished pairing costs nothing.
        if (!new ApxPreferences(context).paired()) return;

        Intent service = new Intent(context, MascotOverlayService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                context.startForegroundService(service);
            } else {
                context.startService(service);
            }
        } catch (RuntimeException refused) {
            // Same shape as TripLocationService: SecurityException (the app is
            // not in an eligible state) and ForegroundServiceStartNotAllowedException
            // are both RuntimeException, and a boot broadcast is exactly where
            // Android is entitled to say no. Losing the notifications until the
            // owner next opens APX is the old behaviour; taking the phone's boot
            // down with an uncaught crash is not.
            Log.w(TAG, "Android refused the startup service: " + refused.getMessage());
        }
    }
}
