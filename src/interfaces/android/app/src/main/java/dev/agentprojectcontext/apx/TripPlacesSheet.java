package dev.agentprojectcontext.apx;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.List;
import java.util.Locale;

/**
 * The trip's errands, as a thread of cards rather than a list of rows.
 *
 * This used to be an AlertDialog.setItems() list where tapping a row opened
 * Maps — one gesture, one meaning, and no way to say "voy" without leaving the
 * app. The Telegram card for the same errand offers four choices, and the
 * owner's point stands: the phone should show what Telegram shows. So each
 * errand gets the card it gets in the chat — place, distance, task, and the
 * same four chips underneath.
 *
 * Built in code, like TravelStatusBanner: this app has no XML layouts, and a
 * card whose shape depends on the data (how many chips, whether it is already
 * answered) is clearer assembled than inflated and hidden.
 *
 * No emoji on the chips. The car reads these labels aloud when the same text
 * reaches a head unit, and "check mark button voy" is not a thing anyone
 * wants to hear at 60 km/h.
 */
final class TripPlacesSheet {

    /** What a tap means. The sheet knows the shapes; the activity does the work. */
    interface Actions {
        void navigate(DaemonClient.TripPlace place);
        void addStop(DaemonClient.TripPlace place);
        void answer(DaemonClient.TripPlace place, String answer);
    }

    // Literal ARGB rather than Color.rgb(): these are class constants, and
    // android.graphics.Color is a throwing stub in a plain JVM unit test — one
    // call here made the whole class unloadable from TripPlacesSheetTest.
    private static final int GROUND = 0xFF0C1A16;
    private static final int CARD = 0xFF153028;   // the trip banner's ground
    private static final int BRAND = 0xFF3AE7B0;
    private static final int MUTED = 0xFFA6DCCA;
    private static final int ON_BRAND = 0xFF061A14;
    private static final int HAIRLINE = 0xFF2C5447;

    private TripPlacesSheet() {}

    /** The whole scrollable thread, ready to hand to AlertDialog.setView(). */
    static View build(Context context, List<DaemonClient.TripPlace> places, Actions actions) {
        LinearLayout thread = new LinearLayout(context);
        thread.setOrientation(LinearLayout.VERTICAL);
        thread.setPadding(dp(context, 14), dp(context, 10), dp(context, 14), dp(context, 14));
        thread.setBackgroundColor(GROUND);
        for (DaemonClient.TripPlace place : places) {
            thread.addView(card(context, place, actions), rowParams(context));
        }
        ScrollView scroller = new ScrollView(context);
        scroller.setBackgroundColor(GROUND);
        scroller.addView(thread);
        return scroller;
    }

    private static View card(Context context, DaemonClient.TripPlace place, Actions actions) {
        LinearLayout bubble = new LinearLayout(context);
        bubble.setOrientation(LinearLayout.VERTICAL);
        bubble.setPadding(dp(context, 14), dp(context, 12), dp(context, 14), dp(context, 10));
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(CARD);
        shape.setCornerRadius(dp(context, 14));
        bubble.setBackground(shape);

        TextView heading = new TextView(context);
        heading.setTextColor(Color.WHITE);
        heading.setTextSize(15);
        heading.setTypeface(null, Typeface.BOLD);
        heading.setText(headline(place.place(), place.distanceM()));
        bubble.addView(heading);

        if (!place.task().isBlank()) {
            TextView task = new TextView(context);
            task.setTextColor(MUTED);
            task.setTextSize(13);
            task.setText(place.task());
            task.setPadding(0, dp(context, 2), 0, 0);
            bubble.addView(task);
        }

        String state = stateLine(place.answer(), place.locked(), place.options());
        if (!state.isBlank()) {
            TextView hint = new TextView(context);
            hint.setTextColor(BRAND);
            hint.setTextSize(11);
            hint.setText(state);
            hint.setPadding(0, dp(context, 5), 0, 0);
            bubble.addView(hint);
        }

        LinearLayout links = new LinearLayout(context);
        links.setOrientation(LinearLayout.HORIZONTAL);
        links.setPadding(0, dp(context, 9), 0, 0);
        links.addView(chip(context, "Navegar", false, () -> actions.navigate(place)), chipParams(context, true));
        links.addView(chip(context, "Sumar a la ruta", false, () -> actions.addStop(place)), chipParams(context, false));
        bubble.addView(links);

        // Already answered? Then the question is closed, and re-offering it
        // would invite a second answer that contradicts the first.
        if (place.answer() == null || place.answer().isBlank()) {
            LinearLayout answers = new LinearLayout(context);
            answers.setOrientation(LinearLayout.HORIZONTAL);
            answers.setPadding(0, dp(context, 7), 0, 0);
            answers.addView(chip(context, "Voy", true, () -> actions.answer(place, "go")), chipParams(context, true));
            answers.addView(chip(context, "Hoy no", false, () -> actions.answer(place, "skip")), chipParams(context, false));
            bubble.addView(answers);
        }
        return bubble;
    }

    private static View chip(Context context, String label, boolean primary, Runnable onTap) {
        TextView chip = new TextView(context);
        chip.setText(label);
        chip.setTextSize(13);
        chip.setGravity(Gravity.CENTER);
        chip.setTypeface(null, Typeface.BOLD);
        chip.setPadding(dp(context, 10), dp(context, 9), dp(context, 10), dp(context, 9));
        chip.setTextColor(primary ? ON_BRAND : BRAND);
        GradientDrawable shape = new GradientDrawable();
        shape.setCornerRadius(dp(context, 10));
        if (primary) {
            shape.setColor(BRAND);
        } else {
            shape.setColor(Color.TRANSPARENT);
            shape.setStroke(dp(context, 1), HAIRLINE);
        }
        chip.setBackground(shape);
        chip.setClickable(true);
        chip.setFocusable(true);
        chip.setOnClickListener(ignored -> onTap.run());
        return chip;
    }

    // The label helpers below take plain values rather than a TripPlace on
    // purpose: naming the transport record here would drag its OkHttp static
    // initialiser into every JVM unit test, and what these decide — how far,
    // how settled — has nothing to do with how the row arrived.

    /** "Farmacia Pioneros Km 8 · 1.2 km" — the line the driver reads first. */
    static String headline(String place, int distanceM) {
        String distance = distanceLabel(distanceM);
        return distance.isBlank() ? place : place + " · " + distance;
    }

    static String distanceLabel(int meters) {
        if (meters < 0) return "";
        if (meters >= 1000) return String.format(Locale.getDefault(), "%.1f km", meters / 1000f);
        return meters + " m";
    }

    /**
     * The small print under the errand: what the owner already answered, or —
     * when they have not — whether APX has actually decided where to send them.
     *
     * "3 lugares posibles" is not a hedge, it is the truth: bread can be bought
     * at any of three supermarkets, and the one shown is only the nearest from
     * here until someone settles it.
     */
    static String stateLine(String answer, boolean locked, int options) {
        String said = answer == null ? "" : answer;
        if ("go".equals(said)) return "Dijiste que vas";
        if ("skip".equals(said)) return "Lo dejaste para otro día";
        if (locked) return "Lugar elegido";
        if (options > 1) return options + " lugares posibles · te muestro el más cercano";
        return "";
    }

    private static LinearLayout.LayoutParams rowParams(Context context) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        params.topMargin = dp(context, 8);
        return params;
    }

    private static LinearLayout.LayoutParams chipParams(Context context, boolean first) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0,
            LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        if (!first) params.leftMargin = dp(context, 8);
        return params;
    }

    private static int dp(Context context, int value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }
}
