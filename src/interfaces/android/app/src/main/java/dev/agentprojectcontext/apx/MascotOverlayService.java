package dev.agentprojectcontext.apx;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.res.AssetFileDescriptor;
import android.graphics.PixelFormat;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.WindowManager;

import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

public final class MascotOverlayService extends Service {
    static final String ACTION_STOP = "dev.agentprojectcontext.apx.STOP_MASCOT";
    static final String ACTION_SHOW = "dev.agentprojectcontext.apx.SHOW_MASCOT";
    static final String ACTION_APP_FOREGROUND = "dev.agentprojectcontext.apx.APP_FOREGROUND";
    static final String ACTION_APP_BACKGROUND = "dev.agentprojectcontext.apx.APP_BACKGROUND";
    static final String ACTION_TEST_MESSAGE = "dev.agentprojectcontext.apx.TEST_MESSAGE";
    static final String EXTRA_TEST_MESSAGE = "test_message";
    private static final String SERVICE_CHANNEL = "apx_mascot";
    private static final int SERVICE_NOTIFICATION = 7001;

    // Two reconnect ladders, because the socket is worth two different amounts
    // of battery. On a drive it is the only path a proximity card has, so a
    // drop is repaired in seconds. Parked — which is most of the day — the
    // daemon is often simply not addressable from where the phone is, and
    // redialling it every 15 seconds for eight hours is a couple of thousand
    // radio wakeups that cannot succeed. That is what the battery screen was
    // reporting, and it is the whole reason this app looked expensive.
    private static final long TRIP_MAX_BACKOFF_MS = 15_000L;
    private static final long IDLE_MAX_BACKOFF_MS = 5 * 60_000L;

