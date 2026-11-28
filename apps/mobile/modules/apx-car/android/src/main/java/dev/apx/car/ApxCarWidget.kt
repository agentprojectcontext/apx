package dev.apx.car

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.view.View
import android.widget.RemoteViews

/**
 * The home-screen widget for errands on the way: the offer waiting for an answer with Go now and Another place, or a
 * line saying nothing is near. A plain app widget, so Android Auto can show it once it shows phone widgets
 * (rules/ERRANDS_ON_THE_WAY.md#widget). Redrawn when offers change or a trip ends, never on a timer.
 */
class ApxCarWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    watch(context)
    render(context, manager, ids)
  }

  companion object {
    private const val OPEN_REQUEST = 7100
    private const val GO_REQUEST = 7101
    private const val NEXT_REQUEST = 7102

    @Volatile
    private var watching = false

    /** Redraws the widget whenever the offers change; once per process. */
    fun watch(context: Context) {
      if (watching) return
      watching = true
      val app = context.applicationContext
      CarAlertStore.addListener { refresh(app) }
    }

    fun refresh(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, ApxCarWidget::class.java))
      if (ids.isNotEmpty()) render(context, manager, ids)
    }

    private fun render(context: Context, manager: AppWidgetManager, ids: IntArray) {
      val views = RemoteViews(context.packageName, R.layout.apx_car_widget)
      val alert = CarAlertStore.latest()
      open(context)?.let { views.setOnClickPendingIntent(R.id.apx_car_widget, it) }
      if (alert == null) {
        val driving = CarPrefs(context).let { it.active && it.tripActive }
        views.setTextViewText(
          R.id.apx_car_widget_title,
          context.carString(if (driving) R.string.apx_car_widget_driving else R.string.apx_car_widget_idle),
        )
        views.setViewVisibility(R.id.apx_car_widget_where, View.GONE)
        views.setViewVisibility(R.id.apx_car_widget_actions, View.GONE)
      } else {
        views.setTextViewText(R.id.apx_car_widget_title, alert.errand.ifBlank { alert.title })
        val where = CarText.detail(alert.place?.name, alert.distanceLabel)
        views.setTextViewText(R.id.apx_car_widget_where, where)
        views.setViewVisibility(R.id.apx_car_widget_where, if (where.isBlank()) View.GONE else View.VISIBLE)
        views.setViewVisibility(R.id.apx_car_widget_actions, View.VISIBLE)
        views.setOnClickPendingIntent(
          R.id.apx_car_widget_go,
          CarActionReceiver.answerIntent(context, alert, "navigate", GO_REQUEST),
        )
        val next = "next" in alert.actions
        views.setViewVisibility(R.id.apx_car_widget_next, if (next) View.VISIBLE else View.GONE)
        if (next) {
          views.setOnClickPendingIntent(
            R.id.apx_car_widget_next,
            CarActionReceiver.answerIntent(context, alert, "next", NEXT_REQUEST),
          )
        }
      }
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
