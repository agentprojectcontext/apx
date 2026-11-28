package dev.apx.car

import org.json.JSONArray
import org.json.JSONObject

// The shapes of packages/protocol/src/car.ts that the phone reads. Unknown fields are ignored; the core validates.

data class CarPlace(
  val key: String,
  val name: String,
  val lat: Double,
  val lon: Double,
  val address: String?,
) {
  companion object {
    fun from(json: JSONObject?): CarPlace? {
      if (json == null || !json.has("lat") || !json.has("lon")) return null
      return CarPlace(
        key = json.optString("key"),
        name = json.optString("name"),
        lat = json.optDouble("lat"),
        lon = json.optDouble("lon"),
        address = json.optString("address").ifBlank { null },
      )
    }
  }
}

data class CarAlert(
  val id: String,
  val tripId: String,
  val taskId: String,
  val errand: String,
  val place: CarPlace?,
  val distanceLabel: String,
  val title: String,
  val spoken: String,
  val actions: List<String>,
  val navigateUrl: String,
  val addStopUrl: String?,
  val answered: Boolean,
) {
  companion object {
    fun from(json: JSONObject): CarAlert? {
      val id = json.optString("id")
      if (id.isBlank()) return null
      return CarAlert(
        id = id,
        tripId = json.optString("trip_id"),
        taskId = json.optString("task_id"),
        errand = json.optString("errand"),
        place = CarPlace.from(json.optJSONObject("place")),
        distanceLabel = json.optString("distance_label"),
        title = json.optString("title").ifBlank { json.optString("errand") },
        spoken = json.optString("spoken").ifBlank { json.optString("title") },
        actions = strings(json.optJSONArray("actions")),
        navigateUrl = json.optString("navigate_url"),
        addStopUrl = json.optString("add_stop_url").ifBlank { null },
        answered = json.optString("answer").isNotBlank(),
      )
    }

    fun list(array: JSONArray?): List<CarAlert> =
      (0 until (array?.length() ?: 0)).mapNotNull { array?.optJSONObject(it)?.let(::from) }
  }

  fun urlFor(action: String): String? = when (action) {
    CarActions.NAVIGATE -> navigateUrl.ifBlank { null }
    CarActions.ADD_STOP -> addStopUrl ?: navigateUrl.ifBlank { null }
    else -> null
  }
}

data class CarErrand(
  val taskId: String,
  val title: String,
  val best: CarPlace?,
  val distanceM: Int?,
  val held: String?,
) {
  companion object {
    fun from(json: JSONObject): CarErrand? {
      val id = json.optString("task_id")
      if (id.isBlank()) return null
      return CarErrand(
        taskId = id,
        title = json.optString("title"),
        best = CarPlace.from(json.optJSONObject("best")),
        distanceM = if (json.has("distance_m")) json.optInt("distance_m") else null,
        held = json.optString("held").ifBlank { null },
      )
    }
  }
}

data class CarTripView(val tripId: String?, val alerts: List<CarAlert>, val errands: List<CarErrand>) {
  companion object {
    fun from(json: JSONObject): CarTripView {
      val errands = json.optJSONArray("errands")
      return CarTripView(
        tripId = json.optJSONObject("trip")?.optString("id")?.ifBlank { null },
        alerts = CarAlert.list(json.optJSONArray("alerts")).filter { !it.answered },
        errands = (0 until (errands?.length() ?: 0)).mapNotNull { errands?.optJSONObject(it)?.let(CarErrand::from) },
      )
    }
  }
}

private fun strings(array: JSONArray?): List<String> =
  (0 until (array?.length() ?: 0)).mapNotNull { array?.optString(it)?.ifBlank { null } }
