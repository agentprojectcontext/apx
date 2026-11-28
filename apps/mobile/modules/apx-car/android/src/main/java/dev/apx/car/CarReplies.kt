package dev.apx.car

import android.content.Context
import android.util.Log
import dev.apx.car.auto.CarNav
import org.json.JSONObject

/** A spoken reply in the "APX" conversation: an answer to the latest offer, or words for the super-agent. */
object CarReplies {
  fun handle(context: Context, text: String) {
    val alert = CarAlertStore.latest()
    val action = VoiceReply.actionFor(text)
    if (CarConversation.topic == CarConversation.Topic.ALERT && alert != null && action != null && action in alert.actions) {
      CarAnswers.answer(context, alert, action) { recorded ->
        val words = if (recorded) CarNotifications.ackLabel(context, action) else context.carString(R.string.apx_car_ack_failed)
        CarConversation.postFromApx(context, words, CarConversation.Topic.ALERT)
      }
      if (CarActions.opensRoute(action)) {
        // On the car, the car app hands the route to the car's navigation; without it, the phone opens Maps (Android
        // may refuse that from the background: the answer is recorded either way).
        if (!CarNav.navigateInCar(alert.place, alert.errand)) alert.urlFor(action)?.let { CarAnswers.openMaps(context, it) }
      }
      return
    }
    AgentChat.ask(context, text)
  }
}

/**
 * Words for the super-agent from the car: sent to Home (the chat the phone app opens on), then its answer is read
 * back into the conversation so Android Auto says it.
 */
object AgentChat {
  private const val TAG = "ApxCar"
  private const val HOME = "home"
  private const val WAIT_S = 90

  fun ask(context: Context, text: String) {
    val app = context.applicationContext
    val name = CarPrefs(app).agentName
    CoreClient.chat.execute {
      try {
        val sent = CoreClient.call(app, "threads.send", JSONObject().put("thread", HOME).put("text", text).put("mode", "queue"))
        val runId = sent.optJSONObject("run")?.optString("id").orEmpty()
        if (runId.isEmpty()) return@execute
        val run = CoreClient.call(
          app, "runs.wait", JSONObject().put("run", runId).put("timeout_s", WAIT_S), (WAIT_S + 10) * 1000,
        )
        val answer = replyOf(CoreClient.call(app, "threads.get", JSONObject().put("thread", HOME)), runId)
        val words = when {
          answer.isNotBlank() -> CarText.forSpeech(answer)
          run.optString("ended_at").isBlank() -> app.carString(R.string.apx_car_agent_waiting, name)
          else -> ""
        }
        if (words.isNotBlank()) CarConversation.postFromApx(app, words, CarConversation.Topic.AGENT)
      } catch (error: CoreError) {
        Log.w(TAG, "message to the super-agent failed: ${error.code}")
        CarConversation.postFromApx(app, app.carString(R.string.apx_car_agent_failed, name), CarConversation.Topic.AGENT)
      } catch (error: RuntimeException) {
        Log.w(TAG, "message to the super-agent failed: ${error.javaClass.simpleName}")
      }
    }
  }

  /** The agent's text parts written in that run, in order. */
  private fun replyOf(thread: JSONObject, runId: String): String {
    val messages = thread.optJSONArray("messages") ?: return ""
    val out = StringBuilder()
    for (i in 0 until messages.length()) {
      val message = messages.optJSONObject(i) ?: continue
      if (message.optString("run_id") != runId) continue
      if (message.optJSONObject("author")?.optString("kind") != "agent") continue
      val parts = message.optJSONArray("parts") ?: continue
      for (j in 0 until parts.length()) {
        val part = parts.optJSONObject(j) ?: continue
        if (part.optString("type") != "text") continue
        val value = part.optString("text").trim()
        if (value.isNotEmpty()) out.append(if (out.isEmpty()) "" else "\n").append(value)
      }
    }
    return out.toString()
  }

  /** "Talk to <name>" on the car: a message the owner answers by voice. */
  fun prompt(context: Context) {
    val name = CarPrefs(context).agentName
    CarConversation.postFromApx(context, context.carString(R.string.apx_car_talk_prompt, name), CarConversation.Topic.AGENT)
  }
}
