package dev.apx.car

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject

/**
 * No coordinates are read until the core confirms the current trip and its privacy controls. Only an answer that
 * says no (or a revoked key) stops the trip; no answer in time (offline, Tailscale reconnecting, a busy core) keeps
 * it and the next check tries again, since the owner's choice stands until they change it (DECISIONS.md#d-287).
 */
object TripPrivacy {
  private val main = Handler(Looper.getMainLooper())
  private var generation = 0L
  private var pending = false
  private val checks = mutableListOf<Runnable>()

  @Synchronized
  fun validate(context: Context, beginning: Boolean = false, unreachable: () -> Unit = {}, allowed: () -> Unit) {
    if (pending) return
    pending = true
    val app = context.applicationContext
    val mine = generation
    val id = CarPrefs(app).tripId
    val deadline = Runnable { noAnswer(mine, unreachable) }
    checks.add(deadline)
    main.postDelayed(deadline, 12_000L)
    CoreClient.io.execute {
      var silent = false
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
      } catch (error: CoreError) {
        silent = TripPositionReply.unreachable(error.code)
        null
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
          if (silent && prefs.tripId == id && prefs.active) {
            unreachable()
          } else if (confirmed == null || prefs.tripId != id || !prefs.active) {
            revoke(app, mine)
          } else {
            prefs.setTripPrivacyRevision(confirmed)
            allowed()
          }
        }
      }
    }
  }

  /** The check ran out of time: the trip stays and the caller tries again later. */
  @Synchronized
  private fun noAnswer(mine: Long, unreachable: () -> Unit) {
    if (mine != generation) return
    generation++
    pending = false
    unreachable()
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
