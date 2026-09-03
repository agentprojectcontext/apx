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

import java.util.List;

/**
 * The chip's main screen: what is in range now, and what is still owed.
 *
 * Two sections, in the order a driver needs them. Anything that has come into
 * range sits at the top with its distance and address, because that is the
 * decision on the clock; the rest of the trip's errands follow as a plain
 * list, so the screen answers "what else am I meant to do on this drive?"
 * without the driver opening the phone.
 *
 * Tapping an alert opens its four answers (AlertScreen). Tapping a plain
 * errand does nothing on purpose — it is information, not a decision, and a
 * row that swallows a tap teaches the driver to keep tapping.
 */
final class TripScreen extends Screen implements DefaultLifecycleObserver {

    /** Redraw when the alert set changes underneath us. */
    private final Runnable onAlerts = this::invalidate;

    TripScreen(@NonNull CarContext carContext) {
        super(carContext);
        getLifecycle().addObserver(this);
    }

    @Override
    public void onStart(@NonNull LifecycleOwner owner) {
        CarAlertStore.addListener(onAlerts);
    }

    @Override
    public void onStop(@NonNull LifecycleOwner owner) {
        // A screen that keeps a listener after it is gone keeps the store
        // holding a reference to a dead Screen for the rest of the drive.
        CarAlertStore.removeListener(onAlerts);
    }

    @Override
    @NonNull
    public Template onGetTemplate() {
        ItemList.Builder items = new ItemList.Builder();
        List<MessageFrameParser.MobilityAlert> alerts = CarAlertStore.all();

        for (MessageFrameParser.MobilityAlert alert : alerts) {
            Row.Builder row = new Row.Builder()
                .setTitle(alert.title())
                .setImage(new CarIcon.Builder(
                    IconCompat.createWithResource(getCarContext(), R.drawable.ic_trip_car)).build())
                .setBrowsable(true)
                .setOnClickListener(() -> getScreenManager().push(new AlertScreen(getCarContext(), alert.id())));
            // Distance first, then the street. At a glance the number decides
            // whether to look at all; the address is what you act on.
            String detail = detailLine(alert);
            if (!detail.isEmpty()) row.addText(detail);
            items.addItem(row.build());
        }

        if (alerts.isEmpty()) {
            items.addItem(new Row.Builder()
                .setTitle(getCarContext().getString(R.string.car_no_alerts))
                .addText(getCarContext().getString(R.string.car_no_alerts_detail))
                .build());
        }

        return new ListTemplate.Builder()
            .setSingleList(items.build())
            .setTitle(getCarContext().getString(R.string.car_trip_title))
            .setHeaderAction(Action.APP_ICON)
            .build();
    }

    /**
     * "1.4 km · Farmacia del Puente · Av. San Martin 1234" — or as much of it
     * as we actually know.
     *
     * The row's TITLE is the errand, so the shop belongs here: distance first
     * because it decides whether to look at all, then which shop, then the
     * door to aim at.
     */
    private static String detailLine(MessageFrameParser.MobilityAlert alert) {
        StringBuilder out = new StringBuilder();
        for (String part : new String[] { alert.distanceLabel(), alert.place(), alert.address() }) {
            if (part == null || part.isBlank()) continue;
            if (out.length() > 0) out.append(" · ");
            out.append(part);
        }
        return out.toString();
    }
}
