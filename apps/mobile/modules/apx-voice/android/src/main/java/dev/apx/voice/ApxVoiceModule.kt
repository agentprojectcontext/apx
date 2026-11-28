package dev.apx.voice

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings as AndroidSettings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

/** The app's handle on the voice: where the core is, whether it listens for its name, and calls. */
class ApxVoiceModule : Module() {
  private var unlisten: (() -> Unit)? = null
  private val context get() = requireNotNull(appContext.reactContext)

  override fun definition() = ModuleDefinition {
    Name("ApxVoice")
    Events("onState")

    OnStartObserving {
      unlisten = VoiceState.listen { sendEvent("onState", snapshot()) }
    }
    OnStopObserving {
      unlisten?.invoke()
      unlisten = null
    }

    /** Where the core is, this phone's key, the agent who answers and the words the voice's screens show. */
    Function("configure") { url: String, token: String, agent: Map<String, Any?>, labels: Map<String, String> ->
      val s = Settings(context)
      s.url = url
      if (token.isNotEmpty() && token != s.token) s.token = token
      s.agentName = agent["name"] as? String ?: ""
      s.avatar = agent["avatar"] as? String ?: ""
      s.eyes = (agent["eyes"] as? String) ?: "[]"
      s.eyeColor = agent["eyeColor"] as? String ?: "#15181C"
      s.labels = JSONObject(labels as Map<*, *>)
    }

    /** Listening for its name, on or off. On starts it now (the app is on screen, as Android asks). */
    Function("setWake") { on: Boolean ->
      val s = Settings(context)
      s.wake = on
      VoiceService.start(context)
    }

    Function("wake") { Settings(context).wake }

    /** Listening again if it was on (after the phone restarted, the app opening starts it). */
    Function("resume") {
      if (Settings(context).wake && VoiceService.current == null) VoiceService.start(context)
    }

    Function("startCall") { mode: String, agentId: String?, thread: String?, full: Boolean ->
      val i = Intent(context, VoiceService::class.java).setAction(VoiceService.ACTION_CALL)
        .putExtra("mode", mode).putExtra("full", full)
      if (agentId != null) i.putExtra("agent", agentId)
      if (thread != null) i.putExtra("thread", thread)
      VoiceService.start(context, i)
    }

    Function("hangUp") { VoiceService.current?.hangUp() }

    Function("state") { snapshot() }

    /** Whether it may pop over other apps (and the lock screen) when it hears its name. */
    Function("canOverlay") { Build.VERSION.SDK_INT < 23 || AndroidSettings.canDrawOverlays(context) }

    Function("openOverlaySettings") {
      val i = Intent(AndroidSettings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(i)
    }

    /** Unpaired: the voice forgets the core and stops listening. */
    Function("forget") {
      val s = Settings(context)
      s.wake = false
      VoiceService.current?.hangUp()
      s.clear()
      VoiceService.current?.stopSelf()
    }
  }

  private fun snapshot(): Map<String, Any?> = mapOf(
    "phase" to VoiceState.phase,
    "live" to VoiceState.live(),
    "thread" to VoiceState.thread,
    "mode" to VoiceState.mode,
    "problem" to VoiceState.problem,
  )
}
