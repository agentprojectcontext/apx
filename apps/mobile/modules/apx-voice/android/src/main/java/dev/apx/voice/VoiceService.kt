package dev.apx.voice

import android.app.ActivityManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings as AndroidSettings
import android.util.Base64
import android.util.Log
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Keeps the voice alive with the app closed: listens for its name (when the owner turned that on) and carries the call
 * it opens, from the lock screen too. A foreground service, so the system shows the microphone is in use.
 */
class VoiceService : Service() {
  private val main = Handler(Looper.getMainLooper())
  private val work = Executors.newSingleThreadExecutor()
  private lateinit var settings: Settings
  private var wake: WakeListener? = null
  private var call: CallSession? = null
  private var lock: PowerManager.WakeLock? = null
  @Volatile private var checking = false
  private var lastCheck = 0L

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    settings = Settings(this)
    channels()
    current = this
  }

  override fun onDestroy() {
    current = null
    wake?.stop()
    call?.hangUp()
    lock?.let { if (it.isHeld) it.release() }
    work.shutdownNow()
    VoiceState.set(phase = "off")
    super.onDestroy()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (!foreground()) {
      stopSelf()
      return START_NOT_STICKY
    }
    when (intent?.action) {
      ACTION_CALL -> startCall(intent.getStringExtra("mode") ?: "call", intent.getStringExtra("agent"),
        intent.getStringExtra("thread"), intent.getBooleanExtra("full", true))
      ACTION_HANGUP -> call?.hangUp()
      ACTION_STOP_WAKE -> {
        settings.wake = false
        settle()
      }
      else -> settle()
    }
    return START_STICKY
  }

  /** Listening for its name when it should, between calls; nothing to do and the service goes. */
  private fun settle() {
    if (call != null) return
    if (settings.wake && settings.paired()) {
      listen()
      notify(notification(false))
    } else {
      wake?.stop()
      wake = null
      VoiceState.set(phase = "off")
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
    }
  }

  private fun listen() {
    if (wake?.running() == true) return
    if (lock == null) {
      lock = (getSystemService(Context.POWER_SERVICE) as PowerManager)
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "apx:voice-wake").apply { setReferenceCounted(false) }
    }
    lock?.acquire(12 * 60 * 60 * 1000L)
    wake = WakeListener { clip, ms -> check(clip, ms) }.also { it.start() }
    VoiceState.set(phase = "wake")
    main.removeCallbacks(warm)
    main.post(warm)
  }

  /** The computer's ears unload after a while unused: a short quiet clip now and then keeps the name heard at once. */
  private val warm: Runnable = object : Runnable {
    override fun run() {
      if (wake?.running() != true) return
      val quiet = WakeListener.wav(ByteArray(WakeListener.RATE)) // half a second of silence
      work.execute {
        val core = Core(settings.url, settings.token)
        try {
          core.call("voice.wake",
            JSONObject().put("data", Base64.encodeToString(quiet, Base64.NO_WRAP)).put("mime", "audio/wav"), timeoutS = 30)
        } catch (_: Exception) {}
        // The greeting played the moment the name is heard follows the owner's voice and language.
        Greeting.refresh(this@VoiceService, core)
      }
      main.postDelayed(this, 7 * 60 * 1000L)
    }
  }

  /** Asks the core whether a short clip was the voice's name; one at a time, not more than one every 1.2 s. */
  private fun check(clip: ByteArray, ms: Int) {
    val now = System.currentTimeMillis()
    if (checking || now - lastCheck < 1200 || call != null) return
    checking = true
    lastCheck = now
    work.execute {
      try {
        val core = Core(settings.url, settings.token)
        val r = core.call("voice.wake",
          JSONObject().put("data", Base64.encodeToString(clip, Base64.NO_WRAP)).put("mime", "audio/wav"), timeoutS = 30)
        Log.d(TAG, "wake check ${ms}ms: ${r.optBoolean("awake")} \"${r.optString("text")}\"")
        if (r.optBoolean("awake")) main.post { startCall("quick", null, null, false, greet = true) }
      } catch (e: Exception) {
        Log.d(TAG, "wake check failed: $e")
      } finally {
        checking = false
      }
    }
  }

  private fun startCall(mode: String, agent: String?, thread: String?, full: Boolean, greet: Boolean = false) {
    if (call != null) {
      show(full)
      return
    }
    if (!settings.paired()) return settle()
    wake?.stop()
    wake = null
    main.removeCallbacks(warm)
    notify(notification(true))
    show(full)
    // The wake listener lets go of the microphone before the call takes it.
    main.postDelayed({
      val greeting = if (greet) Greeting.load(this) else null
      call = CallSession(this, Core(settings.url, settings.token), mode, agent, thread, greeting) { reason ->
        main.post {
          call = null
          Log.i(TAG, "back from the call: $reason")
          main.postDelayed({ if (call == null) settle() }, 700)
        }
      }.also { it.start() }
    }, 250)
  }

  /** The call's screen: a floating card for a request said by name, the phone-call screen otherwise. */
  private fun show(full: Boolean) {
    val i = Intent(this, CallActivity::class.java)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      .putExtra("full", full)
    val front = ActivityManager.RunningAppProcessInfo().also { ActivityManager.getMyMemoryState(it) }.importance <=
      ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
    val canPop = front || Build.VERSION.SDK_INT < 23 || AndroidSettings.canDrawOverlays(this) || CallActivity.visible
    if (canPop) {
      try {
        startActivity(i)
        return
      } catch (e: Exception) {
        Log.w(TAG, "call screen: $e")
      }
    }
    // Without "display over other apps" the system lets a full-screen notice open it (always on the lock screen).
    val pi = PendingIntent.getActivity(this, 2, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val n = Notification.Builder(this, CHANNEL_CALL)
      .setSmallIcon(R.drawable.apx_voice_phone)
      .setContentTitle(settings.agentName.ifEmpty { "APX" })
      .setContentText(settings.label("listening", "Listening…"))
      .setCategory(Notification.CATEGORY_CALL)
      .setFullScreenIntent(pi, true)
      .setContentIntent(pi)
      .setAutoCancel(true)
      .build()
    (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(ID_POP, n)
  }

  private fun foreground(): Boolean = try {
    val n = notification(call != null)
    if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
    else startForeground(ID, n)
    true
  } catch (e: Exception) {
    // Android lets a microphone service start only while the app is on screen.
    Log.w(TAG, "foreground: $e")
    false
  }

  private fun notify(n: Notification) = (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(ID, n)

  private fun notification(inCall: Boolean): Notification {
    val open = packageManager.getLaunchIntentForPackage(packageName)
      ?.let { PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE) }
    val name = settings.agentName.ifEmpty { "APX" }
    val b = Notification.Builder(this, CHANNEL)
      .setSmallIcon(if (inCall) R.drawable.apx_voice_phone else R.drawable.apx_voice_mic)
      .setOngoing(true)
      .setContentIntent(open)
      .setContentTitle(if (inCall) settings.label("inCallTitle", "Talking with {name}").replace("{name}", name)
        else settings.label("wakeTitle", "Say \"ok {name}\"").replace("{name}", name))
      .setContentText(if (inCall) settings.label("inCallText", "By voice") else settings.label("wakeText", "Listening for its name"))
    val action = if (inCall) ACTION_HANGUP else ACTION_STOP_WAKE
    val pi = PendingIntent.getService(this, if (inCall) 1 else 3, Intent(this, VoiceService::class.java).setAction(action),
      PendingIntent.FLAG_IMMUTABLE)
    b.addAction(Notification.Action.Builder(null, if (inCall) settings.label("hangUp", "Hang up")
      else settings.label("stopWake", "Stop listening"), pi).build())
    return b.build()
  }

  private fun channels() {
    val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    nm.createNotificationChannel(NotificationChannel(CHANNEL, settings.label("channel", "Voice"), NotificationManager.IMPORTANCE_LOW))
    nm.createNotificationChannel(NotificationChannel(CHANNEL_CALL, settings.label("channelCall", "Voice requests"),
      NotificationManager.IMPORTANCE_HIGH))
  }

  fun hangUp() = call?.hangUp()
  fun mute(on: Boolean) = call?.setMuted(on)

  companion object {
    const val TAG = "apx-voice"
    const val ACTION_CALL = "dev.apx.voice.CALL"
    const val ACTION_HANGUP = "dev.apx.voice.HANGUP"
    const val ACTION_STOP_WAKE = "dev.apx.voice.STOP_WAKE"
    const val CHANNEL = "apx-voice"
    const val CHANNEL_CALL = "apx-voice-call"
    const val ID = 7441
    const val ID_POP = 7442
    @Volatile var current: VoiceService? = null

    fun start(context: Context, intent: Intent = Intent(context, VoiceService::class.java)) {
      context.startForegroundService(intent.setClass(context, VoiceService::class.java))
    }
  }
}
