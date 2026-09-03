package dev.agentprojectcontext.apx;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

import androidx.core.app.NotificationCompat;

/**
 * The proximity card on the PHONE: "you are 1.4 km from Farmacia del Puente,
 * Av. San Martín 1234 — Comprar ibuprofeno", and four buttons.
 *
 * WHY THIS IS NOT A CarMessageNotification. That one is a MessagingStyle
 * conversation, and Android Auto only ever renders two controls on those —
 * reply and mark-as-read. Four answers do not fit in a shape built for a chat.
 * On the head unit the same alert is drawn by ApxCarAppService, which uses the
 * Car App Library and can show all four; this class is the phone's copy.
 *
 * NOTHING HERE ADDS A GLYPH. The daemon sends the text already stripped
 * (core/mobility/geofence.js) because Assistant reads it out loud, and
 * decorating it here would put the emoji straight back into the sentence.
 *
 * ONE CARD PER ALERT, keyed by the alert id: two errands can come into range
 * on the same GPS sample, and collapsing them into one notification would lose
 * one of the two answers.
 */
final class ProximityNotification {
    static final String CHANNEL = "apx_proximity";
    static final String ACTION_ANSWER = "dev.agentprojectcontext.apx.PROXIMITY_ANSWER";
    static final String EXTRA_ALERT_ID = "alert_id";
    static final String EXTRA_ACTION_ID = "action_id";
    static final String EXTRA_URL = "url";
    static final String EXTRA_NOTIFICATION_ID = "notification_id";

    private ProximityNotification() {}

    /** Stable per alert, so a re-sent card replaces itself instead of stacking. */
    static int notificationId(String alertId) {
        return 7200 + Math.abs(alertId.hashCode() % 700);
    }

    static void show(Context context, MessageFrameParser.MobilityAlert alert) {
        ensureChannel(context);
        int id = notificationId(alert.id());

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_apx_notification)
            .setContentTitle(alert.title())
            .setContentText(alert.body())
            .setStyle(new NotificationCompat.BigTextStyle().bigText(alert.body()))
            // NAVIGATION, not MESSAGE: this is a place and a route, and the
            // category is what tells the system (and the car) which it is.
            .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .setContentIntent(openApp(context, id));

        // The daemon decides the four and their order — it owns the wording and
        // the translations. Android draws what it is given rather than keeping
        // its own copy of the list, so adding a fifth never needs a new APK.
        int requestCode = 0;
        for (MessageFrameParser.Action action : alert.actions()) {
            String url = switch (action.id()) {
                case "navigate" -> alert.navigateUrl();
                case "add_stop" -> alert.addStopUrl();
                default -> null;
            };
            builder.addAction(new NotificationCompat.Action.Builder(
                R.drawable.ic_apx_notification,
                action.label(),
                answerIntent(context, alert.id(), action.id(), url, id, requestCode++)
            ).build());
        }

        context.getSystemService(NotificationManager.class).notify(id, builder.build());
    }

    static void cancel(Context context, int id) {
        context.getSystemService(NotificationManager.class).cancel(id);
    }

    private static PendingIntent answerIntent(
        Context context, String alertId, String actionId, String url, int notificationId, int requestCode
    ) {
        Intent intent = new Intent(context, ProximityActionReceiver.class)
            .setAction(ACTION_ANSWER)
            .putExtra(EXTRA_ALERT_ID, alertId)
            .putExtra(EXTRA_ACTION_ID, actionId)
            .putExtra(EXTRA_NOTIFICATION_ID, notificationId);
        if (url != null) intent.putExtra(EXTRA_URL, url);
        return PendingIntent.getBroadcast(
            context,
            // The alert id is part of the request code or two open cards would
            // share one PendingIntent and the second would answer the first.
            notificationId * 10 + requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static PendingIntent openApp(Context context, int notificationId) {
        Intent open = new Intent(context, MainActivity.class)
            .putExtra(MainActivity.EXTRA_PATH, "/mobile")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(
            context, notificationId, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static void ensureChannel(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(
            CHANNEL,
            context.getString(R.string.proximity_channel),
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Avisos de lugares cerca tuyo durante un viaje.");
        // Silent: MascotOverlayService already plays the one APX sound for the
        // event, and a channel with its own tone would ring the same alert
        // twice — once as the app's sound, once as Android's.
        channel.setSound(null, null);
        manager.createNotificationChannel(channel);
    }
}
