package dev.apx.car.auto

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import androidx.core.content.ContextCompat
import dev.apx.car.CarErrand
import dev.apx.car.CoreClient
import org.json.JSONObject

/** The owner tapped an errand with no place yet: look for one where they are now, once, on the car's request. */
internal object NearbySearch {
  // The core waits up to a minute for a public place search; the car screen shows "Looking for a place" meanwhile.
  private const val PREVIEW_TIMEOUT_MS = 70_000

  /** The phone's latest fix, only to search around it; nothing is stored or sent but this one point. */
  fun lastPoint(context: Context): Location? {
    val fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
    val coarse = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION)
    if (fine != PackageManager.PERMISSION_GRANTED && coarse != PackageManager.PERMISSION_GRANTED) return null
    val locations = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    return try {
      listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
        .mapNotNull { if (locations.isProviderEnabled(it)) locations.getLastKnownLocation(it) else null }
        .maxByOrNull { it.time }
    } catch (_: SecurityException) {
      null
    }
  }

  /** What car.preview offers for this errand at that point; null when the search failed. */
  fun preview(context: Context, at: Location, taskId: String): CarErrand? = try {
    val params = JSONObject().put("lat", at.latitude).put("lon", at.longitude)
    if (at.hasBearing()) params.put("heading_deg", at.bearing.toDouble().coerceIn(0.0, 360.0))
    val errands = CoreClient.call(context, "car.preview", params, PREVIEW_TIMEOUT_MS).optJSONArray("errands")
    (0 until (errands?.length() ?: 0)).mapNotNull { errands?.optJSONObject(it)?.let(CarErrand::from) }
      .firstOrNull { it.taskId == taskId }
  } catch (_: Exception) {
    null
  }
}
