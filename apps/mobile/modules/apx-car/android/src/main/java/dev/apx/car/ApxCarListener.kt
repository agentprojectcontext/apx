package dev.apx.car

import android.app.Notification
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import androidx.car.app.connection.CarConnection
import androidx.lifecycle.Observer

/**
 * Sees the owner start driving: Android Auto's session notification and Google Maps' navigation notification, two
 * independent sources (special access the owner grants once). It reads nothing else, and nothing while car mode is
 * off. While its process is alive the car connection (androidx.car.app) counts as a third signal.
 */
class ApxCarListener : NotificationListenerService() {
  private val main = Handler(Looper.getMainLooper())
  private val confirm = Runnable { refresh(confirmed = true) }
  private val recheck = Runnable { refresh(confirmed = false) }
  private var carConnection: CarConnection? = null
  private val carObserver = Observer<Int> { type ->
    val projecting = type == CarConnection.CONNECTION_TYPE_PROJECTION
    if (CarPrefs(this).active) TripController.update(this, { it.copy(carLink = projecting) })
  }

  override fun onListenerConnected() {
    super.onListenerConnected()
    instance = this
    // Notifications first: the car connection's first report must not end a trip they still show.
    refresh(confirmed = true)
    try {
      carConnection = CarConnection(applicationContext).also { it.type.observeForever(carObserver) }
    } catch (error: RuntimeException) {
      Log.w(TAG, "car connection unavailable: ${error.javaClass.simpleName}")
    }
  }

  override fun onListenerDisconnected() {
    stopWatching()
    super.onListenerDisconnected()
  }

  override fun onDestroy() {
    stopWatching()
    super.onDestroy()
  }

  private fun stopWatching() {
    if (instance === this) instance = null
    main.removeCallbacksAndMessages(null)
    carConnection?.type?.removeObserver(carObserver)
    carConnection = null
  }

  override fun onNotificationPosted(item: StatusBarNotification) {
    if (!relevant(item)) return
    refresh(confirmed = false)
  }

  override fun onNotificationRemoved(item: StatusBarNotification) {
    if (!relevant(item)) return
    refresh(confirmed = false)
  }

  private fun relevant(item: StatusBarNotification): Boolean =
    CarPrefs(this).active && (item.packageName == AutoDetector.PACKAGE || item.packageName == MapsDetector.PACKAGE)

  /**
   * Reads what is on screen now. A source that comes up counts at once; one that went down counts only if it is still
   * down 4 s later (Maps and Android Auto replace their notifications as they go).
   */
  private fun refresh(confirmed: Boolean) {
    if (!CarPrefs(this).active) return
    val active = try {
      activeNotifications ?: emptyArray()
    } catch (error: RuntimeException) {
      Log.w(TAG, "could not read notifications: ${error.javaClass.simpleName}")
      return
    }
    var auto = false
    var route: StatusBarNotification? = null
    val now = System.currentTimeMillis()
    for (item in active) {
      if (isAutoSession(item)) auto = true
      else if (route == null && isRoute(item) && now - item.postTime < STALE_ROUTE_MS) route = item
    }
    val maps = route != null
    val current = TripController.sources()
    val wentDown = (current.auto && !auto) || (current.maps && !maps)
    if (wentDown && !confirmed) {
      main.removeCallbacks(confirm)
      main.postDelayed(confirm, REMOVAL_DEBOUNCE_MS)
      // What came up still counts now.
      if ((auto && !current.auto) || (maps && !current.maps)) {
        TripController.update(this, { it.copy(auto = auto || it.auto, maps = maps || it.maps) }, route?.let(::destination))
      }
      return
    }
    main.removeCallbacks(confirm)
    TripController.update(this, { it.copy(auto = auto, maps = maps) }, route?.let(::destination))
    // Maps may stop updating a route it no longer runs; look again before it goes stale.
    main.removeCallbacks(recheck)
    if (maps) main.postDelayed(recheck, RECHECK_MS)
  }

  private fun isAutoSession(item: StatusBarNotification): Boolean {
    if (item.packageName != AutoDetector.PACKAGE) return false
    val notification = item.notification
    val extras = notification.extras ?: Bundle.EMPTY
    val persistent = (notification.flags and (Notification.FLAG_ONGOING_EVENT or Notification.FLAG_FOREGROUND_SERVICE)) != 0
    return AutoDetector.isSession(
      item.packageName,
      persistent,
      extras.getCharSequence(Notification.EXTRA_TITLE),
      extras.getCharSequence(Notification.EXTRA_TEXT),
    )
  }

  private fun isRoute(item: StatusBarNotification): Boolean {
    if (item.packageName != MapsDetector.PACKAGE) return false
    val notification = item.notification
    val extras = notification.extras ?: Bundle.EMPTY
    val ongoing = (notification.flags and (Notification.FLAG_ONGOING_EVENT or Notification.FLAG_FOREGROUND_SERVICE)) != 0
    if (!MapsDetector.isNavigation(
        item.packageName,
        notification.category,
        ongoing,
        extras.getCharSequence(Notification.EXTRA_TITLE),
        extras.getCharSequence(Notification.EXTRA_TEXT),
      )
    ) return false
    val labels = notification.actions?.mapNotNull { it.title?.toString() }.orEmpty()
    return MapsDetector.isActiveRoute(extras.getString(Notification.EXTRA_TEMPLATE), destination(item), labels)
  }

  /** Samsung's "Now bar" extras carry "En dirección a …" while Maps navigates. */
  private fun destination(item: StatusBarNotification): String {
    val extras = item.notification.extras ?: return ""
    return MapsDetector.destinationFrom(
      extras.getCharSequence("android.ongoingActivityNoti.secondaryInfo"),
      extras.getCharSequence("android.ongoingActivityNoti.nowbarSecondaryInfo"),
    )
  }

  companion object {
    private const val TAG = "ApxCar"
    private const val REMOVAL_DEBOUNCE_MS = 4_000L
    private const val RECHECK_MS = 60_000L
    private const val STALE_ROUTE_MS = 120_000L

    @Volatile
    private var instance: ApxCarListener? = null

    val connected: Boolean get() = instance != null

    /** Car mode was just turned on: read what is on screen now. */
    fun refreshNow() {
      val listener = instance ?: return
      listener.main.post { listener.refresh(confirmed = true) }
    }
  }
}
