package dev.apx.car.auto

import android.content.Intent
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.car.app.AppManager
import androidx.car.app.CarAppService
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.car.app.model.Action
import androidx.car.app.model.Alert
import androidx.car.app.model.CarText
import androidx.car.app.validation.HostValidator
import androidx.car.app.versioning.CarAppApiLevels
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import dev.apx.car.CarActions
import dev.apx.car.CarAlert
import dev.apx.car.CarPrefs
import dev.apx.car.ApxCarListener
import dev.apx.car.CarAlertStore
import dev.apx.car.CarAnswers
import dev.apx.car.CarNotifications
import dev.apx.car.CarPlace
import dev.apx.car.R
import dev.apx.car.TripController
import dev.apx.car.carString
import java.lang.ref.WeakReference

/**
 * APX on the car screen (Car App Library, category POI): the trip's offers and errands. Templates only: the host
 * draws them and enforces what may be read while driving.
 */
class ApxCarAppService : CarAppService() {
  override fun createHostValidator(): HostValidator {
    // Debug builds talk to the Desktop Head Unit; release builds accept only the known Android Auto hosts.
    if ((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) return HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
    return HostValidator.Builder(applicationContext)
      .addAllowedHosts(androidx.car.app.R.array.hosts_allowlist_sample)
      .build()
  }

  override fun onCreateSession(): Session = ApxCarSession()
}

class ApxCarSession : Session(), DefaultLifecycleObserver {
  private val main = Handler(Looper.getMainLooper())
  private val onAlerts: (List<CarAlert>) -> Unit = { added -> added.firstOrNull()?.let { main.post { showCarAlert(it) } } }

  init {
    lifecycle.addObserver(this)
  }

  override fun onCreateScreen(intent: Intent): Screen {
    CarNav.attach(carContext)
    // The car app open counts as the app in use: a location service refused from the background can start now. It
    // also means the car is connected, even when the listener missed it (an update mid-drive).
    val app = carContext.applicationContext
    ApxCarListener.rebindIfNeeded(app)
    if (CarPrefs(app).active) TripController.update(app, { it.copy(carLink = true) })
    TripController.resume(app)
    return TripScreen(carContext)
  }

  override fun onCreate(owner: LifecycleOwner) {
    CarAlertStore.addListener(onAlerts)
  }

  override fun onDestroy(owner: LifecycleOwner) {
    CarAlertStore.removeListener(onAlerts)
    CarNav.detach(carContext)
    val app = carContext.applicationContext
    if (CarPrefs(app).active) TripController.update(app, { it.copy(carLink = false) })
  }

  /** A new offer while the car app is open: a car alert with its two main answers (car API 5 and later). */
  private fun showCarAlert(alert: CarAlert) {
    if (carContext.carAppApiLevel < CarAppApiLevels.LEVEL_5) return
    try {
      val builder = Alert.Builder(Math.floorMod(alert.id.hashCode(), 100_000), CarText.create(alert.errand.ifBlank { alert.title }), 12_000L)
      val detail = dev.apx.car.CarText.detail(alert.distanceLabel, alert.place?.name)
      if (detail.isNotEmpty()) builder.setSubtitle(CarText.create(detail))
      for (action in CarActions.forCarAlert(alert.actions)) {
        builder.addAction(
          Action.Builder()
            .setTitle(CarNotifications.actionLabel(carContext, action))
            .setOnClickListener { CarNav.answer(carContext, alert, action) }
            .build(),
        )
      }
      carContext.getCarService(AppManager::class.java).showAlert(builder.build())
    } catch (error: RuntimeException) {
      Log.w("ApxCar", "car alert not shown: ${error.javaClass.simpleName}")
    }
  }
}

/** Answering and handing a route to the car's navigation app, from any car screen. */
object CarNav {
  private var current: WeakReference<CarContext>? = null

  fun attach(context: CarContext) {
    current = WeakReference(context)
  }

  fun detach(context: CarContext) {
    if (current?.get() === context) current = null
  }

  /** Answer first, then navigate: handing the screen away is where an answer gets lost. */
  fun answer(context: CarContext, alert: CarAlert, action: String) {
    CarAnswers.answer(context, alert, action)
    if (CarActions.opensRoute(action)) navigate(context, alert.place, alert.errand)
    else androidx.car.app.CarToast.makeText(context, CarNotifications.ackLabel(context, action), androidx.car.app.CarToast.LENGTH_SHORT).show()
  }

  /** From outside a car screen (a voice reply): navigates if a car session is open. */
  fun navigateInCar(place: CarPlace?, label: String): Boolean {
    val context = current?.get() ?: return false
    Handler(Looper.getMainLooper()).post { navigate(context, place, label) }
    return true
  }

  fun navigate(context: CarContext, place: CarPlace?, label: String): Boolean {
    val uri = if (place != null) {
      val name = Uri.encode(place.name.ifBlank { label })
      Uri.parse("geo:${place.lat},${place.lon}?q=${place.lat},${place.lon}($name)")
    } else {
      Uri.parse("geo:0,0?q=${Uri.encode(label)}")
    }
    return try {
      context.startCarApp(Intent(CarContext.ACTION_NAVIGATE, uri))
      true
    } catch (error: RuntimeException) {
      Log.w("ApxCar", "car navigation refused: ${error.javaClass.simpleName}")
      androidx.car.app.CarToast.makeText(
        context,
        context.carString(R.string.apx_car_navigate_failed),
        androidx.car.app.CarToast.LENGTH_SHORT,
      ).show()
      false
    }
  }
}
