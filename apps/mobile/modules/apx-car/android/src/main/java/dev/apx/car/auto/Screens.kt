package dev.apx.car.auto

import android.os.Handler
import android.os.Looper
import androidx.car.app.CarContext
import androidx.car.app.CarToast
import androidx.car.app.Screen
import androidx.car.app.constraints.ConstraintManager
import androidx.car.app.model.Action
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.car.app.versioning.CarAppApiLevels
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import dev.apx.car.AgentChat
import dev.apx.car.CarAlert
import dev.apx.car.CarAlertStore
import dev.apx.car.CarCore
import dev.apx.car.CarErrand
import dev.apx.car.CarNotifications
import dev.apx.car.CarPrefs
import dev.apx.car.CarText
import dev.apx.car.CarTripView
import dev.apx.car.CoreClient
import dev.apx.car.CoreError
import dev.apx.car.R
import dev.apx.car.carString
import org.json.JSONObject

private fun list(title: String, rows: List<Row>, back: Boolean): Template {
  val items = ItemList.Builder()
  rows.forEach { items.addItem(it) }
  return ListTemplate.Builder()
    .setSingleList(items.build())
    .setTitle(title)
    .setHeaderAction(if (back) Action.BACK else Action.APP_ICON)
    .build()
}

private fun row(title: String, vararg texts: String?, onClick: (() -> Unit)? = null): Row {
  val builder = Row.Builder().setTitle(title)
  texts.filter { !it.isNullOrBlank() }.take(2).forEach { builder.addText(it!!) }
  if (onClick != null) builder.setOnClickListener(onClick)
  return builder.build()
}

/**
 * The trip on the car: offers waiting for an answer first, then the open errands with their best place, then "Talk to
 * <agent>". Read-only on the core (car.trip never offers), refreshed on new offers and every 30 s while visible.
 */
class TripScreen(carContext: CarContext) : Screen(carContext), DefaultLifecycleObserver {
  private val main = Handler(Looper.getMainLooper())
  private var view: CarTripView? = null
  private var asked = false
  private var unreachable = false
  private val refresh = object : Runnable {
    override fun run() {
      load()
      main.postDelayed(this, REFRESH_MS)
    }
  }
  private val onAlerts: (List<CarAlert>) -> Unit = { main.post { invalidate() } }

  init {
    lifecycle.addObserver(this)
  }

  override fun onStart(owner: LifecycleOwner) {
    CarAlertStore.addListener(onAlerts)
    main.post(refresh)
  }

  override fun onStop(owner: LifecycleOwner) {
    CarAlertStore.removeListener(onAlerts)
    main.removeCallbacks(refresh)
  }

  private fun load() {
    val app = carContext.applicationContext
    if (!CarPrefs(app).active) {
      asked = true
      invalidate()
      return
    }
    CoreClient.io.execute {
      val result = try {
        CarTripView.from(CoreClient.call(app, "car.trip", JSONObject()))
      } catch (_: CoreError) {
        null
      } catch (_: RuntimeException) {
        null
      }
      main.post {
        asked = true
        unreachable = result == null
        if (result != null) {
          view = result
          CarAlertStore.put(result.alerts, quiet = true)
        }
        invalidate()
      }
    }
  }

