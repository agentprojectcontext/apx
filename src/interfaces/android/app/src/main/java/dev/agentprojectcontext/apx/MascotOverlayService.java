package dev.agentprojectcontext.apx;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.res.AssetFileDescriptor;
import android.graphics.PixelFormat;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
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
    static final String ACTION_APP_FOREGROUND = "dev.agentprojectcontext.apx.APP_FOREGROUND";
    static final String ACTION_APP_BACKGROUND = "dev.agentprojectcontext.apx.APP_BACKGROUND";
    private static final String SERVICE_CHANNEL = "apx_mascot";
    private static final int SERVICE_NOTIFICATION = 7001;

    private final Handler main = new Handler(Looper.getMainLooper());
    private WindowManager windowManager;
    private WindowManager.LayoutParams params;
    private MascotView mascotView;
    private ApxPreferences preferences;
    private WebSocket socket;
    private boolean destroyed;
    private boolean foregroundStarted;
    private int reconnectAttempts;

    @Override
    public void onCreate() {
        super.onCreate();
        preferences = new ApxPreferences(this);
        createChannels();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            preferences.setMascotEnabled(false);
            removeOverlay();
        }
        if (!foregroundStarted) {
            startForeground(SERVICE_NOTIFICATION, serviceNotification());
            foregroundStarted = true;
        }
        if (!preferences.paired()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        boolean appForeground = intent != null && ACTION_APP_FOREGROUND.equals(intent.getAction());
        if (appForeground || !preferences.mascotEnabled() || !Settings.canDrawOverlays(this)) {
            removeOverlay();
        } else if (mascotView == null) {
            addOverlay();
        }
        if (socket == null) connect();
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

        mascotView = new MascotView(this, new MascotView.Listener() {
            @Override public void onMove(float rawX, float rawY, float offsetX, float offsetY) {
                params.x = Math.round(rawX - offsetX);
                params.y = Math.round(rawY - offsetY);
                try { windowManager.updateViewLayout(mascotView, params); } catch (RuntimeException ignored) {}
            }

            @Override public void onPositionCommitted() {
                preferences.saveMascotPosition(params.x, params.y);
            }

            @Override public void onTapped() {
                openMobile();
            }
        });
        windowManager.addView(mascotView, params);
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
        long delay = Math.min(15_000L, 1_000L << Math.min(reconnectAttempts++, 4));
        main.postDelayed(this::connect, delay);
    }

    private void handleFrame(String text) {
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
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
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
        } catch (Exception error) {
            player.release();
            android.util.Log.w("APX", "Could not play message sound", error);
        }
    }

    private void removeOverlay() {
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
        Intent stop = new Intent(this, MascotOverlayService.class).setAction(ACTION_STOP);
        return new Notification.Builder(this, SERVICE_CHANNEL)
            .setSmallIcon(R.drawable.ic_apx_notification)
            .setContentTitle("APX conectado")
            .setContentText("Mensajes directos y avisos activos")
            .setContentIntent(pendingActivity(open, 1))
            .addAction(new Notification.Action.Builder(null, "Ocultar mascota", pendingService(stop, 2)).build())
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
