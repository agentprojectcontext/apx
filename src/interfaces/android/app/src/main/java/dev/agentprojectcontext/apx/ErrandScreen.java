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
 * One errand from the trip's list — the ones NOT in range yet.
 *
 * The sibling of AlertScreen, and the difference is what the driver is being
 * asked. An alert interrupts: "you are passing it, what do you want to do?".
 * This one was opened on purpose, from a list read at a light, so the useful
 * verbs are different — go there now, add it to the route, or tick it off
 * because it is already done.
 *
 * "Ya la hice" closes the TASK. It is the reason the list is worth having on
 * the head unit at all: without it the owner reads what is owed, does it, and
 * still has to remember to close it on the phone afterwards.
 */
final class ErrandScreen extends Screen {
    private static final String TAG = "APXTravel";

    private final DaemonClient.TripPlace errand;

    ErrandScreen(@NonNull CarContext carContext, @NonNull DaemonClient.TripPlace errand) {
        super(carContext);
        this.errand = errand;
    }

    @Override
    @NonNull
    public Template onGetTemplate() {
        ItemList.Builder items = new ItemList.Builder();

        Row.Builder header = new Row.Builder().setTitle(title());
        if (errand.place() != null && !errand.place().isBlank()) header.addText(errand.place());
        items.addItem(header.build());

        if (has(errand.mapsUrl())) {
            items.addItem(row(R.string.mobility_navigate, () -> navigate(errand.mapsUrl())));
        }
        if (has(errand.addStopUrl())) {
            items.addItem(row(R.string.mobility_add_stop, () -> navigate(errand.addStopUrl())));
        }
        items.addItem(row(R.string.car_errand_done, this::markDone));

        return new ListTemplate.Builder()
            .setSingleList(items.build())
            .setTitle(title())
            .setHeaderAction(Action.BACK)
            .build();
    }

    private String title() {
        String task = errand.task();
        return task == null || task.isBlank() ? errand.place() : task;
    }

    private static boolean has(String value) {
        return value != null && !value.isBlank();
    }

    private Row row(int labelRes, Runnable onClick) {
        return new Row.Builder()
            .setTitle(getCarContext().getString(labelRes))
            .setBrowsable(false)
            .setOnClickListener(onClick::run)
            .build();
    }

    private void markDone() {
        ApxPreferences preferences = new ApxPreferences(getCarContext());
        DaemonClient.answerErrand(
            preferences.daemonUrl(),
            preferences.token(),
            errand.taskId(),
            "done",
            new DaemonClient.AnswerCallback() {
                @Override public void onAnswered() {
                    Log.i(TAG, "errand " + errand.taskId() + " closed from the car");
                }
                @Override public void onAnswerFailed(String message) {
                    // Logged, not surfaced: the driver already tapped and is
                    // looking at the road. Nothing here pretends it worked.
                    Log.w(TAG, "closing errand failed: " + message);
                }
            }
        );
        CarToast.makeText(getCarContext(),
            getCarContext().getString(R.string.car_ack_done), CarToast.LENGTH_SHORT).show();
        getScreenManager().pop();
    }

    /** Answer first, navigate second — the same order the notification uses. */
    private void navigate(String url) {
        DaemonClient.answerErrand(
            new ApxPreferences(getCarContext()).daemonUrl(),
            new ApxPreferences(getCarContext()).token(),
            errand.taskId(),
            "go",
            new DaemonClient.AnswerCallback() {
                @Override public void onAnswered() { }
                @Override public void onAnswerFailed(String message) {
                    Log.w(TAG, "errand answer failed: " + message);
                }
            }
        );
        try {
            getCarContext().startCarApp(new Intent(CarContext.ACTION_NAVIGATE, Uri.parse(url)));
        } catch (Exception error) {
            Log.w(TAG, "car navigate refused: " + error.getMessage());
            CarToast.makeText(getCarContext(),
                getCarContext().getString(R.string.car_navigate_failed), CarToast.LENGTH_SHORT).show();
        }
        getScreenManager().pop();
    }
}
