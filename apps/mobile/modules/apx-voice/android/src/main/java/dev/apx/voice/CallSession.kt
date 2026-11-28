package dev.apx.voice

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.os.Build
import android.util.Log
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import java.util.concurrent.LinkedBlockingQueue
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * One call through the owner's core: the microphone up as 16 kHz PCM16, the voice down as 24 kHz PCM16, both through
 * the phone's call path so its echo canceller keeps the voice out of the microphone. The core runs everything else.
 */
class CallSession(
  private val context: Context,
  private val core: Core,
  private val mode: String,
  private val agentId: String?,
  private val thread: String?,
  /** The greeting recorded ahead (24 kHz PCM16): it plays at once, and the call listens while the voice loads. */
  private val greeting: ByteArray?,
  private val onEnd: (reason: String) -> Unit,
) {
  @Volatile private var ended = false
  @Volatile private var muted = false
  private var ws: WebSocket? = null
  private var recorder: Thread? = null
  private var player: Thread? = null
  private val down = LinkedBlockingQueue<ByteArray>()
  private var track: AudioTrack? = null
  private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private var focus: AudioFocusRequest? = null
  @Volatile private var audioStarted = false
  @Volatile private var opened = false
  /** The microphone before the call's line opens: sent as soon as it does. */
  private val early = ArrayList<ByteArray>()
  private var earlyBytes = 0
  /** Until then the greeting plays: what the microphone hears meanwhile is the greeting itself. */
  @Volatile private var greetingUntil = 0L

  fun start() {
    VoiceState.set(phase = "connecting", heard = "", mode = mode, clearProblem = true)
    if (greeting != null) {
      startAudio()
      greetingUntil = android.os.SystemClock.uptimeMillis() + greeting.size * 1000L / 2 / DOWN_RATE + 400
      var at = 0
      while (at < greeting.size) {
        val n = minOf(DOWN_RATE / 5 * 2, greeting.size - at) // 200 ms pieces, like the voice's own
        down.offer(greeting.copyOfRange(at, at + n))
        at += n
      }
    }
    Thread({
      try {
        val p = JSONObject().put("mode", mode)
        if (greeting != null) p.put("greeted", true)
        if (agentId != null) p.put("agent_id", agentId)
        if (thread != null) p.put("thread", thread)
        val r = core.call("calls.start", p, effect = true)
        if (ended) return@Thread
        VoiceState.set(thread = r.optString("thread_id"))
        open(r.getString("ticket"))
      } catch (e: Exception) {
        Log.w(TAG, "call did not start: $e")
        finish("failed", e.message ?: "")
      }
    }, "apx-call-start").start()
  }

  fun setMuted(on: Boolean) { muted = on }

  fun hangUp() {
    try { ws?.send("{\"type\":\"hangup\"}") } catch (_: Exception) {}
    ws?.close(1000, "hangup")
    finish("hangup")
  }

  private fun open(ticket: String) {
    val req = Request.Builder().url(core.socket("/voice-call?ticket=${java.net.URLEncoder.encode(ticket, "UTF-8")}")).build()
    ws = Core.http.newWebSocket(req, object : WebSocketListener() {
      override fun onOpen(webSocket: WebSocket, response: Response) {
        synchronized(early) {
          for (b in early) webSocket.send(b.toByteString())
          early.clear()
          earlyBytes = 0
          opened = true
        }
        startAudio()
      }

      override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
        down.offer(bytes.toByteArray())
      }

      override fun onMessage(webSocket: WebSocket, text: String) {
        val f = try { JSONObject(text) } catch (_: Exception) { return }
        when (f.optString("type")) {
          "preparing" -> VoiceState.set(phase = "preparing")
          "ready" -> VoiceState.set(phase = "listening")
          // What the owner said stays on screen while the voice thinks and answers; an empty one is not words.
          "partial" -> f.optString("text").takeIf { it.isNotBlank() }?.let { VoiceState.set(heard = it) }
          "interrupted" -> flush()
          "state" -> VoiceState.set(phase = f.optString("state").ifEmpty { "listening" })
          "end" -> {
            // The voice's last words still in the queue play out before the line closes.
            val reason = f.optString("reason")
            Thread({ drain(); finish(reason) }, "apx-call-end").start()
          }
        }
      }

      override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        Thread({ drain(); finish("closed") }, "apx-call-end").start()
      }

      override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        Log.w(TAG, "call socket: $t ${response?.code}")
        finish("network", t.message ?: "")
      }
    })
  }

  /** The microphone's 100 ms up the line, kept while the line is not open yet. */
  private fun up(b: ByteArray) {
    if (android.os.SystemClock.uptimeMillis() < greetingUntil) return
    synchronized(early) {
      if (opened) ws?.send(b.toByteString())
      else if (earlyBytes < EARLY_MAX) {
        early.add(b)
        earlyBytes += b.size
      }
    }
  }

  @SuppressLint("MissingPermission")
  @Synchronized
  private fun startAudio() {
    if (audioStarted || ended) return
    audioStarted = true
    audio.mode = AudioManager.MODE_IN_COMMUNICATION
    speaker(true)
    val attrs = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
      .build()
    focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).setAudioAttributes(attrs).build()
      .also { audio.requestAudioFocus(it) }

    val outMin = AudioTrack.getMinBufferSize(DOWN_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
    val t = AudioTrack.Builder()
      .setAudioAttributes(attrs)
      .setAudioFormat(
        AudioFormat.Builder().setSampleRate(DOWN_RATE).setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
          .setEncoding(AudioFormat.ENCODING_PCM_16BIT).build(),
      )
      .setBufferSizeInBytes(max(outMin * 2, DOWN_RATE / 5 * 2))
      .setTransferMode(AudioTrack.MODE_STREAM)
      .build()
    track = t
    t.play()
    player = Thread({
      try {
        while (!ended) {
          val b = down.poll(200, java.util.concurrent.TimeUnit.MILLISECONDS)
          if (b == null) {
            VoiceState.level = VoiceState.level * 0.6f
            continue
          }
          VoiceState.level = max(VoiceState.level * 0.5f, level(b))
          t.write(b, 0, b.size)
          VoiceState.lastAudio = android.os.SystemClock.uptimeMillis()
        }
      } catch (_: InterruptedException) {
      } catch (e: Exception) {
        Log.w(TAG, "player: $e")
      }
    }, "apx-call-down").also { it.start() }

    recorder = Thread({
      val inMin = AudioRecord.getMinBufferSize(UP_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
      var rec: AudioRecord? = null
      try {
        for (attempt in 0 until 10) {
          rec = AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, UP_RATE, AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT, max(inMin * 2, UP_RATE / 5 * 2))
          if (rec.state == AudioRecord.STATE_INITIALIZED) {
            try { rec.startRecording() } catch (_: IllegalStateException) {}
            if (rec.recordingState == AudioRecord.RECORDSTATE_RECORDING) break
          }
          rec.release()
          rec = null
          Thread.sleep(120)
        }
        val r = rec ?: return@Thread finish("microphone")
        if (AcousticEchoCanceler.isAvailable()) AcousticEchoCanceler.create(r.audioSessionId)?.enabled = true
        if (NoiseSuppressor.isAvailable()) NoiseSuppressor.create(r.audioSessionId)?.enabled = true
        val buf = ShortArray(UP_RATE / 10) // 100 ms
        while (!ended) {
          val n = r.read(buf, 0, buf.size)
          if (n < 0) break
          if (n == 0 || muted) continue
          up(WakeListener.bytes(buf, n))
        }
      } catch (_: InterruptedException) {
      } catch (e: Exception) {
        Log.w(TAG, "recorder: $e")
      } finally {
        rec?.let {
          try { it.stop() } catch (_: Exception) {}
          it.release()
        }
      }
    }, "apx-call-up").also { it.start() }
  }

  private fun flush() {
    down.clear()
    track?.let {
      try { it.pause(); it.flush(); it.play() } catch (_: Exception) {}
    }
    VoiceState.level = 0f
  }

  /** Waits for what is queued and buffered to play (at most a few seconds). */
  private fun drain() {
    val until = System.currentTimeMillis() + 6000
    while (down.isNotEmpty() && System.currentTimeMillis() < until && !ended) Thread.sleep(50)
    if (!ended) Thread.sleep(350)
  }

  private fun speaker(on: Boolean) {
    try {
      if (Build.VERSION.SDK_INT >= 31) {
        if (on) {
          audio.availableCommunicationDevices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
            ?.let { audio.setCommunicationDevice(it) }
        } else audio.clearCommunicationDevice()
      } else {
        @Suppress("DEPRECATION")
        audio.isSpeakerphoneOn = on
      }
    } catch (e: Exception) {
      Log.w(TAG, "speaker: $e")
    }
  }

  @Synchronized
  private fun finish(reason: String, detail: String = "") {
    if (ended) return
    ended = true
    Log.i(TAG, "call ended: $reason $detail")
    try { ws?.close(1000, reason) } catch (_: Exception) {}
    recorder?.interrupt()
    player?.interrupt()
    try { track?.stop() } catch (_: Exception) {}
    track?.release()
    track = null
    down.clear()
    speaker(false)
    focus?.let { audio.abandonAudioFocusRequest(it) }
    audio.mode = AudioManager.MODE_NORMAL
    VoiceState.level = 0f
    val failed = reason in setOf("failed", "network", "microphone", "engine", "speech", "transcription")
    VoiceState.set(heard = "", problem = if (failed) detail.ifEmpty { reason } else null, clearProblem = !failed)
    onEnd(reason)
  }

  companion object {
    const val TAG = "apx-voice"
    const val UP_RATE = 16000
    const val DOWN_RATE = 24000
    /** What a greeted call keeps before its line opens: 20 s of 16 kHz PCM16. */
    const val EARLY_MAX = 20 * UP_RATE * 2

    fun level(b: ByteArray): Float {
      var sum = 0.0
      var n = 0
      var i = 0
      while (i + 1 < b.size) {
        val v = ((b[i].toInt() and 0xff) or (b[i + 1].toInt() shl 8)).toShort().toDouble()
        sum += v * v
        n++
        i += 2
      }
      if (n == 0) return 0f
      return min(1f, (sqrt(sum / n) / 6000.0).toFloat())
    }
  }
}
