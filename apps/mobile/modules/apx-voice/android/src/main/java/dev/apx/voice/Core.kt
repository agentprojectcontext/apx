package dev.apx.voice

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

/** The owner's core, as this phone reaches it: its methods over HTTP with the phone's own key. */
class Core(private val url: String, private val token: String) {
  class Failed(message: String) : Exception(message)

  fun call(method: String, params: JSONObject, effect: Boolean = false, timeoutS: Long = 15): JSONObject {
    val req = Request.Builder()
      .url("${url.trimEnd('/')}/rpc/$method")
      .header("Authorization", "Bearer $token")
      .apply { if (effect) header("Idempotency-Key", UUID.randomUUID().toString()) }
      .post(params.toString().toRequestBody("application/json".toMediaType()))
      .build()
    val client = http.newBuilder().callTimeout(timeoutS, TimeUnit.SECONDS).build()
    client.newCall(req).execute().use { res ->
      val body = JSONObject(res.body?.string() ?: "{}")
      if (!body.optBoolean("ok")) throw Failed(body.optJSONObject("error")?.optString("message") ?: "HTTP ${res.code}")
      return body.optJSONObject("result") ?: JSONObject()
    }
  }

  /** The call's socket address: the core's, as ws(s). */
  fun socket(path: String): String = url.trimEnd('/').replaceFirst("http", "ws") + path

  companion object {
    val http: OkHttpClient = OkHttpClient.Builder()
      .connectTimeout(8, TimeUnit.SECONDS)
      .readTimeout(0, TimeUnit.SECONDS)
      .pingInterval(20, TimeUnit.SECONDS)
      .build()
  }
}
