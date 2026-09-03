package dev.agentprojectcontext.apx;

import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.car.app.CarContext;
import androidx.car.app.CarToast;
import androidx.car.app.Screen;
import androidx.car.app.model.Action;
import androidx.car.app.model.ItemList;
import androidx.car.app.model.ListTemplate;
import androidx.car.app.model.Row;
import androidx.car.app.model.Template;

/**
 * One proximity alert on the head unit, with its four answers.
 *
 * A LIST, NOT A MESSAGE TEMPLATE. `MessageTemplate` takes two actions; there
 * are four here, and dropping two of them would mean the car offering a
 * different question than the phone. Rows are the only shape on this platform
 * that holds four choices, and they are also the biggest touch targets it
 * draws — which is what you want from a control used at speed.
 *
 * The text is read aloud by Assistant, which is why the daemon strips emoji
 * before it ever reaches here (core/mobility/geofence.js) and why nothing in
 * this file decorates it.
 */
final class AlertScreen extends Screen {
    private static final String TAG = "APXTravel";

    private final String alertId;

    AlertScreen(@NonNull CarContext carContext, @NonNull String alertId) {
        super(carContext);
        this.alertId = alertId;
    }

    @Override
    @NonNull
    public Template onGetTemplate() {
        MessageFrameParser.MobilityAlert alert = CarAlertStore.get(alertId);
        if (alert == null) {
            // Answered elsewhere — on the phone, or on Telegram — while this
            // screen was open. Say so and go back rather than offering answers
            // to a question that is already settled.
            return new ListTemplate.Builder()
                .setSingleList(new ItemList.Builder()
                    .addItem(new Row.Builder()
                        .setTitle(getCarContext().getString(R.string.car_alert_gone))
                        .build())
                    .build())
                .setTitle(getCarContext().getString(R.string.car_trip_title))
                .setHeaderAction(Action.BACK)
                .build();
        }

        ItemList.Builder items = new ItemList.Builder();
        // The alert itself, as the first row: on a head unit the title bar is
        // one line, and the address does not fit in it.
        items.addItem(new Row.Builder()
            .setTitle(alert.title())
            .addText(alert.body())
            .build());

        // The daemon owns the four and their wording. Android renders what it
        // was sent — a fifth answer would need no new APK.
        for (MessageFrameParser.Action action : alert.actions()) {
            items.addItem(new Row.Builder()
                .setTitle(action.label())
                .setBrowsable(false)
                .setOnClickListener(() -> answer(alert, action.id()))
                .build());
        }

        return new ListTemplate.Builder()
            .setSingleList(items.build())
            .setTitle(alert.title())
            .setHeaderAction(Action.BACK)
            .build();
    }

    /**
     * Answer, then navigate — the same order the phone's receiver uses, for the
     * same reason: handing the screen to Maps is where an answer gets lost.
     */
    private void answer(MessageFrameParser.MobilityAlert alert, String actionId) {
        ApxPreferences preferences = new ApxPreferences(getCarContext());
        DaemonClient.answerAlert(
            preferences.daemonUrl(),
            preferences.token(),
            alert.id(),
            actionId,
            new DaemonClient.AnswerCallback() {
                @Override public void onAnswered() {
                    Log.i(TAG, "car answer " + actionId + " recorded for " + alert.id());
                }
                @Override public void onAnswerFailed(String message) {
                    Log.w(TAG, "car answer " + actionId + " failed: " + message);
                }
            }
        );

        // Locally too: the head unit must not keep offering an answered alert
        // while the daemon's reply is still in flight over a mobile link.
        CarAlertStore.remove(alert.id());
        ProximityNotification.cancel(getCarContext(), ProximityNotification.notificationId(alert.id()));

        String url = switch (actionId) {
            case "navigate" -> alert.navigateUrl();
            case "add_stop" -> alert.addStopUrl();
            default -> null;
        };
        if (url != null && !url.isBlank()) {
            try {
                // The car host owns which navigation app runs; handing it a
                // plain geo/Maps intent is how an app asks for a route without
                // taking over the screen itself.
                getCarContext().startCarApp(new Intent(CarContext.ACTION_NAVIGATE, Uri.parse(url)));
            } catch (Exception error) {
                Log.w(TAG, "car navigate refused: " + error.getMessage());
                CarToast.makeText(getCarContext(),
                    getCarContext().getString(R.string.car_navigate_failed),
                    CarToast.LENGTH_SHORT).show();
            }
        } else {
            CarToast.makeText(getCarContext(), okText(actionId), CarToast.LENGTH_SHORT).show();
        }

        getScreenManager().pop();
    }

    private String okText(String actionId) {
        return "skip".equals(actionId)
            ? getCarContext().getString(R.string.car_ack_dismissed)
            : getCarContext().getString(R.string.car_ack_later);
    }
}
