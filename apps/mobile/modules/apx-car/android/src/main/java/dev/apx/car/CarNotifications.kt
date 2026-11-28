package dev.apx.car

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput

/** The phone's car-mode notifications: the trip's ongoing notice, an offer's heads-up, and the "APX" conversation. */
object CarNotifications {
  /** Silent but vibrating: on One UI a channel with neither never pops up (rules/ERRANDS_ON_THE_WAY.md). */
  const val ALERTS = "apx_car"
  const val TRIP = "apx_car_trip"
  const val TRIP_ID = 7200
  const val CONVERSATION_ID = 7300
  const val KEY_REPLY = "apx_car_reply"

  fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    val alerts = NotificationChannel(
      ALERTS,
      context.carString(R.string.apx_car_alerts_channel),
      NotificationManager.IMPORTANCE_HIGH,
    ).apply {
      description = context.carString(R.string.apx_car_alerts_channel_description)
      setSound(null, null)
      enableVibration(true)
      vibrationPattern = longArrayOf(0, 250)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    }
    val trip = NotificationChannel(
      TRIP,
      context.carString(R.string.apx_car_trip_channel),
      NotificationManager.IMPORTANCE_LOW,
    ).apply { description = context.carString(R.string.apx_car_trip_channel_description) }
    manager.createNotificationChannel(alerts)
    manager.createNotificationChannel(trip)
  }

  fun openApp(context: Context, requestCode: Int): PendingIntent? {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
      context, requestCode, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  fun trip(context: Context): Notification {
    ensureChannels(context)
    val destination = CarPrefs(context).tripDestination
    return NotificationCompat.Builder(context, TRIP)
      .setSmallIcon(R.drawable.ic_apx_car)
      .setContentTitle(context.carString(R.string.apx_car_trip_title))
      .setContentText(
        if (destination.isBlank()) context.carString(R.string.apx_car_trip_text)
        else context.carString(R.string.apx_car_trip_text_destination, destination),
      )
      .setContentIntent(openApp(context, 8))
      .setOngoing(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .build()
  }

  fun alertId(alertId: String): Int = 7400 + Math.floorMod(alertId.hashCode(), 500)

  /** One offer on the phone: the errand, the place and up to three answers. */
  fun showAlert(context: Context, alert: CarAlert) {
    ensureChannels(context)
    val id = alertId(alert.id)
    // The title already says the errand, the place and the distance: the body adds only the street.
    val body = alert.place?.address.orEmpty()
    val builder = NotificationCompat.Builder(context, ALERTS)
      .setSmallIcon(R.drawable.ic_apx_car)
      .setContentTitle(alert.title)
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setDefaults(NotificationCompat.DEFAULT_VIBRATE)
      .setAutoCancel(true)
      .setGroup("apx_car_alerts")
      .setTimeoutAfter(15 * 60_000L)
      .setContentIntent(openApp(context, id))
    CarActions.forPhone(alert.actions).forEachIndexed { index, action ->
      builder.addAction(0, actionLabel(context, action), CarActionReceiver.answerIntent(context, alert, action, id * 10 + index))
    }
    notify(context, id, builder.build())
  }

  fun cancelAlert(context: Context, alertId: String) {
    NotificationManagerCompat.from(context).cancel(alertId(alertId))
  }

  fun actionLabel(context: Context, action: String): String = context.carString(
    when (action) {
      CarActions.NAVIGATE -> R.string.apx_car_action_navigate
      CarActions.ADD_STOP -> R.string.apx_car_action_add_stop
      CarActions.NEXT -> R.string.apx_car_action_next
      CarActions.LATER -> R.string.apx_car_action_later
      CarActions.SKIP -> R.string.apx_car_action_skip
      CarActions.SILENCE -> R.string.apx_car_action_silence
      else -> R.string.apx_car_action_done
    },
  )

  fun ackLabel(context: Context, action: String): String = context.carString(
    when (action) {
      CarActions.NAVIGATE, CarActions.ADD_STOP -> R.string.apx_car_ack_navigate
      CarActions.NEXT -> R.string.apx_car_ack_next
      CarActions.LATER -> R.string.apx_car_ack_later
      CarActions.SKIP -> R.string.apx_car_ack_skip
      CarActions.SILENCE -> R.string.apx_car_ack_silence
      else -> R.string.apx_car_ack_done
    },
  )

  internal fun notify(context: Context, id: Int, notification: Notification) {
    try {
      NotificationManagerCompat.from(context).notify(id, notification)
    } catch (_: SecurityException) {
      // Notifications not allowed: status() says so on the car mode screen.
    }
  }

  fun cancelAll(context: Context) {
    val manager = NotificationManagerCompat.from(context)
    for (alert in CarAlertStore.all()) manager.cancel(alertId(alert.id))
    CarConversation.clear(context)
  }
}

/**
 * The "APX" conversation: the only kind of notification Android Auto shows without opening an app, read aloud and
 * answered by voice (reply and mark-as-read only; a card with more buttons is discarded). An offer goes out here as a
 * message; so do the super-agent's answers.
 */
object CarConversation {
  private data class Line(val text: String, val fromApx: Boolean, val at: Long)

  /** What a reply answers: the latest offer, or (after "Talk to…" or an agent's answer) the super-agent. */
  enum class Topic { ALERT, AGENT }

  private val lines = ArrayDeque<Line>()

  @Volatile
  var topic: Topic = Topic.ALERT
    private set

  fun postFromApx(context: Context, text: String, topic: Topic) {
    if (text.isBlank()) return
    this.topic = topic
    add(Line(text, true, System.currentTimeMillis()))
    show(context, onlyAlertOnce = false)
  }

  /** The owner's reply, shown so the conversation reads right; it does not ring again. */
  fun postFromOwner(context: Context, text: String) {
    add(Line(text, false, System.currentTimeMillis()))
    show(context, onlyAlertOnce = true)
  }

  fun clear(context: Context) {
    synchronized(lines) { lines.clear() }
    topic = Topic.ALERT
    NotificationManagerCompat.from(context).cancel(CarNotifications.CONVERSATION_ID)
  }

  private fun add(line: Line) = synchronized(lines) {
    lines.addLast(line)
    while (lines.size > 8) lines.removeFirst()
  }

  private fun show(context: Context, onlyAlertOnce: Boolean) {
    CarNotifications.ensureChannels(context)
    val me = Person.Builder().setName(context.carString(R.string.apx_car_me)).setKey("owner").build()
    val apx = Person.Builder().setName("APX").setKey("apx").setBot(true).build()
    val style = NotificationCompat.MessagingStyle(me).setGroupConversation(false)
    val snapshot = synchronized(lines) { lines.toList() }
    for (line in snapshot) style.addMessage(line.text, line.at, if (line.fromApx) apx else null)

    val remoteInput = RemoteInput.Builder(CarNotifications.KEY_REPLY)
      .setLabel(context.carString(R.string.apx_car_reply_label))
      .build()
    val reply = NotificationCompat.Action.Builder(
      R.drawable.ic_apx_car,
      context.carString(R.string.apx_car_reply),
      CarActionReceiver.replyIntent(context),
    )
      .addRemoteInput(remoteInput)
      .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
      .setShowsUserInterface(false)
      .build()
    val read = NotificationCompat.Action.Builder(
      R.drawable.ic_apx_car,
      context.carString(R.string.apx_car_mark_read),
      CarActionReceiver.readIntent(context),
    )
      .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
      .setShowsUserInterface(false)
      .build()

    val notification = NotificationCompat.Builder(context, CarNotifications.ALERTS)
      .setSmallIcon(R.drawable.ic_apx_car)
      .setStyle(style)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOnlyAlertOnce(onlyAlertOnce)
      .setContentIntent(CarNotifications.openApp(context, 44))
      .addAction(reply)
      .addInvisibleAction(read)
      .build()
    CarNotifications.notify(context, CarNotifications.CONVERSATION_ID, notification)
  }
}
