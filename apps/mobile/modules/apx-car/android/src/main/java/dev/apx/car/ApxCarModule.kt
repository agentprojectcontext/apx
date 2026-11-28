package dev.apx.car

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import org.json.JSONObject
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class CarConfig : Record {
  @Field val url: String = ""
  @Field val token: String = ""
  @Field val enabled: Boolean = false
  @Field val lang: String = "es"
  @Field("agent_name") val agentName: String? = null
}

/** The JS contract (src/car/native.ts): hand over the core's address and key, turn car mode on or off, read its state. */
class ApxCarModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  private val onStatus: (Map<String, Any?>) -> Unit = { status -> sendEvent("status", status) }

  override fun definition() = ModuleDefinition {
    Name("ApxCar")
    Events("status")

    OnCreate { TripController.addStatusListener(onStatus) }
    OnDestroy { TripController.removeStatusListener(onStatus) }
    // With the app in front Android lets a refused location service start (rules/ERRANDS_ON_THE_WAY.md).
    OnActivityEntersForeground { appContext.reactContext?.let { TripController.resume(it.applicationContext) } }

    AsyncFunction("configure") { config: CarConfig ->
      TripController.configure(context, config.url, config.token, config.enabled, config.lang, config.agentName)
    }

    AsyncFunction("allowTrips") {
      val privacy = CoreClient.call(context, "phone.privacy", JSONObject())
      val revision = privacy.optString("trip_revision", "")
      check(privacy.optBoolean("trips", false) && revision.isNotEmpty()) { "Turn on trip location in Privacy first" }
      CarPrefs(context).setTripPrivacyRevision(revision)
      CarPrefs(context).setPrivacyBlocked(false)
    }
    AsyncFunction("pauseTrips") { TripController.revokePrivacy(context) }

    AsyncFunction("status") { TripController.status(context) }

    AsyncFunction("openListenerSettings") {
      val app = context
      val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS).putExtra(
          Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME,
          ComponentName(app, ApxCarListener::class.java).flattenToString(),
        )
      } else {
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
      }
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        app.startActivity(intent)
      } catch (_: RuntimeException) {
        app.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
    }

    AsyncFunction("startTestTrip") { TripController.update(context, { it.copy(test = true) }) }

    AsyncFunction("stopTestTrip") { TripController.update(context, { it.copy(test = false) }) }
  }
}
