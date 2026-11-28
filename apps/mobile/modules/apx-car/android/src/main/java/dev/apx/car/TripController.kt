package dev.apx.car

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.util.UUID

/**
 * When a trip starts and ends. The sources report in (the listener: Android Auto and Maps; the car connection; a
 * test trip from the app) and this decides: a trip starts with the first source and ends when all are down.
 */
object TripController {
  private const val TAG = "ApxCar"

  @Volatile
  private var sources = TripSources()

  private val statusListeners = mutableListOf<(Map<String, Any?>) -> Unit>()

  fun sources(): TripSources = sources

  @Synchronized
  fun update(context: Context, change: (TripSources) -> TripSources, destination: String? = null) {
    val app = context.applicationContext
    val prefs = CarPrefs(app)
    val next = change(sources)
    val changed = next != sources
    sources = next
    if (!prefs.active) {
      if (prefs.tripActive) end(app)
      if (changed) publishStatus(app)
      return
    }
    when (val decision = next.decide(prefs.tripActive)) {
      is TripSources.Change.Start -> start(app, decision.source, destination.orEmpty())
      TripSources.Change.End -> end(app)
      TripSources.Change.Keep -> {
        if (prefs.tripActive) {
          if (!destination.isNullOrBlank() && destination != prefs.tripDestination) setDestination(app, destination)
          resume(app)
        }
      }
    }
    if (changed) publishStatus(app)
  }

  private fun start(context: Context, source: String, destination: String) {
    val prefs = CarPrefs(context)
    val id = UUID.randomUUID().toString()
    prefs.startTrip(id, source, destination)
    Log.i(TAG, "trip started ($source)")
    TripLocationService.start(context)
    ApxCarWidget.watch(context)
    ApxCarWidget.refresh(context)
  }

  private fun end(context: Context) {
    val prefs = CarPrefs(context)
    val id = prefs.tripId
    prefs.endTrip()
    TripLocationService.stop(context)
    CarNotifications.cancelAll(context)
    CarAlertStore.clear()
    ApxCarWidget.refresh(context)
    Log.i(TAG, "trip ended")
    if (id.isNotEmpty() && prefs.url.isNotEmpty() && prefs.token.isNotEmpty()) {
      CoreClient.send(context, "car.trip_end", JSONObject().put("trip_id", id).put("at", isoNow()))
    }
  }

  /** Maps said where the route goes after the trip began: the same trip id only updates it on the core. */
  private fun setDestination(context: Context, destination: String) {
    val prefs = CarPrefs(context)
    prefs.setTripDestination(destination)
    CoreClient.send(context, "car.trip_start", tripStart(prefs.tripId, prefs.tripSource, destination)
      .put("consent_revision", prefs.tripPrivacyRevision))
  }

  fun announce(context: Context, revision: String): JSONObject {
    val prefs = CarPrefs(context)
    val view = CoreClient.call(context, "car.trip_start", tripStart(prefs.tripId, prefs.tripSource, prefs.tripDestination)
      .put("consent_revision", revision))
    CarAlertStore.put(CarTripView.from(view).alerts, quiet = true)
    return view
  }

  private fun tripStart(id: String, source: String, destination: String): JSONObject {
    val params = JSONObject().put("trip_id", id).put("source", source.ifBlank { "manual" }).put("at", isoNow())
    if (destination.isNotBlank()) params.put("destination", JSONObject().put("label", destination.take(160)))
    return params
  }

  /**
   * A trip whose location service is not running (refused from the background, the app was replaced or frozen):
   * start it again. Called when the app comes to the front, when the car app opens and when a source confirms the
   * trip. Starting a running service only re-reads the trip.
   */
  fun resume(context: Context) {
    val prefs = CarPrefs(context)
    if (prefs.active && prefs.tripActive) TripLocationService.start(context)
  }

  fun revokePrivacy(context: Context) {
    val app = context.applicationContext
    CarPrefs(app).setPrivacyBlocked(true)
    sources = TripSources()
    end(app)
    publishStatus(app)
  }

  /** The app's configure(): turning off or unpairing stops everything. */
  fun configure(context: Context, url: String, token: String, enabled: Boolean, lang: String, agentName: String?) {
    val app = context.applicationContext
    val prefs = CarPrefs(app)
    if (url.isBlank() || token.isBlank()) {
      if (prefs.tripActive) {
        // The key is gone with the pairing: end locally only.
        prefs.endTrip()
        TripLocationService.stop(app)
        CarNotifications.cancelAll(app)
        CarAlertStore.clear()
      }
      prefs.clear()
      sources = sources.copy(test = false)
      publishStatus(app)
      return
    }
    prefs.configure(url, token, enabled, lang, agentName)
    CarNotifications.ensureChannels(app)
    if (!enabled) {
      sources = sources.copy(test = false)
      if (prefs.tripActive) end(app)
      publishStatus(app)
      return
    }
    // Sources are only known once the listener has read what is on screen; deciding before that would end a real
    // trip right after the app restarts. Without the listener's access nothing can end a trip but this.
    if (ApxCarListener.connected) ApxCarListener.refreshNow()
    else if (!listenerGranted(app)) update(app, { it.copy(auto = false, maps = false) })
    resume(app)
    publishStatus(app)
  }

  fun status(context: Context): Map<String, Any?> {
    val app = context.applicationContext
    val prefs = CarPrefs(app)
    val out = mutableMapOf<String, Any?>(
      "available" to true,
      "enabled" to prefs.active,
      "privacy_blocked" to prefs.blocked,
      "listener" to listenerGranted(app),
      "location" to granted(app, Manifest.permission.ACCESS_FINE_LOCATION),
      "notifications" to (
        NotificationManagerCompat.from(app).areNotificationsEnabled() &&
          (Build.VERSION.SDK_INT < 33 || granted(app, Manifest.permission.POST_NOTIFICATIONS))
        ),
      "car_connected" to sources.car,
    )
    if (prefs.tripActive) {
      out["trip"] = mapOf(
        "id" to prefs.tripId,
        "source" to prefs.tripSource.ifBlank { "manual" },
        "started_at" to prefs.tripStartedAt,
      )
    }
    if (prefs.lastSentAt.isNotEmpty()) out["last_sent_at"] = prefs.lastSentAt
    if (prefs.lastError.isNotEmpty()) out["last_error"] = prefs.lastError
    return out
  }

  fun addStatusListener(listener: (Map<String, Any?>) -> Unit) {
    synchronized(statusListeners) { statusListeners.add(listener) }
  }

  fun removeStatusListener(listener: (Map<String, Any?>) -> Unit) {
    synchronized(statusListeners) { statusListeners.remove(listener) }
  }

  fun publishStatus(context: Context) {
    val current = synchronized(statusListeners) { statusListeners.toList() }
    if (current.isEmpty()) return
    val status = status(context)
    for (listener in current) {
      try {
        listener(status)
      } catch (_: RuntimeException) {
        // A JS runtime that went away.
      }
    }
  }

  fun listenerGranted(context: Context): Boolean =
    NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)

  fun granted(context: Context, permission: String): Boolean =
    ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
}
