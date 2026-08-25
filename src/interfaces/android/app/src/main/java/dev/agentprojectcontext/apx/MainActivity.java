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
import android.provider.Settings;
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

import java.net.URI;
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
    private boolean travelReceiverRegistered;
    private boolean waitingForOverlay;
    private String pendingPath = "/mobile";
    private final BroadcastReceiver travelReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            updateTravelBanner();
        }
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
        if (waitingForOverlay) {
            waitingForOverlay = false;
            if (Settings.canDrawOverlays(this)) ensureMascotRunning();
            openMobile("/mobile");
        }
        setMascotAppForeground(true);
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
        travelBanner.setOnClickListener(ignored -> openGoogleMaps());
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
        travelBanner.update(preferences.travelActive(), preferences.travelDestination());
    }

    private void openGoogleMaps() {
        Intent open = getPackageManager().getLaunchIntentForPackage(MapsNavigationDetector.MAPS_PACKAGE);
        if (open != null) startActivity(open);
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
        boolean travelAccess = travelDetectionEnabled();
        String travelAction = !travelAccess
            ? "Activar detección de viajes"
            : preferences.travelActive() ? "✓ Viaje de Maps detectado" : "✓ Detección de viajes activa";
        new AlertDialog.Builder(this)
            .setTitle("APX Android")
            .setItems(new String[]{mascotAction, soundAction, drivingAlertsAction, travelAction, "Probar aviso Android Auto", "Recargar /mobile", "Vincular otro dispositivo"}, (dialog, which) -> {
                if (which == 0) toggleMascot();
                if (which == 1) toggleMessageSound();
                if (which == 2) startActivity(new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS));
                if (which == 3) openTravelDetectionSettings();
                if (which == 4) {
                    Intent test = new Intent(this, MascotOverlayService.class)
                        .setAction(MascotOverlayService.ACTION_TEST_MESSAGE)
                        .putExtra(MascotOverlayService.EXTRA_TEST_MESSAGE, "Prueba APX: aviso directo en Android Auto.");
                    if (Build.VERSION.SDK_INT >= 26) startForegroundService(test); else startService(test);
                    Toast.makeText(this, "Aviso APX enviado", Toast.LENGTH_SHORT).show();
                }
                if (which == 5) openMobile("/mobile");
                if (which == 6) {
                    stopService(new Intent(this, MascotOverlayService.class));
                    preferences.clearPairing();
                    showPairing(null, null, false);
                }
            })
            .setNegativeButton("Cerrar", null)
            .show();
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
