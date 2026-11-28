package dev.apx.voice

import android.content.Context
import android.util.Base64
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * The greeting the phone plays the moment it hears its name, recorded by the core in the owner's voice and language
 * and kept here, so it plays at once while the voice loads. The core records it again when the voice changes.
 */
object Greeting {
  private const val PREF = "greeting.quick"

  private fun file(context: Context) = File(context.filesDir, "apx-voice-greeting.pcm")

  /** The greeting as 24 kHz mono PCM16, when the phone holds one. */
  fun load(context: Context): ByteArray? = try {
    file(context).takeIf { it.isFile && it.length() > 0 }?.readBytes()
  } catch (_: Exception) {
    null
  }

  /** Asks the core for the current greeting; only downloads it when it changed. Runs off the main thread. */
  fun refresh(context: Context, core: Core) {
    val prefs = context.getSharedPreferences("apx.voice", Context.MODE_PRIVATE)
    val have = prefs.getString(PREF, "") ?: ""
    try {
      val p = JSONObject().put("mode", "quick")
      if (have.isNotEmpty() && file(context).isFile) p.put("have", have)
      val r = core.call("voice.greeting", p, timeoutS = 20)
      val key = r.optString("key")
      if (key == have && file(context).isFile) return
      val data = r.optString("data")
      // A new voice whose greeting is not recorded yet: the old one would greet in the wrong voice.
      if (!r.optBoolean("ready") || data.isEmpty()) {
        if (key.isNotEmpty() && key != have) forget(context)
        return
      }
      val pcm = samples(Base64.decode(data, Base64.DEFAULT)) ?: return
      val tmp = File(context.filesDir, "apx-voice-greeting.tmp")
      tmp.writeBytes(pcm)
      tmp.renameTo(file(context))
      prefs.edit().putString(PREF, key).apply()
    } catch (e: Exception) {
      Log.d(CallSession.TAG, "greeting not refreshed: $e")
    }
  }

  fun forget(context: Context) {
    file(context).delete()
    context.getSharedPreferences("apx.voice", Context.MODE_PRIVATE).edit().remove(PREF).apply()
  }

  /** The samples of a 24 kHz mono 16-bit WAV, or null when it is not one. */
  fun samples(wav: ByteArray): ByteArray? {
    if (wav.size < 44 || String(wav, 0, 4) != "RIFF" || String(wav, 8, 4) != "WAVE") return null
    val b = ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN)
    var at = 12
    var ok = false
    while (at + 8 <= wav.size) {
      val id = String(wav, at, 4)
      val size = b.getInt(at + 4)
      if (size < 0) return null
      if (id == "fmt ") {
        ok = b.getShort(at + 8).toInt() == 1 && b.getShort(at + 10).toInt() == 1 &&
          b.getInt(at + 12) == CallSession.DOWN_RATE && b.getShort(at + 22).toInt() == 16
      }
      if (id == "data") return if (ok) wav.copyOfRange(at + 8, minOf(wav.size, at + 8 + size)) else null
      at += 8 + size + (size % 2)
    }
    return null
  }
}
