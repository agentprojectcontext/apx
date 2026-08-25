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

        boolean destinationReply = CarMessageNotification.ACTION_MOBILITY_DESTINATION.equals(intent.getAction());
        if (!CarMessageNotification.ACTION_REPLY.equals(intent.getAction()) && !destinationReply) return;
        Bundle results = RemoteInput.getResultsFromIntent(intent);
        CharSequence reply = results == null ? null : results.getCharSequence(CarMessageNotification.KEY_REPLY);
        if (reply != null && !reply.toString().trim().isEmpty()) {
            if (destinationReply) {
                ApxPreferences preferences = new ApxPreferences(context);
                String spoken = reply.toString().trim();
                String parsed = MapsNavigationDetector.destinationFrom(spoken);
                String destination = parsed.isBlank() ? spoken : parsed;
                String tripId = preferences.travelTripId();
                if (preferences.travelActive() && !tripId.isBlank()) {
                    preferences.setTravelState(true, destination, tripId);
                    context.sendBroadcast(new Intent(MapsNavigationListenerService.ACTION_TRAVEL_STATE_CHANGED)
                        .setPackage(context.getPackageName()));
                    DaemonClient.notifyTripStarted(
                        preferences.daemonUrl(),
                        preferences.token(),
                        tripId,
                        destination,
                        DeviceLocation.latest(context)
                    );
                    Toast.makeText(context, "Destino enviado a Roby", Toast.LENGTH_SHORT).show();
                }
            } else {
                Toast.makeText(context, "Respuesta recibida", Toast.LENGTH_SHORT).show();
            }
        }
    }
}
