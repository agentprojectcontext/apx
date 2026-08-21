package dev.agentprojectcontext.apx;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.widget.Toast;

import androidx.core.app.RemoteInput;

public final class CarMessageActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.cancel(CarMessageNotification.ID);

        if (!CarMessageNotification.ACTION_REPLY.equals(intent.getAction())) return;
        Bundle results = RemoteInput.getResultsFromIntent(intent);
        CharSequence reply = results == null ? null : results.getCharSequence(CarMessageNotification.KEY_REPLY);
        if (reply != null && !reply.toString().trim().isEmpty()) {
            Toast.makeText(context, "Prueba local: respuesta no enviada", Toast.LENGTH_SHORT).show();
        }
    }
}
