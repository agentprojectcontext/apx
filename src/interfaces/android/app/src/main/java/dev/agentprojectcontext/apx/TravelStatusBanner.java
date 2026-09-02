package dev.agentprojectcontext.apx;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * The strip above `/mobile` that says a trip is in progress.
 *
 * It used to offer "Abrir Maps", which was the wrong destination: Maps is
 * already open — it is what APX is reading the trip from. What the owner has
 * no way to see is what APX is watching for on THIS drive, so the whole strip
 * now opens that list instead (MainActivity.showTripPlaces).
 */
final class TravelStatusBanner extends LinearLayout {
    private final TextView title;
    private final TextView detail;
    private final TextView affordance;

    TravelStatusBanner(Context context) {
        super(context);
        setOrientation(HORIZONTAL);
        setGravity(Gravity.CENTER_VERTICAL);
        setPadding(dp(16), dp(11), dp(16), dp(11));
        setBackgroundColor(Color.rgb(21, 48, 40));
        setClickable(true);
        setFocusable(true);

        ImageView icon = new ImageView(context);
        icon.setImageResource(R.drawable.ic_trip_car);
        LayoutParams iconParams = new LayoutParams(dp(30), dp(30));
        iconParams.rightMargin = dp(12);
        addView(icon, iconParams);

        LinearLayout copy = new LinearLayout(context);
        copy.setOrientation(VERTICAL);
        // One line each, ellipsized: the strip sits above the whole app and a
        // subtitle that wraps pushes `/mobile` down and collides with the
        // affordance on the right.
        title = new TextView(context);
        title.setTextColor(Color.WHITE);
        title.setTextSize(15);
        title.setTypeface(null, Typeface.BOLD);
        title.setMaxLines(1);
        title.setEllipsize(TextUtils.TruncateAt.END);
        detail = new TextView(context);
        detail.setTextColor(Color.rgb(166, 220, 202));
        detail.setTextSize(12);
        detail.setMaxLines(1);
        detail.setEllipsize(TextUtils.TruncateAt.END);
        copy.addView(title, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        copy.addView(detail, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        addView(copy, new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f));

        affordance = new TextView(context);
        affordance.setTextColor(Color.rgb(58, 231, 176));
        affordance.setTextSize(12);
        affordance.setTypeface(null, Typeface.BOLD);
        affordance.setMaxLines(1);
        LayoutParams affordanceParams = new LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT);
        affordanceParams.leftMargin = dp(10);
        addView(affordance, affordanceParams);
        setVisibility(View.GONE);
    }

    void update(boolean active, String destination, String source) {
        update(active, destination, source, -1);
    }

    /**
     * `source` decides the sub-line, because "no destination yet" means two
     * different things: Maps has not published one, or there is no route at all
     * and APX only knows the phone is plugged into the car.
     *
     * `places` is how many errands APX is watching on this trip, or -1 while
     * that is still unknown — the count comes from the daemon, so the banner
     * has to render correctly before the first answer arrives.
     */
    void update(boolean active, String destination, String source, int places) {
        if (!active) {
            setVisibility(View.GONE);
            return;
        }
        boolean known = destination != null && !destination.isBlank();
        boolean sharedLink = known && (destination.startsWith("https://maps.app.goo.gl/")
            || destination.startsWith("https://goo.gl/maps/"));
        boolean projecting = ApxPreferences.SOURCE_ANDROID_AUTO.equals(source);
        title.setText(known
            ? "Estás en camino"
            : projecting ? "Estás en el auto" : "Estás navegando por una ruta");
        detail.setText(sharedLink
            ? "Viaje compartido desde Google Maps"
            : known ? "Destino: " + destination
            : projecting ? "Android Auto conectado · sin ruta cargada"
            : "Google Maps activo · destino todavía no disponible");
        affordance.setText(placesLabel(places));
        setVisibility(View.VISIBLE);
    }

    /** Kept short on purpose: it shares one line with the trip's own status. */
    private String placesLabel(int places) {
        if (places < 0) return "Pendientes ›";
        if (places == 0) return "Nada cerca ›";
        return places + " cerca ›";
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
