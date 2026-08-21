package dev.agentprojectcontext.apx;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.BitmapFactory;

import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;
import androidx.core.app.RemoteInput;

final class CarMessageNotification {
    static final String CHANNEL = "apx_messages_custom_sound";
    static final int ID = 7100;
    static final String ACTION_REPLY = "dev.agentprojectcontext.apx.CAR_MESSAGE_REPLY";
    static final String ACTION_READ = "dev.agentprojectcontext.apx.CAR_MESSAGE_READ";
    static final String KEY_REPLY = "apx_car_reply";

    private CarMessageNotification() {}

    static Notification build(Context context, String message, PendingIntent openApp) {
        ensureChannel(context);

        Person apx = new Person.Builder()
            .setName("APX")
            .setIcon(androidx.core.graphics.drawable.IconCompat.createWithResource(context, R.drawable.apx_logo))
            .build();
        Person user = new Person.Builder().setName("Vos").build();

        RemoteInput replyInput = new RemoteInput.Builder(KEY_REPLY)
            .setLabel("Responder a APX")
            .build();
        NotificationCompat.Action reply = new NotificationCompat.Action.Builder(
            R.drawable.ic_apx_notification,
            "Responder",
            pendingBroadcast(context, ACTION_REPLY, 40, true)
        )
            .addRemoteInput(replyInput)
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
            .setShowsUserInterface(false)
            .build();
        NotificationCompat.Action read = new NotificationCompat.Action.Builder(
            R.drawable.ic_apx_notification,
            "Marcar leído",
            pendingBroadcast(context, ACTION_READ, 41, false)
        )
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
            .setShowsUserInterface(false)
            .build();

        return new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_apx_notification)
            .setLargeIcon(BitmapFactory.decodeResource(context.getResources(), R.drawable.apx_logo))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openApp)
            .setAutoCancel(true)
            .setOnlyAlertOnce(false)
            .setStyle(new NotificationCompat.MessagingStyle(user)
                .setConversationTitle("APX")
                .addMessage(message, System.currentTimeMillis(), apx))
            .addAction(reply)
            .addAction(read)
            .extend(new NotificationCompat.CarExtender()
                .setUnreadConversation(new NotificationCompat.CarExtender.UnreadConversation.Builder("APX")
                    .addMessage(message)
                    .setLatestTimestamp(System.currentTimeMillis())
                    .setReadPendingIntent(pendingBroadcast(context, ACTION_READ, 42, false))
                    .setReplyAction(pendingBroadcast(context, ACTION_REPLY, 43, true), replyInput)
                    .build()))
            .build();
    }

    static void show(Context context, String message) {
        Intent open = new Intent(context, MainActivity.class)
            .putExtra(MainActivity.EXTRA_PATH, "/mobile")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openApp = PendingIntent.getActivity(
            context,
            44,
            open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.notify(ID, build(context, message, openApp));
    }

    private static void ensureChannel(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(
            CHANNEL,
            context.getString(R.string.messages_channel),
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Mensajes directos APX, también visibles en Android Auto.");
        channel.setSound(null, null);
        channel.setBypassDnd(manager.isNotificationPolicyAccessGranted());
        manager.createNotificationChannel(channel);
    }

    private static PendingIntent pendingBroadcast(
        Context context,
        String action,
        int requestCode,
        boolean mutable
    ) {
        Intent intent = new Intent(context, CarMessageActionReceiver.class).setAction(action);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT |
            (mutable ? PendingIntent.FLAG_MUTABLE : PendingIntent.FLAG_IMMUTABLE);
        return PendingIntent.getBroadcast(context, requestCode, intent, flags);
    }
}