  override fun onGetTemplate(): Template {
    val context = carContext
    val title = context.carString(R.string.apx_car_screen_title)
    val prefs = CarPrefs(context)
    if (!prefs.active) return list(title, listOf(row(context.carString(R.string.apx_car_off))), back = false)

    val max = maxRows()
    val rows = mutableListOf<Row>()
    val alerts = CarAlertStore.all()
    for (alert in alerts) {
      if (rows.size >= max - 1) break
      rows += row(alert.errand.ifBlank { alert.title }, CarText.detail(alert.distanceLabel, alert.place?.name, alert.place?.address)) {
        screenManager.push(AlertScreen(context, alert.id))
      }
    }
    val offered = alerts.map { it.taskId }.toSet()
    for (errand in view?.errands.orEmpty()) {
      if (rows.size >= max - 1) break
      if (errand.taskId in offered) continue
      val held = when (errand.held) {
        "skip" -> context.carString(R.string.apx_car_held_skip)
        "later" -> context.carString(R.string.apx_car_held_later)
        else -> null
      }
      rows += row(errand.title.ifBlank { errand.best?.name ?: "" }, CarText.detail(CarText.distanceLabel(errand.distanceM), errand.best?.name, held)) {
        screenManager.push(ErrandScreen(context, errand))
      }
    }
    if (rows.isEmpty()) {
      val empty = when {
        !asked -> R.string.apx_car_loading
        unreachable -> R.string.apx_car_unreachable
        else -> R.string.apx_car_no_errands
      }
      rows += row(context.carString(empty))
    }
    rows += row(context.carString(R.string.apx_car_talk, prefs.agentName), context.carString(R.string.apx_car_talk_hint)) {
      AgentChat.prompt(context.applicationContext)
      CarToast.makeText(context, context.carString(R.string.apx_car_talk_hint), CarToast.LENGTH_SHORT).show()
    }
    return list(title, rows, back = false)
  }

  private fun maxRows(): Int = try {
    if (carContext.carAppApiLevel >= CarAppApiLevels.LEVEL_2) {
      carContext.getCarService(ConstraintManager::class.java)
        .getContentLimit(ConstraintManager.CONTENT_LIMIT_TYPE_LIST).coerceIn(3, 8)
    } else {
      6
    }
  } catch (_: RuntimeException) {
    6
  }

  companion object {
    private const val REFRESH_MS = 30_000L
  }
}

/** One offer with every answer the core gave it. */
class AlertScreen(carContext: CarContext, private val alertId: String) : Screen(carContext) {
  override fun onGetTemplate(): Template {
    val context = carContext
    val alert = CarAlertStore.get(alertId)
      ?: return list(context.carString(R.string.apx_car_screen_title), listOf(row(context.carString(R.string.apx_car_alert_gone))), back = true)
    val rows = mutableListOf(row(alert.errand.ifBlank { alert.title }, CarText.detail(alert.distanceLabel, alert.place?.name), alert.place?.address))
    for (action in alert.actions) {
      rows += row(CarNotifications.actionLabel(context, action)) {
        CarNav.answer(context, alert, action)
        screenManager.pop()
      }
    }
    return list(alert.title, rows, back = true)
  }
}

/** An errand from the list, without an offer: go there now, done, or not this trip. */
class ErrandScreen(carContext: CarContext, private val errand: CarErrand) : Screen(carContext) {
  override fun onGetTemplate(): Template {
    val context = carContext
    val app = context.applicationContext
    val title = errand.title.ifBlank { errand.best?.name ?: "" }
    val rows = mutableListOf(row(title, CarText.detail(CarText.distanceLabel(errand.distanceM), errand.best?.name), errand.best?.address))
    rows += row(context.carString(R.string.apx_car_errand_navigate)) {
      CarCore.errand(app, errand.taskId, "navigate")
      CarNav.navigate(context, errand.best, title)
      screenManager.pop()
    }
    rows += row(context.carString(R.string.apx_car_errand_done)) {
      CarCore.errand(app, errand.taskId, "done")
      CarToast.makeText(context, context.carString(R.string.apx_car_ack_done), CarToast.LENGTH_SHORT).show()
      screenManager.pop()
    }
    rows += row(context.carString(R.string.apx_car_errand_skip)) {
      CarCore.errand(app, errand.taskId, "skip")
      CarToast.makeText(context, context.carString(R.string.apx_car_ack_skip), CarToast.LENGTH_SHORT).show()
      screenManager.pop()
    }
    return list(title, rows, back = true)
  }
}
