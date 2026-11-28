package dev.apx.car

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject

/**
 * The home-screen widget for errands on the way: up to four errands near the way, the offers waiting for an answer
 * first, each with its closest place and distance; a row opens its route. A plain app widget, so Android Auto can
 * show it once it shows phone widgets (rules/ERRANDS_ON_THE_WAY.md#widget). Read from car.trip when offers change, a
 * trip starts or ends, and at most once a minute while driving; never on a timer of its own.
 */
class ApxCarWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    watch(context)
    render(context, manager, ids)
    reload(context)
  }

  /** One line of the list: what to do, where, and what a tap opens. */
  private data class Line(val title: String, val where: String, val tap: PendingIntent?)

  companion object {
    private const val OPEN_REQUEST = 7100
    private const val ROW_REQUEST = 7110
    private const val ROWS = 4
    private const val DRIVING_RELOAD_MS = 60_000L
    private val ROW_IDS = intArrayOf(R.id.apx_car_widget_row0, R.id.apx_car_widget_row1, R.id.apx_car_widget_row2, R.id.apx_car_widget_row3)
    private val TITLE_IDS = intArrayOf(
      R.id.apx_car_widget_row0_title, R.id.apx_car_widget_row1_title, R.id.apx_car_widget_row2_title, R.id.apx_car_widget_row3_title,
    )
    private val WHERE_IDS = intArrayOf(
      R.id.apx_car_widget_row0_where, R.id.apx_car_widget_row1_where, R.id.apx_car_widget_row2_where, R.id.apx_car_widget_row3_where,
    )
    private val main = Handler(Looper.getMainLooper())

    @Volatile
    private var watching = false

    @Volatile
    private var trip: CarTripView? = null

    @Volatile
    private var readAt = 0L

    /** Redraws the widget whenever the offers change; once per process. */
    fun watch(context: Context) {
      if (watching) return
      watching = true
      val app = context.applicationContext
      CarAlertStore.addListener { reload(app) }
    }

    /** Reads the errands again after a point, at most once a minute. */
    fun afterPoint(context: Context) {
      if (SystemClock.elapsedRealtime() - readAt >= DRIVING_RELOAD_MS) reload(context)
    }

    /** Reads car.trip and redraws; without a paired core it only redraws what it has. */
    fun reload(context: Context) {
      val app = context.applicationContext
      if (!hasWidgets(app)) return
      val prefs = CarPrefs(app)
      if (prefs.url.isEmpty() || prefs.token.isEmpty()) {
        main.post { refresh(app) }
        return
      }
      readAt = SystemClock.elapsedRealtime()
      CoreClient.io.execute {
        val view = try {
          CarTripView.from(CoreClient.call(app, "car.trip", JSONObject()))
        } catch (_: Exception) {
          null
        }
        if (view != null) trip = view
        main.post { refresh(app) }
      }
    }

    fun refresh(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, ApxCarWidget::class.java))
      if (ids.isNotEmpty()) render(context, manager, ids)
    }

    private fun hasWidgets(context: Context): Boolean =
      AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, ApxCarWidget::class.java)).isNotEmpty()

    private fun lines(context: Context): List<Line> {
      val offers = CarAlertStore.all()
      val offered = offers.map { it.taskId }.toSet()
      val fromOffers = offers.mapIndexed { i, alert ->
        Line(
          alert.errand.ifBlank { alert.title },
          CarText.detail(alert.place?.name, alert.distanceLabel),
          CarActionReceiver.answerIntent(context, alert, "navigate", ROW_REQUEST + i),
        )
      }
      val errands = (trip?.errands ?: emptyList())
        .filter { it.taskId !in offered && it.held != "skip" }
        .sortedBy { it.distanceM ?: Int.MAX_VALUE }
      val fromErrands = errands.mapIndexed { i, errand ->
        val best = errand.best
        Line(
          errand.title,
          if (best == null) "" else CarText.detail(best.name, CarText.distanceLabel(errand.distanceM)),
          if (best == null) null else CarActionReceiver.errandIntent(context, errand.taskId, best, ROW_REQUEST + offers.size + i),
        )
      }
      return (fromOffers + fromErrands).take(ROWS)
    }

    private fun render(context: Context, manager: AppWidgetManager, ids: IntArray) {
      val views = RemoteViews(context.packageName, R.layout.apx_car_widget)
      val open = open(context)
      open?.let { views.setOnClickPendingIntent(R.id.apx_car_widget, it) }
      val list = lines(context)
      for (i in 0 until ROWS) {
        val line = list.getOrNull(i)
        views.setViewVisibility(ROW_IDS[i], if (line == null) View.GONE else View.VISIBLE)
        if (line == null) continue
        views.setTextViewText(TITLE_IDS[i], line.title)
        views.setTextViewText(WHERE_IDS[i], line.where)
        views.setViewVisibility(WHERE_IDS[i], if (line.where.isBlank()) View.GONE else View.VISIBLE)
        (line.tap ?: open)?.let { views.setOnClickPendingIntent(ROW_IDS[i], it) }
      }
      val driving = CarPrefs(context).let { it.active && it.tripActive }
      val empty = when {
        list.isNotEmpty() -> null
        trip != null && trip?.errands.isNullOrEmpty() -> R.string.apx_car_widget_none
        driving -> R.string.apx_car_widget_driving
        else -> R.string.apx_car_widget_idle
      }
      views.setViewVisibility(R.id.apx_car_widget_empty, if (empty == null) View.GONE else View.VISIBLE)
      if (empty != null) views.setTextViewText(R.id.apx_car_widget_empty, context.carString(empty))
      manager.updateAppWidget(ids, views)
    }

    private fun open(context: Context): PendingIntent? {
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
      return PendingIntent.getActivity(
        context, OPEN_REQUEST, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }
  }
}
