package dev.apx.car.auto

import android.os.Handler
import android.os.Looper
import androidx.car.app.CarContext
import androidx.car.app.CarToast
import androidx.car.app.Screen
import androidx.car.app.constraints.ConstraintManager
import androidx.car.app.model.Action
import androidx.car.app.model.CarColor
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
          CarAlertStore.sync(result.alerts)
        }
        invalidate()
      }
    }
  }

  override fun onGetTemplate(): Template = safely(carContext) { tripTemplate() }

  private fun tripTemplate(): Template {
    val context = carContext
    val title = context.carString(R.string.apx_car_screen_title)
    val prefs = CarPrefs(context)
    if (!prefs.active) return apxMessage(context, title, context.carString(R.string.apx_car_off))
    val talk = talkStrip(context, context.carString(R.string.apx_car_talk, prefs.agentName)) {
      AgentChat.prompt(context.applicationContext)
      CarToast.makeText(context, context.carString(R.string.apx_car_talk_hint), CarToast.LENGTH_SHORT).show()
    }
    if (!asked) return placesMap(context, title, emptyList(), back = false, strip = talk, loading = true)

    val max = maxRows()
    val rows = mutableListOf<Row>()
    val alerts = CarAlertStore.all()
    // Offers first, in green; then the other errands by distance, in blue.
    for (alert in alerts) {
      if (rows.size >= max) break
      rows += placeRow(
        context, alert.errand.ifBlank { alert.title }, alert.place, alert.distanceM,
        CarText.detail(if (alert.distanceM == null) alert.distanceLabel else null, alert.place?.name),
        CarColor.GREEN,
      ) { screenManager.push(AlertScreen(context, alert.id)) }
    }
    val offered = alerts.map { it.taskId }.toSet()
    val errands = view?.errands.orEmpty().filter { it.taskId !in offered }.sortedBy { it.distanceM ?: Int.MAX_VALUE }
    for (errand in errands) {
      if (rows.size >= max) break
      val held = when (errand.held) {
        "skip" -> context.carString(R.string.apx_car_held_skip)
        "later" -> context.carString(R.string.apx_car_held_later)
        else -> null
      }
      val best = errand.best
      rows += placeRow(
        context, errand.title.ifBlank { best?.name ?: "" }, best, errand.distanceM,
        CarText.detail(best?.name, held),
        CarColor.BLUE,
      ) { screenManager.push(ErrandScreen(context, errand)) }
    }
    if (rows.isEmpty()) {
      val empty = if (unreachable) R.string.apx_car_unreachable else R.string.apx_car_no_errands
      return apxMessage(context, title, context.carString(empty))
    }
    // The map starts where the owner is: a head unit without its own location would otherwise open it at 0,0.
    return placesMap(context, title, rows, back = false, strip = talk, anchor = NearbySearch.lastPoint(context))
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
  override fun onGetTemplate(): Template = safely(carContext) { build() }

  private fun build(): Template {
    val context = carContext
    val alert = CarAlertStore.get(alertId)
      ?: return apxMessage(context, context.carString(R.string.apx_car_screen_title), context.carString(R.string.apx_car_alert_gone))
    // The header names the errand; the first row says where it is, then the answers.
    val errand = alert.errand.ifBlank { alert.title }
    val place = alert.place
    val rows = mutableListOf(
      if (place != null) row(place.name.ifBlank { errand }, alert.distanceLabel, place.address)
      else row(errand, alert.distanceLabel),
    )
    for (action in alert.actions) {
      rows += row(CarNotifications.actionLabel(context, action)) {
        CarNav.answer(context, alert, action)
        screenManager.pop()
      }
    }
    return answersList(errand, rows)
  }
}

/**
 * An errand from the list, without an offer: go there now, done, or not this trip. One with no place yet looks for
 * one where the owner is now (car.preview) and shows it when found.
 */
class ErrandScreen(carContext: CarContext, private val errand: CarErrand) : Screen(carContext) {
  private val main = Handler(Looper.getMainLooper())
  private var found: CarErrand? = null
  private var search: Int = if (errand.best == null) R.string.apx_car_errand_searching else 0

  init {
    if (errand.best == null) lookNearby()
  }

  override fun onGetTemplate(): Template = safely(carContext) { build() }

  private fun lookNearby() {
    val app = carContext.applicationContext
    val here = NearbySearch.lastPoint(app)
    if (here == null) {
      search = R.string.apx_car_errand_no_location
      return
    }
    CoreClient.io.execute {
      val match = NearbySearch.preview(app, here, errand.taskId)
      main.post {
        found = match
        search = if (match?.best == null) R.string.apx_car_errand_none_near else 0
        invalidate()
      }
    }
  }

  private fun build(): Template {
    val context = carContext
    val app = context.applicationContext
    val title = errand.title.ifBlank { errand.best?.name ?: "" }
    val current = found ?: errand
    val best = current.best
    // The header already names the errand: the rows say where, and Maps only opens for a known place.
    val rows = mutableListOf<Row>()
    if (best == null) {
      rows += row(context.carString(if (search != 0) search else R.string.apx_car_errand_no_place))
    } else {
      rows += row(best.name.ifBlank { title }, CarText.distanceLabel(current.distanceM), best.address)
      rows += row(context.carString(R.string.apx_car_errand_navigate)) {
        CarCore.errand(app, errand.taskId, "navigate")
        CarNav.navigate(context, best, title)
        screenManager.pop()
      }
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
    return answersList(title, rows)
  }
}
