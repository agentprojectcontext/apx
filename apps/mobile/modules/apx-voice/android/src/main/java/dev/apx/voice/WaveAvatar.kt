package dev.apx.voice

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.view.View
import org.json.JSONArray
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/** The agent's avatar with waves that leave it as its voice plays, and a slow breath while it thinks. */
class WaveAvatar(context: Context, private val accent: Int, private val initialsBg: Int, private val fg: Int) : View(context) {
  var bitmap: Bitmap? = null
  var eyes: JSONArray = JSONArray()
  var eyeColor: Int = Color.parseColor("#15181C")
  var initials: String = "A"
  private var smooth = 0f
  private var phase = 0f
  private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val img = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
  private val eye = Paint(Paint.ANTI_ALIAS_FLAG)
  private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER; isFakeBoldText = true }
  private val disc = Paint(Paint.ANTI_ALIAS_FLAG)

  override fun onDraw(canvas: Canvas) {
    val cx = width / 2f
    val cy = height / 2f
    // The avatar takes 58% of the box; the waves use the rest.
    val r = min(width, height) * 0.29f
    val target = when (VoiceState.phase) {
      "speaking", "listening" -> if (VoiceState.audible()) VoiceState.level else 0f
      "thinking", "connecting", "preparing" -> 0.10f + 0.08f * sin(phase * 1.6f).let { (it + 1) / 2 }
      else -> 0f
    }
    smooth = smooth * 0.78f + target * 0.22f
    phase += 0.06f
    for (i in 0 until 3) {
      val t = ((phase * 0.35f + i / 3f) % 1f)
      val grow = r * (1f + t * (0.25f + smooth * 1.1f))
      val alpha = ((1f - t) * min(1f, smooth * 3.2f) * 90).toInt()
      if (alpha <= 2) continue
      ring.color = Color.argb(alpha, Color.red(accent), Color.green(accent), Color.blue(accent))
      canvas.drawCircle(cx, cy, grow, ring)
    }
    val bmp = bitmap
    if (bmp != null) {
      val box = RectF(cx - r, cy - r, cx + r, cy + r)
      canvas.drawBitmap(bmp, null, box, img)
      eye.color = eyeColor
      val s = (2 * r) / 256f
      for (k in 0 until eyes.length()) {
        val e = eyes.optJSONObject(k) ?: continue
        val x = box.left + e.optDouble("x").toFloat() * s
        val y = box.top + e.optDouble("y").toFloat() * s
        val w = e.optDouble("w").toFloat() * s
        // The eyes blink now and then, and open a little more while it speaks.
        val blink = if ((phase % 9f) > 8.75f) 0.15f else 1f
        val h = e.optDouble("h").toFloat() * s * blink * (1f + smooth * 0.12f)
        val rx = e.optDouble("rx").toFloat() * s
        val top = y + (e.optDouble("h").toFloat() * s - h) / 2
        canvas.drawRoundRect(RectF(x, top, x + w, top + h), rx, rx, eye)
      }
    } else {
      disc.color = initialsBg
      canvas.drawCircle(cx, cy, r, disc)
      text.color = fg
      text.textSize = r * 0.7f
      canvas.drawText(initials, cx, cy + text.textSize * 0.35f, text)
    }
    postInvalidateOnAnimation()
  }

  companion object {
    /** The avatar's picture from what the app gave: a bundled image's resource name, a file, or nothing. */
    fun load(context: Context, uri: String): Bitmap? = try {
      when {
        uri.isEmpty() -> null
        uri.startsWith("file://") -> BitmapFactory.decodeFile(uri.removePrefix("file://"))
        uri.startsWith("http") -> java.net.URL(uri).openStream().use { BitmapFactory.decodeStream(it) }
        else -> {
          val id = context.resources.getIdentifier(uri, "drawable", context.packageName)
          if (id != 0) BitmapFactory.decodeResource(context.resources, id) else null
        }
      }
    } catch (_: Exception) {
      null
    }

    fun clamp(v: Float) = max(0f, min(1f, v))
  }
}
