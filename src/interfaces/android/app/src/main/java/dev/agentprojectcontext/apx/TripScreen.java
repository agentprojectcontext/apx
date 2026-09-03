package dev.agentprojectcontext.apx;

import androidx.annotation.NonNull;
import androidx.car.app.CarContext;
import androidx.car.app.Screen;
import androidx.car.app.model.Action;
import androidx.car.app.model.CarIcon;
import androidx.car.app.model.ItemList;
import androidx.car.app.model.ListTemplate;
import androidx.car.app.model.Row;
import androidx.car.app.model.Template;
import androidx.core.graphics.drawable.IconCompat;
import androidx.lifecycle.DefaultLifecycleObserver;
import androidx.lifecycle.LifecycleOwner;

import java.util.ArrayList;
import java.util.List;

/**
 * The chip's main screen: everything owed on this drive, in one list.
 *
 * TWO SOURCES, ONE LIST. What has come into RANGE sits at the top — that is
 * the decision on the clock — and the rest of the trip's errands follow. The
 * second half is the point of opening the app at all: the owner wanted the
 * list to hand while driving, so it can be read at a light and ticked off
 * there, rather than having to remember what was on it until the next alert
 * fires. An errand with no alert yet is still an errand.
 *
 * The errand list is fetched, not pushed: it changes when a task is added or
 * the car moves far enough to re-rank, neither of which is worth a socket.
 * The alerts half is push (CarAlertStore) because it is the urgent one.
 */
final class TripScreen extends Screen implements DefaultLifecycleObserver {

    /** Redraw when the alert set changes underneath us. */
    private final Runnable onAlerts = this::invalidate;

    /** The trip's errands, last time we asked. */
    private List<DaemonClient.TripPlace> errands = new ArrayList<>();
    private boolean asked = false;

    TripScreen(@NonNull CarContext carContext) {
        super(carContext);
        getLifecycle().addObserver(this);
    }

    @Override
    public void onStart(@NonNull LifecycleOwner owner) {
        CarAlertStore.addListener(onAlerts);
        refreshErrands();
    }

    @Override
    public void onStop(@NonNull LifecycleOwner owner) {
        // A screen that keeps a listener after it is gone keeps the store
        // holding a reference to a dead Screen for the rest of the drive.
        CarAlertStore.removeListener(onAlerts);
    }

    /**
     * Ask the daemon what is still owed. Read-only on purpose: the endpoint
     * fires no reminder and spends no one-shot, so opening the chip never
     * costs the owner an alert they had not been given yet.
     */
    private void refreshErrands() {
        ApxPreferences preferences = new ApxPreferences(getCarContext());
        DaemonClient.fetchTripPlaces(
            preferences.daemonUrl(),
            preferences.token(),
            new DaemonClient.TripCallback() {
                @Override public void onTrip(List<DaemonClient.TripPlace> places) {
                    errands = places == null ? new ArrayList<>() : places;
                    asked = true;
                    getCarContext().getMainExecutor().execute(TripScreen.this::invalidate);
                }
                @Override public void onError(String message) {
                    // No trip, no pairing, no daemon: the screen falls back to
                    // whatever alerts it has rather than showing an error the
                    // driver can do nothing about.
                    asked = true;
                    getCarContext().getMainExecutor().execute(TripScreen.this::invalidate);
                }
            }
        );
    }

    @Override
    @NonNull
    public Template onGetTemplate() {
        ItemList.Builder items = new ItemList.Builder();
        List<MessageFrameParser.MobilityAlert> alerts = CarAlertStore.all();
        int rows = 0;

        // In range now — tapping opens the four answers.
        for (MessageFrameParser.MobilityAlert alert : alerts) {
            Row.Builder row = new Row.Builder()
                .setTitle(alert.title())
                .setImage(new CarIcon.Builder(
                    IconCompat.createWithResource(getCarContext(), R.drawable.ic_trip_car)).build())
                .setBrowsable(true)
                .setOnClickListener(() -> getScreenManager().push(new AlertScreen(getCarContext(), alert.id())));
            String detail = detailLine(alert.distanceLabel(), alert.place(), alert.address());
            if (!detail.isEmpty()) row.addText(detail);
            items.addItem(row.build());
            rows++;
        }

        // Still owed on this drive. Anything already alerted is skipped: it is
        // in the list above, and one errand twice reads as two.
        for (DaemonClient.TripPlace errand : errands) {
            if (rows >= MAX_ROWS) break;
            if (alreadyAlerted(alerts, errand)) continue;
            Row.Builder row = new Row.Builder()
                .setTitle(errandTitle(errand))
                .setBrowsable(true)
                .setOnClickListener(() ->
                    getScreenManager().push(new ErrandScreen(getCarContext(), errand)));
            String detail = detailLine(distanceLabel(errand.distanceM()), errand.place(), null);
            if (!detail.isEmpty()) row.addText(detail);
            items.addItem(row.build());
            rows++;
        }

        if (rows == 0) {
            items.addItem(new Row.Builder()
                .setTitle(getCarContext().getString(
                    asked ? R.string.car_no_alerts : R.string.car_loading))
                .build());
        }

        return new ListTemplate.Builder()
            .setSingleList(items.build())
            .setTitle(getCarContext().getString(R.string.car_trip_title))
            .setHeaderAction(Action.APP_ICON)
            .build();
    }

    /** A head unit shows a handful of rows; past that nobody is reading. */
    private static final int MAX_ROWS = 6;

    private static boolean alreadyAlerted(
        List<MessageFrameParser.MobilityAlert> alerts, DaemonClient.TripPlace errand
    ) {
        for (MessageFrameParser.MobilityAlert alert : alerts) {
            if (alert.title() != null && alert.title().equals(errand.task())) return true;
        }
        return false;
    }

    private static String errandTitle(DaemonClient.TripPlace errand) {
        // The errand leads here too — it is what the row is about.
        String task = errand.task();
        if (task != null && !task.isBlank()) return task;
        return errand.place() == null || errand.place().isBlank() ? "—" : errand.place();
    }

    /** "1.4 km" from raw metres, or nothing when the distance is unknown. */
    private static String distanceLabel(int metres) {
        if (metres < 0) return null;
        return metres >= 1000
            ? String.format(java.util.Locale.US, "%.1f km", metres / 1000.0)
            : metres + " m";
    }

    /**
     * "1.4 km · Farmacia del Puente · Av. San Martin 1234" — or as much of it
     * as we actually know.
     *
     * The row's TITLE is the errand, so the shop belongs here: distance first
     * because it decides whether to look at all, then which shop, then the
     * door to aim at.
     */
    private static String detailLine(String distance, String place, String address) {
        StringBuilder out = new StringBuilder();
        for (String part : new String[] { distance, place, address }) {
            if (part == null || part.isBlank()) continue;
            if (out.length() > 0) out.append(" · ");
            out.append(part);
        }
        return out.toString();
    }
}
