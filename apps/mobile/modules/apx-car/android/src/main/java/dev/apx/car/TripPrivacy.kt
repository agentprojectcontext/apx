package dev.apx.car

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject

/** No coordinates are read until the core confirms the current trip and its privacy controls. */
object TripPrivacy {
  private val main = Handler(Looper.getMainLooper())
  private var generation = 0L
  private var pending = false
  private val checks = mutableListOf<Runnable>()

  @Synchronized
  fun validate(context: Context, beginning: Boolean = false, allowed: () -> Unit) {
    if (pending) return
    pending = true
    val app = context.applicationContext
    val mine = generation
    val id = CarPrefs(app).tripId
    val deadline = Runnable { revoke(app, mine) }
    checks.add(deadline)
    main.postDelayed(deadline, 12_000L)
    CoreClient.io.execute {
      val confirmed = try {
        val privacy = CoreClient.call(app, "phone.privacy", JSONObject())
        val settings = CoreClient.call(app, "car.settings", JSONObject())
        val revision = privacy.optString("trip_revision", "")
        val previous = CarPrefs(app).tripPrivacyRevision
        if (TripPrivacyLease.accepts(privacy.optBoolean("trips", false),
          settings.optJSONObject("settings")?.optBoolean("enabled", false) == true,
          revision, previous, if (beginning) id else settings.optJSONObject("trip")?.optString("id"), id)) {
          CarPrefs(app).setTripPrivacyRevision(revision)
          if (!beginning || TripController.announce(app, revision).optJSONObject("trip")?.optString("id") == id) revision else null
        } else null
      } catch (_: Exception) {
        null
      }
      main.post {
        main.removeCallbacks(deadline)
        checks.remove(deadline)
        synchronized(this) {
          if (mine != generation) return@post
          pending = false
          val prefs = CarPrefs(app)
          if (confirmed == null || prefs.tripId != id || !prefs.active) {
            revoke(app, mine)
          } else {
            prefs.setTripPrivacyRevision(confirmed)
            allowed()
          }
        }
      }
    }
  }

  @Synchronized
  private fun revoke(context: Context, mine: Long) {
    if (mine != generation) return
    cancel()
    TripController.revokePrivacy(context)
  }

  @Synchronized
  fun cancel() {
    generation++
    pending = false
    for (check in checks) main.removeCallbacks(check)
    checks.clear()
  }
}
