package dev.apx.car

import android.content.Context
import android.content.SharedPreferences
import android.content.res.Configuration
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Car mode's own state, in private app storage. `token` is this phone's paired key: it never leaves this file except
 * as the Authorization header to the core, and is never logged.
 */
class CarPrefs(context: Context) {
  private val prefs: SharedPreferences =
    context.applicationContext.getSharedPreferences("apx_car", Context.MODE_PRIVATE)

  val url: String get() = prefs.getString("url", "").orEmpty().trimEnd('/')
  val token: String get() = prefs.getString("token", "").orEmpty()
  val tripPrivacyRevision: String get() = prefs.getString("trip_privacy_revision", "") ?: ""
  fun setTripPrivacyRevision(revision: String) { prefs.edit().putString("trip_privacy_revision", revision).apply() }

  val blocked: Boolean get() = prefs.getBoolean("privacy_blocked", false)
  val enabled: Boolean get() = prefs.getBoolean("enabled", false) && !blocked

  fun setPrivacyBlocked(blocked: Boolean) {
    prefs.edit().putBoolean("privacy_blocked", blocked).apply()
  }
  val lang: String get() = prefs.getString("lang", "es").orEmpty().ifBlank { "es" }
  val agentName: String get() = prefs.getString("agent_name", "").orEmpty().ifBlank { "APX" }

  /** Paired and turned on: the only state in which anything runs. */
  val active: Boolean get() = enabled && url.isNotEmpty() && token.isNotEmpty()

  val tripId: String get() = prefs.getString("trip_id", "").orEmpty()
  val tripSource: String get() = prefs.getString("trip_source", "").orEmpty()
  val tripStartedAt: String get() = prefs.getString("trip_started_at", "").orEmpty()
  val tripDestination: String get() = prefs.getString("trip_destination", "").orEmpty()
  val tripActive: Boolean get() = tripId.isNotEmpty()

  val lastSentAt: String get() = prefs.getString("last_sent_at", "").orEmpty()
  val lastError: String get() = prefs.getString("last_error", "").orEmpty()

  fun configure(url: String, token: String, enabled: Boolean, lang: String, agentName: String?) {
    prefs.edit()
      .putString("url", url.trim())
      .putString("token", token.trim())
      .putBoolean("enabled", enabled)
      .putString("lang", if (lang.startsWith("en")) "en" else "es")
      .putString("agent_name", agentName?.trim().orEmpty())
      .apply()
  }

  /** Unpaired: nothing of the old pairing stays. */
  fun clear() {
    prefs.edit().clear().apply()
  }

  fun startTrip(id: String, source: String, destination: String) {
    prefs.edit()
      .putString("trip_id", id)
      .putString("trip_source", source)
      .putString("trip_started_at", isoNow())
      .putString("trip_destination", destination)
      .apply()
  }

  fun setTripDestination(destination: String) {
    prefs.edit().putString("trip_destination", destination).apply()
  }

  fun endTrip() {
    prefs.edit()
      .remove("trip_id")
      .remove("trip_source")
      .remove("trip_started_at")
      .remove("trip_destination")
      .apply()
  }

  fun markSent() {
    prefs.edit().putString("last_sent_at", isoNow()).remove("last_error").apply()
  }

  fun setError(message: String?) {
    val edit = prefs.edit()
    if (message.isNullOrBlank()) edit.remove("last_error") else edit.putString("last_error", message)
    edit.apply()
  }
}

/** ISO 8601 in UTC with milliseconds, as the protocol's `datetime` fields take it (minSdk 24 has no java.time). */
internal fun isoNow(): String =
  SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
    .format(Date())

/** Car mode's strings in the language the owner chose for it, whatever the phone's language is. */
internal fun localized(context: Context): Context {
  val lang = CarPrefs(context).lang
  val config = Configuration(context.resources.configuration)
  config.setLocale(Locale.forLanguageTag(lang))
  return context.createConfigurationContext(config)
}

internal fun Context.carString(id: Int, vararg args: Any): String = localized(this).getString(id, *args)
