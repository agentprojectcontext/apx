package dev.apx.car

import android.Manifest
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * Sends the phone's position to the core while a trip runs: a foreground service typed `location`, which gives
 * while-in-use access off screen without ACCESS_BACKGROUND_LOCATION (the ongoing notification is the permission
 * model). One point at a time, never a track. The core's answer carries the new offers.
 */
class TripLocationService : Service() {
  private lateinit var locations: LocationManager
  private var lastUploadMs = 0L
  private var lastReannounceMs = 0L
  private var listening = false

  private val listener = object : LocationListener {
    override fun onLocationChanged(location: Location) = publish(location)

    @Deprecated("Required below API 29")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}

    override fun onProviderEnabled(provider: String) {}

    override fun onProviderDisabled(provider: String) {}
  }

  override fun onCreate() {
    super.onCreate()
    locations = getSystemService(Context.LOCATION_SERVICE) as LocationManager
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val prefs = CarPrefs(this)
    if (!prefs.active || !prefs.tripActive) {
      stopSelf()
      return START_NOT_STICKY
    }
    // Permission first: startForeground with the location type throws without it.
    if (!TripController.granted(this, Manifest.permission.ACCESS_FINE_LOCATION) &&
      !TripController.granted(this, Manifest.permission.ACCESS_COARSE_LOCATION)
    ) {
      prefs.setError(carString(R.string.apx_car_error_location))
      TripController.publishStatus(this)
      stopSelf()
      return START_NOT_STICKY
    }
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(CarNotifications.TRIP_ID, CarNotifications.trip(this), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
      } else {
        startForeground(CarNotifications.TRIP_ID, CarNotifications.trip(this))
      }
    } catch (refused: RuntimeException) {
      // Not allowed from the background right now (SecurityException or ForegroundServiceStartNotAllowedException):
      // the app retries when it is opened.
      Log.w(TAG, "location service refused: ${refused.javaClass.simpleName}")
      prefs.setError(carString(R.string.apx_car_error_background))
      TripController.publishStatus(this)
      stopSelf()
      return START_NOT_STICKY
    }
    if (prefs.lastError == carString(R.string.apx_car_error_background) || prefs.lastError == carString(R.string.apx_car_error_location)) {
      prefs.setError(null)
    }
    running = true
    if (!listening) {
      requestUpdates()
      publish(newestFix())
    }
    TripController.publishStatus(this)
    // A low-memory kill does not end a drive; the listener does.
    return START_STICKY
  }

  override fun onDestroy() {
    try {
      locations.removeUpdates(listener)
    } catch (_: RuntimeException) {
    }
    listening = false
    running = false
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun requestUpdates() {
    for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
      try {
        if (!locations.isProviderEnabled(provider)) continue
        locations.requestLocationUpdates(provider, MIN_INTERVAL_MS, MIN_DISTANCE_M, listener, Looper.getMainLooper())
        listening = true
      } catch (unavailable: RuntimeException) {
        Log.w(TAG, "provider $provider unavailable: ${unavailable.javaClass.simpleName}")
      }
    }
  }

  private fun newestFix(): Location? = try {
    locations.getProviders(true).mapNotNull { locations.getLastKnownLocation(it) }.maxByOrNull { it.time }
  } catch (_: SecurityException) {
    null
  }

  private fun publish(location: Location?) {
    if (location == null) return
    val prefs = CarPrefs(this)
    if (!prefs.active || !prefs.tripActive) {
      stopSelf()
      return
    }
    val now = SystemClock.elapsedRealtime()
    if (lastUploadMs != 0L && now - lastUploadMs < MIN_UPLOAD_MS) return
    lastUploadMs = now
    val params = JSONObject()
      .put("trip_id", prefs.tripId)
      .put("lat", location.latitude)
      .put("lon", location.longitude)
      .put("at", isoNow())
    if (location.hasAccuracy()) params.put("accuracy_m", location.accuracy.toDouble().coerceIn(0.0, 100_000.0))
    if (location.hasSpeed()) params.put("speed_mps", location.speed.toDouble().coerceIn(0.0, 120.0))
    if (location.hasBearing()) params.put("heading_deg", location.bearing.toDouble().coerceIn(0.0, 360.0))
    val app = applicationContext
    CoreClient.send(app, "car.position", params) { result ->
      if (result == null) return@send
      CarPrefs(app).markSent()
      CarAnswers.deliver(app, CarAlert.list(result.optJSONArray("alerts")))
      if (!result.optBoolean("active", true) && SystemClock.elapsedRealtime() - lastReannounceMs > REANNOUNCE_MS) {
        lastReannounceMs = SystemClock.elapsedRealtime()
        TripController.reannounce(app)
      }
    }
  }

  companion object {
    private const val TAG = "ApxCar"

    // 30 s / 150 m: a geofence of a few hundred metres is not crossed between two samples at city speed, and a drive
    // costs a few hundred requests.
    private const val MIN_INTERVAL_MS = 30_000L
    private const val MIN_DISTANCE_M = 150f
    private const val MIN_UPLOAD_MS = 25_000L
    private const val REANNOUNCE_MS = 120_000L

    /** In the foreground and following the trip. */
    @Volatile
    var running = false
      private set

    /** Starts it unless it already runs: a repeated start from the background would be refused for nothing. */
    fun start(context: Context) {
      val prefs = CarPrefs(context)
      if (running || !prefs.active || !prefs.tripActive) return
      // Checked here too: a service started in the foreground that then cannot go foreground is an error on Android.
      if (!TripController.granted(context, Manifest.permission.ACCESS_FINE_LOCATION) &&
        !TripController.granted(context, Manifest.permission.ACCESS_COARSE_LOCATION)
      ) {
        prefs.setError(context.carString(R.string.apx_car_error_location))
        return
      }
      try {
        ContextCompat.startForegroundService(context, Intent(context, TripLocationService::class.java))
      } catch (refused: RuntimeException) {
        Log.w(TAG, "location service not started: ${refused.javaClass.simpleName}")
        CarPrefs(context).setError(context.carString(R.string.apx_car_error_background))
      }
    }

    fun stop(context: Context) {
      running = false
      try {
        context.stopService(Intent(context, TripLocationService::class.java))
      } catch (_: RuntimeException) {
      }
    }
  }
}
