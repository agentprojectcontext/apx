package dev.agentprojectcontext.apx;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.NotificationManager;
import android.service.notification.NotificationListenerService;
import android.content.Intent;
import android.content.ComponentName;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.net.URI;
import java.util.List;
import java.util.UUID;

public final class MainActivity extends Activity {
    static final String EXTRA_PATH = "open_path";
    static final String EXTRA_SETTINGS = "show_settings";
    private static final int OVERLAY_REQUEST = 401;
    private static final int NOTIFICATION_REQUEST = 402;
    private static final int LOCATION_REQUEST = 403;
    private static final int GREEN = Color.rgb(58, 231, 176);
    private static final int PANEL = Color.rgb(20, 27, 25);

    private ApxPreferences preferences;
    private WebView webView;
    private TravelStatusBanner travelBanner;
    // -1 = not asked yet. The banner must not print "0 pendientes" before the
    // daemon has answered.
    private int tripPlaceCount = -1;
    private boolean travelReceiverRegistered;
    private boolean waitingForOverlay;
    private String pendingPath = "/mobile";
    private final BroadcastReceiver travelReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            updateTravelBanner();
        }
    };
    private final Runnable tripPlaceRecheck = () -> {
        if (preferences.travelActive()) refreshTripPlaceCount();
    };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        preferences = new ApxPreferences(this);
        getWindow().setStatusBarColor(Color.rgb(13, 17, 16));
        getWindow().setNavigationBarColor(Color.rgb(13, 17, 16));
        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (handleMapsShare(intent)) return;
        String requestedPath = intent.getStringExtra(EXTRA_PATH);
        if (requestedPath != null && requestedPath.startsWith("/mobile")) pendingPath = requestedPath;
        Uri data = intent.getData();
        if (data != null && "apx".equals(data.getScheme()) && "pair".equals(data.getHost())) {
            showPairing(data.getQueryParameter("url"), data.getQueryParameter("pid"), true);
            return;
        }
        if (intent.getBooleanExtra(EXTRA_SETTINGS, false)) {
            showNativeMenu();
            return;
        }
        if (preferences.paired()) {
            requestLocationPermission();
            openMobile(pendingPath);
            ensureMascotRunning();
        } else {
            showPairing(null, null, false);
        }
    }

    private boolean handleMapsShare(Intent intent) {
        if (!Intent.ACTION_SEND.equals(intent.getAction()) || !"text/plain".equals(intent.getType())) return false;
        CharSequence shared = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (!MapsShareIntentParser.isGoogleMapsShare(shared)) {
            Toast.makeText(this, "APX necesita un viaje compartido desde Maps", Toast.LENGTH_LONG).show();
            return true;
        }
        if (!preferences.paired()) {
            Toast.makeText(this, "Vinculá APX antes de compartir el viaje", Toast.LENGTH_LONG).show();
            showPairing(null, null, false);
            return true;
        }

        String destination = MapsShareIntentParser.destinationFrom(shared);
        String tripId = preferences.travelActive() && !preferences.travelTripId().isBlank()
            ? preferences.travelTripId()
            : UUID.randomUUID().toString();
        boolean suppressed = TravelEventGate.coolingDown(
            System.currentTimeMillis(),
            destination,
            preferences.travelLastSentAt(),
            preferences.travelLastSentDestination()
        );
        preferences.setTravelState(true, destination, tripId);
        if (suppressed) {
            preferences.setTravelEventSent(true);
        } else {
            preferences.recordTravelEventSent(destination);
            DaemonClient.notifyTripStarted(
                preferences.daemonUrl(),
                preferences.token(),
                tripId,
                destination,
                DeviceLocation.latest(this)
            );
        }
        sendBroadcast(new Intent(MapsNavigationListenerService.ACTION_TRAVEL_STATE_CHANGED).setPackage(getPackageName()));
        Toast.makeText(
            this,
            suppressed ? "Viaje actualizado; Roby no repetirá el aviso" : "Viaje compartido con APX",
            Toast.LENGTH_LONG
        ).show();
        intent.setAction(Intent.ACTION_MAIN);
        intent.removeExtra(Intent.EXTRA_TEXT);
        requestLocationPermission();
        openMobile(pendingPath);
        ensureMascotRunning();
        return true;
    }

    private void showPairing(String suggestedUrl, String suggestedCode, boolean autoSubmit) {
        webView = null;
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setPadding(dp(28), dp(56), dp(28), dp(24));
        root.setBackgroundColor(Color.rgb(13, 17, 16));

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.apx_logo);
        logo.setContentDescription("APX");
        logo.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        LinearLayout.LayoutParams logoParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(112)
        );
        logoParams.bottomMargin = dp(16);
        root.addView(logo, logoParams);

        TextView title = text("APX Android", 28, Color.WHITE);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        root.addView(title, matchWrap());

        TextView info = text("Conectá esta app al daemon. Ejecutá “apx pair web” y pegá código mostrado.", 15, Color.LTGRAY);
        info.setPadding(0, dp(12), 0, dp(24));
        root.addView(info, matchWrap());

        EditText url = input("http://IP:7430");
        url.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        String currentUrl = suggestedUrl != null ? suggestedUrl : preferences.daemonUrl();
        url.setText(currentUrl);
        root.addView(url, matchWrap());

        EditText code = input("Código pairing");
        code.setText(suggestedCode == null ? "" : suggestedCode);
        LinearLayout.LayoutParams codeParams = matchWrap();
        codeParams.topMargin = dp(12);
        root.addView(code, codeParams);

        TextView status = text("", 14, Color.LTGRAY);
        status.setPadding(0, dp(14), 0, dp(8));
        root.addView(status, matchWrap());

        ProgressBar progress = new ProgressBar(this);
        progress.setVisibility(View.GONE);
        root.addView(progress, new LinearLayout.LayoutParams(dp(38), dp(38)));

        Button pair = button("Vincular y abrir");
        root.addView(pair, matchWrap());
        setContentView(root);

        View.OnClickListener submit = ignored -> {
            String base;
            try {
                base = DaemonAddress.normalize(url.getText().toString());
            } catch (IllegalArgumentException error) {
                status.setText(error.getMessage());
                status.setTextColor(Color.rgb(255, 130, 130));
                return;
            }
            String pairingId = code.getText().toString().trim();
            if (pairingId.isBlank()) {
                status.setText("Ingresá código pairing.");
                status.setTextColor(Color.rgb(255, 130, 130));
                return;
            }
            pair.setEnabled(false);
            progress.setVisibility(View.VISIBLE);
            status.setText("Vinculando…");
            status.setTextColor(Color.LTGRAY);
            String label = "APX Android · " + Build.MANUFACTURER + " " + Build.MODEL;
            DaemonClient.pair(base, pairingId, label, new DaemonClient.PairCallback() {
                @Override public void onSuccess(String token) {
                    runOnUiThread(() -> {
                        preferences.savePairing(base, token);
                        status.setText("Vinculado.");
                        status.setTextColor(GREEN);
                        requestNativePermissionsAndOpen();
                    });
                }

                @Override public void onError(String message) {
                    runOnUiThread(() -> {
                        pair.setEnabled(true);
                        progress.setVisibility(View.GONE);
                        status.setText(message);
                        status.setTextColor(Color.rgb(255, 130, 130));
                    });
                }
            });
        };
        pair.setOnClickListener(submit);
        if (autoSubmit && suggestedUrl != null && suggestedCode != null) pair.post(pair::performClick);
    }

    private void requestNativePermissionsAndOpen() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_REQUEST);
        }
        if (!Settings.canDrawOverlays(this)) {
            waitingForOverlay = true;
            Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName()));
            startActivityForResult(intent, OVERLAY_REQUEST);
            return;
        }
        requestLocationPermission();
        ensureMascotRunning();
        openMobile("/mobile");
    }

    private void requestLocationPermission() {
        if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) return;
        requestPermissions(new String[]{
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.ACCESS_FINE_LOCATION,
        }, LOCATION_REQUEST);
    }

    @Override
    protected void onResume() {
        super.onResume();
        NotificationListenerService.requestRebind(new ComponentName(
            this,
            MapsNavigationListenerService.class
        ));
        // A foreground-service start is only guaranteed to be allowed while an
        // activity is visible, and some OEM power managers refuse it outright
        // from the notification listener. This is the one moment the trip's GPS
        // service can always be (re)started, so take it: a trip flagged active
        // with nothing tracking is a trip the daemon hears nothing from.
        // Starting an already-running service is a no-op.
        if (preferences.travelActive() && !preferences.travelTripId().isBlank()) {
            TripLocationService.start(this, preferences.travelTripId());
        }
        if (waitingForOverlay) {
            waitingForOverlay = false;
            if (Settings.canDrawOverlays(this)) ensureMascotRunning();
            openMobile("/mobile");
        }
        setMascotAppForeground(true);
        // The embedded /mobile is a live React app: its own socket, its
        // timers, its animations. Android does not stop any of that when the
        // activity goes away, so leaving APX by the home button used to leave a
        // full web app running behind the launcher for as long as the process
        // survived. Resume it here, pause it in onPause, and off screen the
        // WebView costs nothing.
        if (webView != null) {
            webView.onResume();
            webView.resumeTimers();
        }
        updateTravelBanner();
    }

    @Override
    protected void onStart() {
        super.onStart();
        IntentFilter filter = new IntentFilter(MapsNavigationListenerService.ACTION_TRAVEL_STATE_CHANGED);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(travelReceiver, filter, RECEIVER_NOT_EXPORTED);
        else registerReceiver(travelReceiver, filter);
        travelReceiverRegistered = true;
    }

    @Override
    protected void onStop() {
        if (travelReceiverRegistered) {
            unregisterReceiver(travelReceiver);
            travelReceiverRegistered = false;
        }
        super.onStop();
    }

    @Override
    protected void onPause() {
        setMascotAppForeground(false);
        if (webView != null) {
            webView.onPause();
            // pauseTimers() is process-wide and there is exactly one WebView
            // here; it is what actually stops the JavaScript, where onPause()
            // alone only stops drawing.
            webView.pauseTimers();
        }
        super.onPause();
    }

    private void ensureMascotRunning() {
        if (!preferences.paired()) return;
        Intent service = new Intent(this, MascotOverlayService.class);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(service); else startService(service);
    }

    private void setMascotAppForeground(boolean foreground) {
        if (!preferences.paired()) return;
        Intent service = new Intent(this, MascotOverlayService.class)
            .setAction(foreground ? MascotOverlayService.ACTION_APP_FOREGROUND : MascotOverlayService.ACTION_APP_BACKGROUND);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(service); else startService(service);
    }

    private void openMobile(String path) {
        if (!preferences.paired()) {
            showPairing(null, null, false);
            return;
        }
        LinearLayout frame = new LinearLayout(this);
        frame.setOrientation(LinearLayout.VERTICAL);
        frame.setBackgroundColor(Color.rgb(13, 17, 16));
        frame.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(0, insets.getSystemWindowInsetTop(), 0, 0);
            return insets;
        });
        travelBanner = new TravelStatusBanner(this);
        travelBanner.setOnClickListener(ignored -> showTripPlaces());
        LinearLayout.LayoutParams bannerParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        );
        frame.addView(travelBanner, bannerParams);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(13, 17, 16));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        settings.setUserAgentString(settings.getUserAgentString() + " APXAndroid/0.1");
        webView.addJavascriptInterface(new AndroidBridge(), "APXAndroid");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri target = request.getUrl();
                try {
                    URI base = URI.create(preferences.daemonUrl());
                    if (base.getHost().equalsIgnoreCase(target.getHost())) return false;
                } catch (Exception ignored) {}
                startActivity(new Intent(Intent.ACTION_VIEW, target));
                return true;
            }
        });
        frame.addView(webView, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0,
            1f
        ));
        setContentView(frame);
        updateTravelBanner();

        String safePath = path != null && path.startsWith("/mobile") ? path : "/mobile";
        String target = preferences.daemonUrl() + safePath + "#token=" + Uri.encode(preferences.token());
        webView.loadUrl(target);
    }

    private void updateTravelBanner() {
        if (travelBanner == null) return;
        travelBanner.update(
            preferences.travelActive(),
            preferences.travelDestination(),
            preferences.travelSource(),
            tripPlaceCount
        );
        if (preferences.travelActive()) {
            refreshTripPlaceCount();
            scheduleTripPlaceRecheck();
        } else {
            travelBanner.removeCallbacks(tripPlaceRecheck);
            tripPlaceCount = -1;
        }
    }

    /**
     * Keep the banner's count honest without making the driver tap to find out.
     * Best-effort and silent: a count that could not be fetched shows as
     * "Ver pendientes", never as zero — claiming there is nothing to stop for
     * because the network was down is the one wrong answer here.
     */
    private void refreshTripPlaceCount() {
        DaemonClient.fetchTripPlaces(preferences.daemonUrl(), preferences.token(), new DaemonClient.TripCallback() {
            @Override
            public void onTrip(java.util.List<DaemonClient.TripPlace> places) {
                runOnUiThread(() -> {
                    tripPlaceCount = places.size();
                    if (travelBanner != null) {
                        travelBanner.update(
                            preferences.travelActive(),
                            preferences.travelDestination(),
                            preferences.travelSource(),
                            tripPlaceCount
                        );
                    }
                });
            }

            @Override
            public void onError(String message) {
                Log.i("APXTravel", "Could not read trip places: " + message);
            }
        });
    }

    /**
     * The daemon's list fills in asynchronously — it only knows what is nearby
     * once a GPS sample has reached it and the place search has answered. Asking
     * once, the instant a trip opens, reliably gets "nothing nearby" for a trip
     * that is about to have plenty, so ask again shortly after. One retry: this
     * is a label, not a poll.
     */
    private void scheduleTripPlaceRecheck() {
        if (travelBanner == null) return;
        // Exactly one pending recheck. This runs on every banner update — every
        // resume and every travel broadcast — and posting a fresh timer each
        // time queued a stack of them that all fired at once.
        travelBanner.removeCallbacks(tripPlaceRecheck);
        travelBanner.postDelayed(tripPlaceRecheck, 20_000L);
    }

    /**
     * The list behind the banner: every errand APX is watching on this trip,
     * nearest first, each openable in Maps. This replaced an "Abrir Maps"
     * shortcut that led nowhere useful — Maps is already open, it is where the
     * trip is being read from.
     */
    private void showTripPlaces() {
        Toast.makeText(this, "Buscando pendientes del viaje…", Toast.LENGTH_SHORT).show();
        DaemonClient.fetchTripPlaces(preferences.daemonUrl(), preferences.token(), new DaemonClient.TripCallback() {
            @Override
            public void onTrip(java.util.List<DaemonClient.TripPlace> places) {
                runOnUiThread(() -> renderTripPlaces(places));
            }

            @Override
            public void onError(String message) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show());
            }
        });
    }

    /**
     * The errands, as the thread of cards TripPlacesSheet builds — one card per
     * errand carrying the same four chips the Telegram card offers.
     *
     * It was an AlertDialog.setItems() list before, where a tap could only mean
     * "open in Maps". That made the phone strictly worse than the chat for the
     * same information: no way to say "voy", no way to add a stop without
     * losing the current route.
     */
    private void renderTripPlaces(java.util.List<DaemonClient.TripPlace> places) {
        tripPlaceCount = places.size();
        updateTravelBanner();
        if (places.isEmpty()) {
            new AlertDialog.Builder(this)
                .setTitle("Pendientes del viaje")
                .setMessage("Por ahora no hay ningún mandado cerca de este viaje.\n\nAPX mira las tareas abiertas que nombran algo físico — farmacia, supermercado, ferretería, nafta — y busca lugares en el camino.")
                .setPositiveButton("Cerrar", null)
                .show();
            return;
        }
        AlertDialog[] open = new AlertDialog[1];
        TripPlacesSheet.Actions actions = new TripPlacesSheet.Actions() {
            @Override
            public void navigate(DaemonClient.TripPlace place) {
                openInMaps(place.mapsUrl());
            }

            @Override
            public void addStop(DaemonClient.TripPlace place) {
                // Falls back to plain navigation when the daemon had no
                // destination to add a stop to — see addToRouteUrl.
                String url = place.addStopUrl() == null || place.addStopUrl().isBlank()
                    ? place.mapsUrl() : place.addStopUrl();
                openInMaps(url);
            }

            @Override
            public void answer(DaemonClient.TripPlace place, String answer) {
                answerErrand(place, answer);
                // Closed on the answer: the sheet is a snapshot, and leaving it
                // open would keep showing chips for a question just settled.
                if (open[0] != null) open[0].dismiss();
            }
        };
        open[0] = new AlertDialog.Builder(this)
            .setTitle("Pendientes del viaje")
            .setView(TripPlacesSheet.build(this, places, actions))
            .setNegativeButton("Cerrar", null)
            .create();
        open[0].show();
    }

    /**
     * Send one "voy" / "hoy no" to the daemon, which records it exactly as the
     * Telegram chip would. Confirmed with a toast because the sheet closes: a
     * tap with no visible consequence reads as a tap that did not register.
     */
    private void answerErrand(DaemonClient.TripPlace place, String answer) {
        String said = "go".equals(answer) ? "Anotado: vas." : "Listo, hoy no.";
        DaemonClient.answerErrand(
            preferences.daemonUrl(), preferences.token(), place.taskId(), answer,
            new DaemonClient.AnswerCallback() {
                @Override
                public void onAnswered() {
                    runOnUiThread(() -> {
                        Toast.makeText(MainActivity.this, said, Toast.LENGTH_SHORT).show();
                        refreshTripPlaceCount();
                    });
                }

                @Override
                public void onAnswerFailed(String message) {
                    runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show());
                }
            });
    }

    /** Hand one Maps URL to Maps. Falls back to any map app. */
    private void openInMaps(String url) {
        if (url == null || url.isBlank()) return;
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        open.setPackage(MapsNavigationDetector.MAPS_PACKAGE);
        if (open.resolveActivity(getPackageManager()) == null) open.setPackage(null);
        try {
            startActivity(open);
        } catch (RuntimeException noHandler) {
            Toast.makeText(this, "No hay ninguna app de mapas para abrirlo.", Toast.LENGTH_LONG).show();
        }
    }

    private final class AndroidBridge {
        @JavascriptInterface
        public void openOptions() {
            runOnUiThread(MainActivity.this::showNativeMenu);
        }

        @JavascriptInterface
        public boolean notificationsEnabled() {
            NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            boolean permissionGranted = Build.VERSION.SDK_INT < 33 ||
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
            return permissionGranted && manager.areNotificationsEnabled();
        }

        @JavascriptInterface
        public void openNotificationSettings() {
            runOnUiThread(() -> startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName())));
        }

        /**
         * The five channels and whether each may ring, as JSON.
         *
         * Resolved here, not raw storage: the panel gets the ANSWER for every
         * channel, defaults filled in, so it never has to know that Telegram
         * starts off on a phone. One rule, one place — NotifyChannels.
         *
         * A string and not an object because a WebView bridge only carries
         * primitives across.
         */
        @JavascriptInterface
        public String notifyChannels() {
            JSONObject out = new JSONObject();
            try {
                for (String channel : NotifyChannels.ALL) {
                    out.put(channel, preferences.notifyChannelEnabled(channel));
                }
            } catch (Exception ignored) {
                // A JSONObject of five booleans does not throw; if it somehow
                // did, an empty answer leaves the panel showing nothing rather
                // than a wrong tick.
            }
            return out.toString();
        }

        /** The panel's own tick, written to the same store the menu writes. */
        @JavascriptInterface
        public void setNotifyChannel(String channel, boolean on) {
            preferences.setNotifyChannelEnabled(channel, on);
        }
    }

    private void showNativeMenu() {
        if (!preferences.paired()) {
            showPairing(null, null, false);
            return;
        }
        String mascotAction = preferences.mascotEnabled() ? "Desactivar mascota" : "Activar mascota";
        String soundAction = preferences.soundEnabled() ? "✓ Sonido de mensajes" : "Sonido de mensajes";
        NotificationManager notificationManager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        String drivingAlertsAction = notificationManager.isNotificationPolicyAccessGranted()
            ? "✓ Avisos durante conducción"
            : "Permitir avisos durante conducción";
        String batteryAction = batteryUnrestricted()
            ? "✓ Batería sin restricciones"
            : "Quitar restricción de batería";
        boolean travelAccess = travelDetectionEnabled();
        String travelAction = !travelAccess
            ? "Activar detección de viajes"
            : !preferences.travelActive() ? "✓ Detección de viajes activa"
            : ApxPreferences.SOURCE_ANDROID_AUTO.equals(preferences.travelSource())
                ? "✓ Android Auto conectado"
                : "✓ Viaje de Maps detectado";
        new AlertDialog.Builder(this)
            .setTitle("APX Android")
            .setItems(new String[]{mascotAction, soundAction, notifyChannelsAction(), drivingAlertsAction, batteryAction, travelAction, "Probar aviso Android Auto", "Recargar /mobile", "Vincular otro dispositivo"}, (dialog, which) -> {
                if (which == 0) toggleMascot();
                if (which == 1) toggleMessageSound();
                if (which == 2) showNotifyChannels();
                if (which == 3) startActivity(new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS));
                if (which == 4) openBatterySettings();
                if (which == 5) openTravelDetectionSettings();
                if (which == 6) {
                    Intent test = new Intent(this, MascotOverlayService.class)
                        .setAction(MascotOverlayService.ACTION_TEST_MESSAGE)
                        .putExtra(MascotOverlayService.EXTRA_TEST_MESSAGE, "Prueba APX: aviso directo en Android Auto.");
                    if (Build.VERSION.SDK_INT >= 26) startForegroundService(test); else startService(test);
                    Toast.makeText(this, "Aviso APX enviado", Toast.LENGTH_SHORT).show();
                }
                if (which == 7) openMobile("/mobile");
                if (which == 8) {
                    stopService(new Intent(this, MascotOverlayService.class));
                    preferences.clearPairing();
                    showPairing(null, null, false);
                }
            })
            .setNegativeButton("Cerrar", null)
            .show();
    }

    /** Is APX exempt from Doze / App Standby right now? */
    private boolean batteryUnrestricted() {
        PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
        return power != null && power.isIgnoringBatteryOptimizations(getPackageName());
    }

    /**
     * Hand the battery-optimisation decision to the owner, on the phone.
     *
     * It is theirs to make: the exemption is what stops Android deferring the
     * trip's start and end while the phone is in a pocket, and it is also the
     * one switch that lets APX cost battery when it is idle. So the app asks
     * and never assumes — the direct dialog while APX is still restricted, and
     * the system list once it is exempt, which is where the exemption can be
     * taken back. Some OEM builds ship neither screen; fall back to the app's
     * own details page rather than crashing on a missing activity.
     */
    private void openBatterySettings() {
        Intent request = batteryUnrestricted()
            ? new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            : new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName()));
        try {
            startActivity(request);
            return;
        } catch (RuntimeException noScreen) {
            Log.w("APX", "No battery optimisation screen: " + noScreen.getMessage());
        }
        try {
            startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
        } catch (RuntimeException noDetails) {
            Toast.makeText(this, "Este Android no expone el ajuste de batería.", Toast.LENGTH_LONG).show();
        }
    }

    private boolean travelDetectionEnabled() {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 27) {
            return manager.isNotificationListenerAccessGranted(
                new ComponentName(this, MapsNavigationListenerService.class)
            );
        }
        String enabled = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
        return enabled != null && enabled.contains(getPackageName());
    }

    private void openTravelDetectionSettings() {
        startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));
    }

    /** How many of the five are on, said on the row itself: the menu answers
     *  "is something muted" without being opened. */
    private String notifyChannelsAction() {
        int on = 0;
        for (String channel : NotifyChannels.ALL) {
            if (preferences.notifyChannelEnabled(channel)) on++;
        }
        return on == NotifyChannels.ALL.size()
            ? "Avisarme de todo"
            : "Avisarme de… (" + on + " de " + NotifyChannels.ALL.size() + ")";
    }

    /**
     * Which kinds of news may interrupt — as ticks, because that is the shape
     * of the question: five independent yes/nos, all visible at once, no order
     * and no priority between them.
     *
     * Applied on the spot rather than on a Save button. Each tick is complete
     * on its own, and the next bubble either arrives or does not, which is the
     * fastest way to find out whether the box you just ticked is the one you
     * meant. The muted channels keep every message in /mobile — this only
     * decides what jumps at you.
     */
    private void showNotifyChannels() {
        List<String> channels = NotifyChannels.ALL;
        String[] labels = new String[channels.size()];
        boolean[] checked = new boolean[channels.size()];
        for (int i = 0; i < channels.size(); i++) {
            labels[i] = NotifyChannels.label(channels.get(i));
            checked[i] = preferences.notifyChannelEnabled(channels.get(i));
        }
        new AlertDialog.Builder(this)
            .setTitle("Avisarme de")
            .setMultiChoiceItems(labels, checked, (dialog, which, on) -> {
                preferences.setNotifyChannelEnabled(channels.get(which), on);
                pushNotifyChannelsToPanel();
            })
            .setPositiveButton("Listo", null)
            .show();
    }

    /**
     * Tell the page what the menu just changed.
     *
     * The panel shows the same five switches (PanelPrefs.tsx) and reads them
     * through the bridge, so a WebView already on screen behind this dialog
     * would otherwise keep painting the answer from before the tick. One event,
     * same as the panel fires for its own writes.
     */
    private void pushNotifyChannelsToPanel() {
        if (webView == null) return;
        webView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('apx:native-notify-channels'))",
            null
        );
    }

    private void toggleMessageSound() {
        boolean enabled = !preferences.soundEnabled();
        preferences.setSoundEnabled(enabled);
        Toast.makeText(this, enabled ? "Sonido activado" : "Sonido silenciado", Toast.LENGTH_SHORT).show();
    }

    private void toggleMascot() {
        boolean enabled = !preferences.mascotEnabled();
        preferences.setMascotEnabled(enabled);
        if (!enabled) {
            ensureMascotRunning();
            Toast.makeText(this, "Mascota desactivada", Toast.LENGTH_SHORT).show();
            return;
        }
        if (!Settings.canDrawOverlays(this)) {
            waitingForOverlay = true;
            startActivityForResult(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName())), OVERLAY_REQUEST);
            return;
        }
        ensureMascotRunning();
        Toast.makeText(this, "Mascota activada", Toast.LENGTH_SHORT).show();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack(); else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        travelBanner = null;
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }

    private EditText input(String hint) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setHintTextColor(Color.GRAY);
        input.setTextColor(Color.WHITE);
        input.setSingleLine(true);
        input.setPadding(dp(14), dp(12), dp(14), dp(12));
        input.setBackgroundColor(PANEL);
        return input;
    }

    private Button button(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(Color.rgb(10, 20, 17));
        button.setBackgroundColor(GREEN);
        button.setAllCaps(false);
        return button;
    }

    private TextView text(String value, int sp, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(color);
        return view;
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