    private final Handler main = new Handler(Looper.getMainLooper());
    private WindowManager windowManager;
    private WindowManager.LayoutParams params;
    private MascotView mascotView;
    private android.widget.TextView dismissTarget;
    private boolean overDismissTarget;
    private ApxPreferences preferences;
    private WebSocket socket;
    private boolean destroyed;
    private boolean foregroundStarted;
    private boolean appForeground;
    private int reconnectAttempts;
    private ConnectivityManager connectivity;
    private final Runnable reconnect = this::connect;
    private final ConnectivityManager.NetworkCallback networkCallback = new ConnectivityManager.NetworkCallback() {
        @Override public void onAvailable(Network network) {
            // A network arriving is better news than any timer: dial now and
            // drop the ladder, instead of waiting out a backoff that was
            // scheduled while the phone had no way to reach anything.
            main.post(() -> {
                main.removeCallbacks(reconnect);
                reconnectAttempts = 0;
                if (socket == null) connect();
            });
        }

        @Override public void onLost(Network network) {
            // Nothing left to dial. Stop the ladder and wait to be told there
            // is a network again — onAvailable is what restarts it.
            main.post(() -> {
                if (!networkUp()) main.removeCallbacks(reconnect);
            });
        }
    };
    private final BroadcastReceiver travelReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (!preferences.travelActive()) return;
            // Traveller mode just opened. Whatever idle backoff was pending,
            // the socket carries proximity cards now — connect straight away.
            main.removeCallbacks(reconnect);
            reconnectAttempts = 0;
            if (socket == null) connect();
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        preferences = new ApxPreferences(this);
        createChannels();
        connectivity = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        try {
            connectivity.registerDefaultNetworkCallback(networkCallback);
        } catch (RuntimeException unavailable) {
            // Without the callback the ladder is the only way back; it still
            // works, it just cannot wake early.
            android.util.Log.w("APX", "No connectivity callback: " + unavailable.getMessage());
        }
        IntentFilter travel = new IntentFilter(MapsNavigationListenerService.ACTION_TRAVEL_STATE_CHANGED);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(travelReceiver, travel, RECEIVER_NOT_EXPORTED);
        else registerReceiver(travelReceiver, travel);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            preferences.setMascotEnabled(false);
            removeOverlay();
        }
        if (intent != null && ACTION_SHOW.equals(intent.getAction())) {
            preferences.setMascotEnabled(true);
        }
        if (intent != null && ACTION_APP_FOREGROUND.equals(intent.getAction())) appForeground = true;
        if (intent != null && ACTION_APP_BACKGROUND.equals(intent.getAction())) appForeground = false;
        if (!foregroundStarted) {
            startForeground(SERVICE_NOTIFICATION, serviceNotification());
            foregroundStarted = true;
        }
        if (!preferences.paired()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (appForeground || !preferences.mascotEnabled() || !Settings.canDrawOverlays(this)) {
            removeOverlay();
        } else if (mascotView == null) {
            addOverlay();
        }
        if (foregroundStarted) {
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE))
                .notify(SERVICE_NOTIFICATION, serviceNotification());
        }
        if (socket == null) connect();
        if (intent != null && ACTION_TEST_MESSAGE.equals(intent.getAction())) {
            String message = intent.getStringExtra(EXTRA_TEST_MESSAGE);
            main.post(() -> presentMessage(message == null || message.isBlank()
                ? "Prueba APX: aviso directo en Android Auto."
                : message));
        }
        return START_STICKY;
    }

    private void addOverlay() {
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        int width = dp(210);
        int height = dp(225);
        android.util.DisplayMetrics metrics = getResources().getDisplayMetrics();
        int fallbackX = Math.max(0, metrics.widthPixels - width - dp(10));
        int fallbackY = Math.max(0, metrics.heightPixels - height - dp(60));
        params = new WindowManager.LayoutParams(
            width,
            height,
            Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE |
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL |
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.TOP | Gravity.START;
        params.x = preferences.mascotX(fallbackX);
        params.y = preferences.mascotY(fallbackY);

        mascotView = new MascotView(this, preferences.mascotAvatar(), new MascotView.Listener() {
            @Override public void onDragStarted() {
                showDismissTarget();
            }

            @Override public void onMove(float rawX, float rawY, float offsetX, float offsetY) {
                params.x = Math.round(rawX - offsetX);
                params.y = Math.round(rawY - offsetY);
                try { windowManager.updateViewLayout(mascotView, params); } catch (RuntimeException ignored) {}
                updateDismissTarget(rawX, rawY);
            }

            @Override public void onDragEnded(boolean cancelled) {
                boolean dismiss = !cancelled && overDismissTarget;
                hideDismissTarget();
                if (dismiss) {
                    preferences.setMascotEnabled(false);
                    removeOverlay();
                    ((NotificationManager) getSystemService(NOTIFICATION_SERVICE))
                        .notify(SERVICE_NOTIFICATION, serviceNotification());
                } else {
                    preferences.saveMascotPosition(params.x, params.y);
                }
            }

            @Override public void onTapped() {
                openMobile();
            }
        });
        windowManager.addView(mascotView, params);
    }

    private void showDismissTarget() {
        if (dismissTarget != null || windowManager == null) return;
        dismissTarget = new android.widget.TextView(this);
        dismissTarget.setText("×");
        dismissTarget.setTextSize(34);
        dismissTarget.setTextColor(android.graphics.Color.WHITE);
        dismissTarget.setGravity(Gravity.CENTER);
        dismissTarget.setTypeface(null, android.graphics.Typeface.BOLD);
        setDismissTargetActive(false);

        WindowManager.LayoutParams dismissParams = new WindowManager.LayoutParams(
            dp(76),
            dp(76),
            Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE |
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE |
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        );
        dismissParams.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
        dismissParams.y = dp(28);
        try { windowManager.addView(dismissTarget, dismissParams); } catch (RuntimeException ignored) {
            dismissTarget = null;
        }
    }

    private void updateDismissTarget(float rawX, float rawY) {
        if (dismissTarget == null) return;
        android.util.DisplayMetrics metrics = getResources().getDisplayMetrics();
        float targetX = metrics.widthPixels / 2f;
        float targetY = metrics.heightPixels - dp(66);
        boolean active = Math.hypot(rawX - targetX, rawY - targetY) <= dp(92);
        if (active == overDismissTarget) return;
        overDismissTarget = active;
        setDismissTargetActive(active);
        dismissTarget.animate().scaleX(active ? 1.18f : 1f).scaleY(active ? 1.18f : 1f).setDuration(120).start();
    }

    private void setDismissTargetActive(boolean active) {
        if (dismissTarget == null) return;
        android.graphics.drawable.GradientDrawable background = new android.graphics.drawable.GradientDrawable();
        background.setShape(android.graphics.drawable.GradientDrawable.OVAL);
        background.setColor(active
            ? android.graphics.Color.rgb(224, 64, 64)
            : android.graphics.Color.argb(205, 74, 79, 78));
        dismissTarget.setBackground(background);
    }

    private void hideDismissTarget() {
        overDismissTarget = false;
        if (dismissTarget == null || windowManager == null) return;
        try { windowManager.removeView(dismissTarget); } catch (RuntimeException ignored) {}
        dismissTarget = null;
    }

    private void connect() {
        if (destroyed || !preferences.paired()) return;
        Request request = new Request.Builder()
            .url(DaemonAddress.webSocketUrl(preferences.daemonUrl(), preferences.token()))
            .build();
        socket = DaemonClient.HTTP.newWebSocket(request, new WebSocketListener() {
            @Override public void onOpen(WebSocket webSocket, Response response) {
                reconnectAttempts = 0;
            }

            @Override public void onMessage(WebSocket webSocket, String text) {
                handleFrame(text);
            }

            @Override public void onClosed(WebSocket webSocket, int code, String reason) {
                clearAndReconnect(webSocket);
            }

            @Override public void onFailure(WebSocket webSocket, Throwable error, Response response) {
                clearAndReconnect(webSocket);
            }
        });
    }

    private void clearAndReconnect(WebSocket failed) {
        if (socket == failed) socket = null;
        if (destroyed) return;
        if (!networkUp()) {
            // Airplane mode, no signal, Wi-Fi off. Retrying would burn the
            // radio to reach a daemon that is not addressable from here; the
            // connectivity callback wakes us when that changes.
            main.removeCallbacks(reconnect);
            return;
        }
        long ceiling = preferences.travelActive() ? TRIP_MAX_BACKOFF_MS : IDLE_MAX_BACKOFF_MS;
        long delay = Math.min(ceiling, 1_000L << Math.min(reconnectAttempts++, 8));
        main.removeCallbacks(reconnect);
        main.postDelayed(reconnect, delay);
    }

    /**
     * Is there any network at all? Deliberately not a check for internet
     * capability — the daemon usually lives on the LAN or a tailnet, and a
     * Wi-Fi that Android has decided has no internet still reaches it.
     */
    private boolean networkUp() {
        if (connectivity == null) return true;
        try {
            return connectivity.getActiveNetwork() != null;
        } catch (RuntimeException unknown) {
            return true;
        }
    }

    private void handleFrame(String text) {
        String avatar = MessageFrameParser.avatar(text);
        if (avatar != null) {
            preferences.setMascotAvatar(avatar);
            main.post(() -> {
                if (mascotView != null) mascotView.setAvatar(avatar);
            });
        }
        for (String message : MessageFrameParser.notifications(text)) {
            main.post(() -> presentMessage(message));
        }
    }

    private void presentMessage(String message) {
        if (mascotView != null) mascotView.showMessage(message);
        if (preferences.soundEnabled()) playNotificationSound();
        CarMessageNotification.show(this, message);
    }

    private void playNotificationSound() {
        MediaPlayer player = new MediaPlayer();
        player.setAudioAttributes(new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build());
        try (AssetFileDescriptor audio = getResources().openRawResourceFd(R.raw.apx_notification)) {
            player.setDataSource(audio.getFileDescriptor(), audio.getStartOffset(), audio.getLength());
            player.setOnCompletionListener(MediaPlayer::release);
            player.setOnErrorListener((failed, what, extra) -> {
                failed.release();
                return true;
            });
            player.prepare();
            player.start();
            android.util.Log.i("APX", "Message sound started");
        } catch (Exception error) {
            player.release();
            android.util.Log.w("APX", "Could not play message sound", error);
        }
    }

    private void removeOverlay() {
        hideDismissTarget();
        if (mascotView == null || windowManager == null) return;
        try { windowManager.removeView(mascotView); } catch (RuntimeException ignored) {}
        mascotView = null;
    }

    private void createChannels() {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        NotificationChannel service = new NotificationChannel(SERVICE_CHANNEL, getString(R.string.mascot_channel), NotificationManager.IMPORTANCE_LOW);
        service.setDescription("Mantiene mascota APX y conexión local activas.");
        manager.createNotificationChannel(service);
        NotificationChannel messages = new NotificationChannel(CarMessageNotification.CHANNEL, getString(R.string.messages_channel), NotificationManager.IMPORTANCE_HIGH);
        messages.setDescription("Mensajes nuevos recibidos por APX.");
        messages.setSound(null, null);
        manager.createNotificationChannel(messages);
    }

    private Notification serviceNotification() {
        Intent open = new Intent(this, MainActivity.class).putExtra(MainActivity.EXTRA_PATH, "/mobile");
        boolean mascotVisible = preferences.mascotEnabled();
        Intent mascotAction = new Intent(this, MascotOverlayService.class)
            .setAction(mascotVisible ? ACTION_STOP : ACTION_SHOW);
        return new Notification.Builder(this, SERVICE_CHANNEL)
            .setSmallIcon(R.drawable.ic_apx_notification)
            .setContentTitle("APX conectado")
            .setContentText("Mensajes directos y avisos activos")
            .setContentIntent(pendingActivity(open, 1))
            .addAction(new Notification.Action.Builder(
                null,
                mascotVisible ? "Ocultar mascota" : "Mostrar mascota",
                pendingService(mascotAction, mascotVisible ? 2 : 3)
            ).build())
            .setOngoing(true)
            .build();
    }

    private PendingIntent pendingActivity(Intent intent, int requestCode) {
        return PendingIntent.getActivity(this, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private PendingIntent pendingService(Intent intent, int requestCode) {
        return PendingIntent.getService(this, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void openMobile() {
        Intent intent = new Intent(this, MainActivity.class)
            .putExtra(MainActivity.EXTRA_PATH, "/mobile")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(intent);
    }

    @Override
    public void onDestroy() {
        destroyed = true;
        main.removeCallbacksAndMessages(null);
        try { connectivity.unregisterNetworkCallback(networkCallback); } catch (RuntimeException ignored) {}
        try { unregisterReceiver(travelReceiver); } catch (RuntimeException ignored) {}
        if (socket != null) {
            socket.close(1000, "service stopped");
            socket = null;
        }
        removeOverlay();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
