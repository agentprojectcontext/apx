package dev.apx.car.auto

import android.Manifest
import android.content.pm.PackageManager
import android.text.SpannableString
import android.text.Spanned
import androidx.car.app.CarContext
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.CarColor
import androidx.car.app.model.CarIcon
import androidx.car.app.model.CarLocation
import androidx.car.app.model.Distance
import androidx.car.app.model.DistanceSpan
import androidx.car.app.model.ForegroundCarColorSpan
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Metadata
import androidx.car.app.model.Place
import androidx.car.app.model.PlaceListMapTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.IconCompat
import dev.apx.car.CarPlace
import dev.apx.car.R
import dev.apx.car.carString

// The car screens as Android Auto draws a places app: a map with the errands' places marked and the list beside it.

/** A list beside a map of its rows' places; the owner's own position shows when location is granted. */
internal fun placesMap(
  context: CarContext,
  title: String,
  rows: List<Row>,
  back: Boolean,
  strip: ActionStrip? = null,
  loading: Boolean = false,
  anchor: android.location.Location? = null,
): Template {
  val builder = PlaceListMapTemplate.Builder()
    .setTitle(title)
    .setHeaderAction(if (back) Action.BACK else Action.APP_ICON)
  if (loading) builder.setLoading(true)
  else builder.setItemList(ItemList.Builder().apply { rows.forEach { addItem(it) } }.build())
  if (strip != null) builder.setActionStrip(strip)
  if (anchor != null) builder.setAnchor(Place.Builder(CarLocation.create(anchor.latitude, anchor.longitude)).build())
  if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
    builder.setCurrentLocationEnabled(true)
  }
  return builder.build()
}

/**
 * A place row: its title, the distance in the car's own units and colour, then where; a pin on the map when the
 * place is known.
 */
internal fun placeRow(
  context: CarContext,
  title: String,
  place: CarPlace?,
  distanceM: Int?,
  where: String?,
  color: CarColor,
  onClick: (() -> Unit)? = null,
): Row {
  val builder = Row.Builder().setTitle(title)
  val line = distanceLine(distanceM, where, color)
  if (line != null) builder.addText(line)
  if (place != null) {
    // A pin in the errand's colour beside the row (a row takes an image or a marker, not both).
    val pin = CarIcon.Builder(IconCompat.createWithResource(context, R.drawable.ic_apx_car_pin)).setTint(color).build()
    builder.setImage(pin, Row.IMAGE_TYPE_ICON)
    builder.setMetadata(
      Metadata.Builder()
        .setPlace(Place.Builder(CarLocation.create(place.lat, place.lon)).build())
        .build(),
    )
  }
  if (onClick != null) builder.setOnClickListener(onClick)
  // On a map list every row needs its distance; one without (no place yet) opens its screen instead.
  if (place == null || distanceM == null || distanceM < 0) builder.setBrowsable(true)
  return builder.build()
}

/** A plain list, for screens whose rows are answers rather than places. */
internal fun answersList(title: String, rows: List<Row>): Template =
  ListTemplate.Builder()
    .setSingleList(ItemList.Builder().apply { rows.forEach { addItem(it) } }.build())
    .setTitle(title)
    .setHeaderAction(Action.BACK)
    .build()

/** A screen that fails to build shows a message instead of stopping APX: the car app shares the phone app's process. */
internal fun safely(context: CarContext, build: () -> Template): Template = try {
  build()
} catch (error: RuntimeException) {
  android.util.Log.w("ApxCar", "car screen not built: ${error.javaClass.simpleName}: ${error.message}")
  apxMessage(context, context.carString(R.string.apx_car_screen_title), context.carString(R.string.apx_car_screen_failed))
}

private fun distanceLine(distanceM: Int?, where: String?, color: CarColor): CharSequence? {
  val rest = where?.takeIf { it.isNotBlank() }
  if (distanceM == null || distanceM < 0) return rest
  val distance = if (distanceM >= 1000) Distance.create(distanceM / 1000.0, Distance.UNIT_KILOMETERS)
  else Distance.create(distanceM.toDouble(), Distance.UNIT_METERS)
  // The span replaces one placeholder character; the host writes the distance in the car's units.
  val text = SpannableString(if (rest == null) " " else "  ·  $rest")
  text.setSpan(DistanceSpan.create(distance), 0, 1, Spanned.SPAN_INCLUSIVE_INCLUSIVE)
  text.setSpan(ForegroundCarColorSpan.create(color), 0, 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
  return text
}

/** "Talk to <agent>" as a button over the map. */
internal fun talkStrip(context: CarContext, label: String, onClick: () -> Unit): ActionStrip =
  ActionStrip.Builder()
    .addAction(
      Action.Builder()
        .setTitle(label)
        .setIcon(CarIcon.Builder(IconCompat.createWithResource(context, R.drawable.ic_apx_car_talk)).build())
        .setOnClickListener(onClick)
        .build(),
    )
    .build()

/** A message with APX's icon, for when there is nothing to list (car mode off, the core away). */
internal fun apxMessage(context: CarContext, title: String, message: String): Template =
  MessageTemplate.Builder(message)
    .setTitle(title)
    .setHeaderAction(Action.APP_ICON)
    .setIcon(CarIcon.Builder(IconCompat.createWithResource(context, R.drawable.ic_apx_car)).build())
    .build()
