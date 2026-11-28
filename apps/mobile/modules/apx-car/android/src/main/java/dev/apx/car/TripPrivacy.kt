package dev.apx.car

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject

/** See DECISIONS.md#d-287: no answer preserves consent; an explicit negative ends the trip. */
object TripPrivacy {
  private val main = Handler(Looper.getMainLooper())
  private val state = TripPrivacyChecks()
  private val checks = mutableListOf<Runnable>()

  @Synchronized
  fun validate(context: Context, beginning: Boolean = false, unreachable: () -> Unit = {}, allowed: () -> Unit) {
    val check = state.begin() ?: return
    val app = context.applicationContext
    val prefs = CarPrefs(app)
    val id = prefs.tripId
    val previous = prefs.tripPrivacyRevision
    fun sameTrip(): Boolean {
      val current = CarPrefs(app)
      return state.current(check) && current.tripId == id && current.tripPrivacyRevision == previous && current.active
    }
    fun negative() {
      main.post {
        synchronized(this) {
          if (sameTrip()) {
            cancel()
            TripController.revokePrivacy(app)
          }
        }
      }
    }
    val deadline = Runnable {
      synchronized(this) {
        if (state.finish(check) && sameTrip()) unreachable()
      }
    }
    checks.add(deadline)
    main.postDelayed(deadline, 12_000L)
    CoreClient.io.execute {
      var confirmed = false
      try {
        val privacy = CoreClient.call(app, "phone.privacy", JSONObject())
        val revision = privacy.optString("trip_revision", "")
        if (!TripPrivacyLease.privacyAllows(privacy.optBoolean("trips", false), revision, previous)) {
          negative()
        } else {
          val settings = CoreClient.call(app, "car.settings", JSONObject())
          if (settings.optJSONObject("settings")?.optBoolean("enabled", false) != true ||
            (settings.has("this_phone") && !settings.optBoolean("this_phone", false))) {
            negative()
          } else {
            val trip = settings.optJSONObject("trip")?.optString("id")
            // Idle expiry is not revocation: reannounce only this still-authorized trip, never another trip.
            val current = if (beginning || trip == null) {
              if (synchronized(this) { sameTrip() }) TripController.announce(app, revision, id).optJSONObject("trip")?.optString("id") else null
            } else trip
            confirmed = TripPrivacyLease.accepts(true, true, revision, previous, current, id)
            if (!confirmed) negative()
          }
        }
      } catch (error: CoreError) {
        if (!TripPositionReply.unreachable(error.code)) negative()
      } catch (_: Exception) {
        // Transport failures preserve an authorized trip, but never grant the first location read.
      }
      main.post {
        synchronized(this) {
          main.removeCallbacks(deadline)
          checks.remove(deadline)
          if (state.finish(check) && sameTrip()) {
            if (confirmed) allowed() else unreachable()
          }
        }
      }
    }
  }

  @Synchronized
  fun cancel() {
    state.cancel()
    for (check in checks) main.removeCallbacks(check)
    checks.clear()
  }
}
