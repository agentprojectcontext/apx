package dev.apx.car

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/** What went wrong calling the core: `offline` (no answer), `unauthorized` (the key was revoked) or the core's code. */
class CoreError(val code: String, message: String) : Exception(message)

/**
 * The core's protocol over HTTP: POST `<url>/rpc/<method>` with the phone's key, the same handlers the app's
 * client uses. Blocking: call it from [io] (ordered: a trip's start goes before its positions and its end) or
 * [chat] (long waits for the super-agent).
 */
object CoreClient {
  private const val TAG = "ApxCar"
  const val TIMEOUT_MS = 10_000

  val io: ExecutorService = Executors.newSingleThreadExecutor { Thread(it, "apx-car-io") }
  val chat: ExecutorService = Executors.newSingleThreadExecutor { Thread(it, "apx-car-chat") }

  /** Returns the method's `result` (a JSONObject for every car.* method), or throws [CoreError]. */
  fun call(context: Context, method: String, params: JSONObject, timeoutMs: Int = TIMEOUT_MS): JSONObject {
    val prefs = CarPrefs(context)
    if (method == "car.position" && (!prefs.active || prefs.tripId != params.optString("trip_id")))
      throw CoreError("unauthorized", "trip stopped")
    if (prefs.url.isEmpty() || prefs.token.isEmpty()) throw CoreError("unauthorized", "not paired")
    val connection = try {
      URL("${prefs.url}/rpc/$method").openConnection() as HttpURLConnection
    } catch (error: Exception) {
      throw CoreError("offline", error.javaClass.simpleName)
    }
    try {
      connection.requestMethod = "POST"
      connection.connectTimeout = minOf(timeoutMs, TIMEOUT_MS)
      connection.readTimeout = timeoutMs
      connection.doOutput = true
      connection.setRequestProperty("Content-Type", "application/json")
      connection.setRequestProperty("Authorization", "Bearer ${prefs.token}")
      // The core uses the key only for methods with effects; a fresh one per call means a retry is a new request.
      connection.setRequestProperty("Idempotency-Key", UUID.randomUUID().toString())
      connection.outputStream.use { it.write(params.toString().toByteArray(Charsets.UTF_8)) }
      val status = connection.responseCode
      val stream = if (status in 200..299) connection.inputStream else connection.errorStream
      val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
      val body = try {
        JSONObject(text)
      } catch (error: Exception) {
        throw CoreError(if (status == 401 || status == 403) "unauthorized" else "internal", "HTTP $status")
      }
      if (!body.optBoolean("ok", false)) {
        val error = body.optJSONObject("error")
        val code = error?.optString("code").orEmpty().ifBlank { "internal" }
        throw CoreError(code, error?.optString("message").orEmpty().ifBlank { "HTTP $status" })
      }
      return body.optJSONObject("result") ?: JSONObject()
    } catch (error: IOException) {
      throw CoreError("offline", error.javaClass.simpleName)
    } finally {
      connection.disconnect()
    }
  }

  /** On [io]; a failure is recorded in the owner's words and logged without the request. */
  fun send(context: Context, method: String, params: JSONObject, done: (JSONObject?) -> Unit = {}) {
    val app = context.applicationContext
    io.execute {
      val result = try {
        call(app, method, params).also { CarPrefs(app).setError(null) }
      } catch (error: CoreError) {
        Log.w(TAG, "$method failed: ${error.code}")
        CarPrefs(app).setError(ownerWords(app, error))
        null
      } catch (error: RuntimeException) {
        Log.w(TAG, "$method failed: ${error.javaClass.simpleName}")
        CarPrefs(app).setError(app.carString(R.string.apx_car_error_other))
        null
      }
      try {
        done(result)
      } catch (error: RuntimeException) {
        Log.w(TAG, "$method result handling failed: ${error.javaClass.simpleName}")
      }
      TripController.publishStatus(app)
    }
  }

  fun ownerWords(context: Context, error: CoreError): String = context.carString(
    when (error.code) {
      "offline" -> R.string.apx_car_error_offline
      "unauthorized" -> R.string.apx_car_error_unpaired
      else -> R.string.apx_car_error_other
    },
  )
}
