package dev.agentprojectcontext.apx;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;

/**
 * What a tap on one of the four proximity buttons does.
 *
 * TWO THINGS, IN THIS ORDER, and the order is the point. The answer goes to the
 * daemon FIRST, then Maps opens. Launching Maps hands the foreground away, and
 * an OEM that freezes the app on the way out would lose the answer — the tap
 * would have started a route APX never learned about, so the end-of-trip
 * follow-up would never ask whether the errand got done.
 *
 * The card is dismissed either way: it was answered, and a proximity alert that
 * stays on screen after being answered is the one thing guaranteed to be tapped
 * twice at the next red light.
 */
public class ProximityActionReceiver extends BroadcastReceiver {
    private static final String TAG = "APXTravel";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!ProximityNotification.ACTION_ANSWER.equals(intent.getAction())) return;
        String alertId = intent.getStringExtra(ProximityNotification.EXTRA_ALERT_ID);
        String actionId = intent.getStringExtra(ProximityNotification.EXTRA_ACTION_ID);
        String url = intent.getStringExtra(ProximityNotification.EXTRA_URL);
        int notificationId = intent.getIntExtra(ProximityNotification.EXTRA_NOTIFICATION_ID, -1);
        if (alertId == null || actionId == null) return;

        Log.i(TAG, "proximity answer " + actionId + " for " + alertId);

        ApxPreferences preferences = new ApxPreferences(context);
        DaemonClient.answerAlert(
            preferences.daemonUrl(),
            preferences.token(),
            alertId,
            actionId,
            new DaemonClient.AnswerCallback() {
                @Override public void onAnswered() {
                    Log.i(TAG, "proximity answer " + actionId + " recorded");
                }
                @Override public void onAnswerFailed(String message) {
                    // Logged, not surfaced: the driver already pressed the
                    // button and is looking at the road. The alert stays
                    // recorded on the daemon side as unanswered, which is the
                    // honest state — nothing here pretends otherwise.
                    Log.w(TAG, "proximity answer " + actionId + " failed: " + message);
                }
            }
        );

        // Gone from the head unit too: answering on the phone must not leave
        // the chip offering the same four buttons for the same place.
        CarAlertStore.remove(alertId);
        if (notificationId >= 0) ProximityNotification.cancel(context, notificationId);

        if (url != null && !url.isBlank()) {
            try {
                context.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))
                    .setPackage("com.google.android.apps.maps")
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (Exception ignored) {
                // Maps missing or refusing the intent: fall back to whatever
                // does handle it rather than dropping the tap.
                try {
                    context.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                } catch (Exception error) {
                    Log.w(TAG, "could not open " + url + ": " + error.getMessage());
                }
            }
        }
    }
}
