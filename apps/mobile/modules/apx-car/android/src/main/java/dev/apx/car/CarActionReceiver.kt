package dev.apx.car

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import androidx.core.app.RemoteInput
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Offers arriving, and the owner's answers to them from any surface: one place so they all land the same way. */
object CarAnswers {
  private const val TAG = "ApxCar"

  /** New offers from a position (or the next place after "another place"): store, phone, conversation, car. */
  fun deliver(context: Context, alerts: List<CarAlert>) {
    val added = CarAlertStore.put(alerts)
    for (alert in added) {
      CarNotifications.showAlert(context, alert)
      CarConversation.postFromApx(context, alert.spoken, CarConversation.Topic.ALERT)
    }
  }

  /**
   * Records the answer on the core, off the main thread; `done` gets whether it was recorded. The offer leaves every
   * surface at once, so a second tap at the next red light does not answer it twice.
   */
  fun answer(context: Context, alert: CarAlert, action: String, done: (Boolean) -> Unit = {}) {
    val app = context.applicationContext
    CarAlertStore.remove(alert.id)
    CarNotifications.cancelAlert(app, alert.id)
    CarCore.answer(app, alert.id, action) { result ->
      val next = result?.optJSONObject("next")?.let(CarAlert::from)
      // The acknowledgement first, then the next place: read aloud in that order.
      done(result != null)
      if (next != null) deliver(app, listOf(next))
    }
  }

  /** Opens Google Maps on the phone (falls back to whatever opens the link). */
  fun openMaps(context: Context, url: String) {
    val view = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      context.startActivity(Intent(view).setPackage(MapsDetector.PACKAGE))
    } catch (_: Exception) {
      try {
        context.startActivity(view)
      } catch (error: Exception) {
        Log.w(TAG, "could not open the route: ${error.javaClass.simpleName}")
      }
    }
  }
}

/** The car.* calls the phone makes outside a trip's start and end. */
object CarCore {
  fun answer(context: Context, alertId: String, action: String, done: (JSONObject?) -> Unit) =
    CoreClient.send(context, "car.answer", JSONObject().put("alert_id", alertId).put("action", action), done)

  fun errand(context: Context, taskId: String, action: String, done: (JSONObject?) -> Unit = {}) =
    CoreClient.send(context, "car.errand", JSONObject().put("task_id", taskId).put("action", action), done)
}

/** Answers from the phone's heads-up and from the "APX" conversation (voice reply, mark as read). */
class CarActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val app = context.applicationContext
    when (intent.action) {
      ACTION_ANSWER -> {
        val alert = CarAlertStore.get(intent.getStringExtra(EXTRA_ALERT).orEmpty())
        val action = intent.getStringExtra(EXTRA_ACTION).orEmpty()
        val alertId = intent.getStringExtra(EXTRA_ALERT).orEmpty()
        CarNotifications.cancelAlert(app, alertId)
        val pending = goAsync()
        val finish = { pending.finish() }
        if (alert != null) CarAnswers.answer(app, alert, action) { finish() }
        else CarCore.answer(app, alertId, action) { finish() }
      }
      ACTION_REPLY -> {
        val text = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(CarNotifications.KEY_REPLY)
          ?.toString()?.trim().orEmpty()
        if (text.isEmpty()) return
        CarConversation.postFromOwner(app, text)
        CarReplies.handle(app, text)
      }
      ACTION_READ -> CarConversation.clear(app)
    }
  }

  companion object {
    const val ACTION_ANSWER = "dev.apx.car.ANSWER"
    const val ACTION_REPLY = "dev.apx.car.REPLY"
    const val ACTION_READ = "dev.apx.car.READ"
    const val EXTRA_ALERT = "alert_id"
    const val EXTRA_ACTION = "action"
    const val EXTRA_URL = "url"

    /**
     * An answer button. Those that open the route go through [CarAnswerActivity]: since Android 12 a receiver started
     * from a notification may not open another app.
     */
    fun answerIntent(context: Context, alert: CarAlert, action: String, requestCode: Int): PendingIntent {
      val url = alert.urlFor(action)
      if (CarActions.opensRoute(action) && url != null) {
        val open = Intent(context, CarAnswerActivity::class.java)
          .putExtra(EXTRA_ALERT, alert.id)
          .putExtra(EXTRA_ACTION, action)
          .putExtra(EXTRA_URL, url)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
        return PendingIntent.getActivity(
          context, requestCode, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
      }
      val answer = Intent(context, CarActionReceiver::class.java)
        .setAction(ACTION_ANSWER)
        .putExtra(EXTRA_ALERT, alert.id)
        .putExtra(EXTRA_ACTION, action)
      return PendingIntent.getBroadcast(
        context, requestCode, answer, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    const val EXTRA_TASK = "task_id"

    /** An errand row's route (the widget): records that the owner is going, then opens Maps to its best place. */
    fun errandIntent(context: Context, taskId: String, place: CarPlace, requestCode: Int): PendingIntent {
      val open = Intent(context, CarAnswerActivity::class.java)
        .putExtra(EXTRA_TASK, taskId)
        .putExtra(EXTRA_URL, CarActions.routeTo(place))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
      return PendingIntent.getActivity(
        context, requestCode, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    /** Mutable: the system fills in the spoken reply. */
    fun replyIntent(context: Context): PendingIntent = PendingIntent.getBroadcast(
      context,
      40,
      Intent(context, CarActionReceiver::class.java).setAction(ACTION_REPLY),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
    )

    fun readIntent(context: Context): PendingIntent = PendingIntent.getBroadcast(
      context,
      41,
      Intent(context, CarActionReceiver::class.java).setAction(ACTION_READ),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }
}

/**
 * A heads-up's "Go now" / "Add as a stop": records the answer first (opening Maps hands the foreground away, and an
 * OEM that freezes the app on the way out would lose it), then opens the route. It draws nothing.
 */
class CarAnswerActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val alertId = intent.getStringExtra(CarActionReceiver.EXTRA_ALERT).orEmpty()
    val action = intent.getStringExtra(CarActionReceiver.EXTRA_ACTION).orEmpty()
    val url = intent.getStringExtra(CarActionReceiver.EXTRA_URL).orEmpty()
    val taskId = intent.getStringExtra(CarActionReceiver.EXTRA_TASK).orEmpty()
    val app = applicationContext
    val recorded = CountDownLatch(1)
    val alert = CarAlertStore.get(alertId)
    if (taskId.isNotEmpty()) CarCore.errand(app, taskId, "navigate") { recorded.countDown() }
    else if (alert != null) CarAnswers.answer(app, alert, action) { recorded.countDown() }
    else {
      CarNotifications.cancelAlert(app, alertId)
      CarCore.answer(app, alertId, action) { recorded.countDown() }
    }
    Thread {
      // Long enough for a phone on mobile data; Maps opens either way.
      recorded.await(3, TimeUnit.SECONDS)
      runOnUiThread {
        if (url.isNotBlank()) CarAnswers.openMaps(this, url)
        finish()
      }
    }.start()
  }
}
