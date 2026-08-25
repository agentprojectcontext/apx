package dev.agentprojectcontext.apx;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.view.Gravity;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;

final class TravelStatusBanner extends LinearLayout {
    private final TextView title;
    private final TextView detail;

    TravelStatusBanner(Context context) {
        super(context);
        setOrientation(HORIZONTAL);
        setGravity(Gravity.CENTER_VERTICAL);
        setPadding(dp(16), dp(11), dp(16), dp(11));
        setBackgroundColor(Color.rgb(21, 48, 40));
        setClickable(true);
        setFocusable(true);

        TextView icon = new TextView(context);
        icon.setText("🚗");
        icon.setTextSize(25);
        addView(icon, new LayoutParams(dp(42), LayoutParams.WRAP_CONTENT));

        LinearLayout copy = new LinearLayout(context);
        copy.setOrientation(VERTICAL);
        title = new TextView(context);
        title.setTextColor(Color.WHITE);
        title.setTextSize(15);
        title.setTypeface(null, Typeface.BOLD);
        detail = new TextView(context);
        detail.setTextColor(Color.rgb(166, 220, 202));
        detail.setTextSize(12);
        copy.addView(title, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        copy.addView(detail, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        addView(copy, new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f));

        TextView affordance = new TextView(context);
        affordance.setText("Abrir Maps  ›");
        affordance.setTextColor(Color.rgb(58, 231, 176));
        affordance.setTextSize(12);
        addView(affordance, new LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT));
        setVisibility(View.GONE);
    }

    void update(boolean active, String destination) {
        if (!active) {
            setVisibility(View.GONE);
            return;
        }
        boolean known = destination != null && !destination.isBlank();
        boolean sharedLink = known && (destination.startsWith("https://maps.app.goo.gl/")
            || destination.startsWith("https://goo.gl/maps/"));
        title.setText(known ? "Estás en camino" : "Estás navegando por una ruta");
        detail.setText(sharedLink
            ? "Viaje compartido desde Google Maps"
            : known ? "Destino: " + destination : "Google Maps activo · destino todavía no disponible");
        setVisibility(View.VISIBLE);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
