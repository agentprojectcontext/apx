package dev.apx.voice

import android.app.Activity
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONArray

/**
 * The call on screen, over the lock screen too: a floating card at the bottom for a request said by name (what is on
 * screen stays visible), or the phone-call screen with the avatar at the top. Hanging up is always one tap.
 */
class CallActivity : Activity() {
  private lateinit var settings: Settings
  private var unlisten: (() -> Unit)? = null
  private var full = false
  private lateinit var status: TextView
  private lateinit var heard: TextView
  private var seen = false
  private var micOff = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    settings = Settings(this)
    if (Build.VERSION.SDK_INT >= 27) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    full = intent.getBooleanExtra("full", true)
    build()
  }

  override fun onNewIntent(intent: android.content.Intent) {
    super.onNewIntent(intent)
    val next = intent.getBooleanExtra("full", full)
    if (next != full) {
      full = next
      build()
    }
  }

  /** The voice starts and stops being heard between the engine's notes: the words follow it. */
  private val tick = object : Runnable {
    override fun run() {
      if (!visible) return
      refresh()
      status.postDelayed(this, 250)
    }
  }

  override fun onResume() {
    super.onResume()
    visible = true
    unlisten = VoiceState.listen { refresh() }
    refresh()
    status.post(tick)
  }

  override fun onPause() {
    super.onPause()
    visible = false
    unlisten?.invoke()
    unlisten = null
  }

  private val dark get() = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

  // The app's tokens (src/ui/tokens.ts), dark and light.
  private val bg get() = Color.parseColor(if (dark) "#161615" else "#faf9f7")
  private val surface get() = Color.parseColor(if (dark) "#252524" else "#ffffff")
  private val fg get() = Color.parseColor(if (dark) "#ededeb" else "#161616")
  private val muted get() = Color.parseColor(if (dark) "#a6a59f" else "#5f5e5a")
  private val border get() = Color.parseColor(if (dark) "#3b3b38" else "#e7e5e0")
  private val fill get() = Color.parseColor(if (dark) "#353533" else "#efeeea")
  private val brand get() = Color.parseColor(if (dark) "#2fb57a" else "#1a9460")
  private val danger = Color.parseColor("#d23c3c")

  private fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, resources.displayMetrics)
  private fun dpi(v: Float) = dp(v).toInt()

  private fun avatar(): WaveAvatar = WaveAvatar(this, brand, fill, fg).apply {
    bitmap = WaveAvatar.load(this@CallActivity, settings.avatar)
    eyes = try { JSONArray(settings.eyes) } catch (_: Exception) { JSONArray() }
    eyeColor = try { Color.parseColor(settings.eyeColor) } catch (_: Exception) { Color.BLACK }
    initials = settings.agentName.split(Regex("\\s+")).filter { it.isNotEmpty() }.take(2)
      .joinToString("") { it.take(1).uppercase() }.ifEmpty { "A" }
  }

  private fun text(size: Float, color: Int, bold: Boolean = false) = TextView(this).apply {
    setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
    setTextColor(color)
    if (bold) paint.isFakeBoldText = true
  }

  private fun build() {
    val name = settings.agentName.ifEmpty { "APX" }
    status = text(if (full) 16f else 14f, muted)
    heard = text(if (full) 17f else 15f, fg).apply { maxLines = if (full) 4 else 2 }
    val hangLabel = settings.label("hangUp", "Hang up")
    val root = FrameLayout(this)
    if (full) {
      window.clearFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL)
      root.setBackgroundColor(bg)
      val col = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_HORIZONTAL
        setPadding(dpi(24f), dpi(72f), dpi(24f), 0)
      }
      col.addView(avatar(), LinearLayout.LayoutParams(dpi(260f), dpi(260f)))
      col.addView(text(28f, fg, true).apply { this.text = name; gravity = Gravity.CENTER },
        LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dpi(4f) })
      col.addView(status.apply { gravity = Gravity.CENTER },
        LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dpi(8f) })
      col.addView(heard.apply { gravity = Gravity.CENTER },
        LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dpi(28f) })
      root.addView(col, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
      // Fold back into the floating card, and keep using the phone meanwhile.
      root.addView(round(R.drawable.apx_voice_minimize, fill, fg, 44f, settings.label("minimize", "Minimize")) { fold() },
        FrameLayout.LayoutParams(dpi(44f), dpi(44f), Gravity.TOP or Gravity.START).apply { setMargins(dpi(16f), dpi(40f), 0, 0) })
      val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
      lateinit var mute: FrameLayout
      mute = round(R.drawable.apx_voice_mic, fill, fg, 64f, settings.label("mute", "Mute")) {
        micOff = !micOff
        VoiceService.current?.mute(micOff)
        (mute.getChildAt(0) as ImageView).apply {
          setImageResource(if (micOff) R.drawable.apx_voice_mic_off else R.drawable.apx_voice_mic)
          setColorFilter(if (micOff) bg else fg)
        }
        (mute.background as GradientDrawable).setColor(if (micOff) fg else fill)
      }
      row.addView(mute, LinearLayout.LayoutParams(dpi(64f), dpi(64f)).apply { marginEnd = dpi(40f) })
      row.addView(round(R.drawable.apx_voice_hang_up, danger, Color.WHITE, 76f, hangLabel) { hangUp() },
        LinearLayout.LayoutParams(dpi(76f), dpi(76f)))
      row.addView(View(this), LinearLayout.LayoutParams(dpi(64f), dpi(64f)).apply { marginStart = dpi(40f) })
      root.addView(row, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
        Gravity.BOTTOM).apply { bottomMargin = dpi(72f) })
    } else {
      // What is behind stays usable: only the card takes touches.
      window.addFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL)
      val card = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(dpi(10f), dpi(10f), dpi(14f), dpi(10f))
        background = GradientDrawable().apply {
          cornerRadius = dp(28f)
          setColor(surface)
          setStroke(dpi(1f), border)
        }
        elevation = dp(10f)
        setOnClickListener { expand() }
      }
      card.addView(avatar(), LinearLayout.LayoutParams(dpi(76f), dpi(76f)))
      val words = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dpi(6f), 0, dpi(10f), 0) }
      words.addView(text(16f, fg, true).apply { this.text = name })
      words.addView(status)
      words.addView(heard)
      card.addView(words, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
      card.addView(round(R.drawable.apx_voice_hang_up, danger, Color.WHITE, 52f, hangLabel) { hangUp() },
        LinearLayout.LayoutParams(dpi(52f), dpi(52f)))
      val place = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
        Gravity.BOTTOM).apply { setMargins(dpi(12f), dpi(12f), dpi(12f), dpi(16f)) }
      root.addView(card, place)
      // Above the gesture bar or the navigation buttons, whichever the phone has.
      root.setOnApplyWindowInsetsListener { v, insets ->
        @Suppress("DEPRECATION")
        place.bottomMargin = dpi(16f) + insets.systemWindowInsetBottom
        card.layoutParams = place
        insets
      }
      window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
      window.setGravity(Gravity.BOTTOM)
    }
    setContentView(root)
    if (Build.VERSION.SDK_INT >= 30) {
      // Dark status bar icons over the light call screen.
      val light = android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
      window.insetsController?.setSystemBarsAppearance(if (full && !dark) light else 0, light)
    }
    refresh()
  }

  private fun expand() {
    if (full) return
    full = true
    window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    build()
  }

  private fun fold() {
    full = false
    window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    build()
  }

  private fun hangUp() {
    VoiceService.current?.hangUp()
    finish()
  }

  private fun refresh() {
    val p = VoiceState.phase
    if (VoiceState.live()) seen = true
    // The call is over: the screen goes with it (a failure says why for a moment first).
    if (seen && !VoiceState.live()) {
      val problem = VoiceState.problem
      if (problem != null) {
        status.text = settings.label("failed", "Could not reach your computer")
        heard.text = ""
        status.postDelayed({ finish() }, 2200)
      } else finish()
      return
    }
    status.text = when {
      p == "connecting" -> settings.label("connecting", "Connecting…")
      p == "preparing" -> settings.label("preparing", "Getting the voice ready…")
      VoiceState.audible() -> settings.label("speaking", "Speaking")
      p == "thinking" -> settings.label("thinking", "Thinking…")
      p == "speaking" || p == "listening" -> settings.label("listening", "Listening…")
      else -> ""
    }
    heard.text = VoiceState.heard
    heard.visibility = if (VoiceState.heard.isEmpty()) View.GONE else View.VISIBLE
  }

  /** A round button with one of the app's icons (Lucide, in res/drawable). */
  private fun round(icon: Int, bg: Int, tint: Int, size: Float, label: String, onClick: () -> Unit): FrameLayout =
    FrameLayout(this).apply {
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(bg)
      }
      contentDescription = label
      isClickable = true
      isFocusable = true
      setOnClickListener { onClick() }
      addView(ImageView(this@CallActivity).apply {
        setImageResource(icon)
        setColorFilter(tint)
      }, FrameLayout.LayoutParams(dpi(size * 0.42f), dpi(size * 0.42f), Gravity.CENTER))
    }

  companion object {
    @Volatile var visible = false
  }
}
