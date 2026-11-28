package dev.apx.voice

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Listens for something short said near the phone and hands each bit over as a 16 kHz WAV: only loudness is measured
 * here, the words are heard by the core. The noise floor follows the room, so a quiet bedroom and a kitchen both work.
 */
class WakeListener(private val onClip: (ByteArray, Int) -> Unit) {
  @Volatile private var running = false
  private var thread: Thread? = null

  fun running() = running

  fun start() {
    if (running) return
    running = true
    thread = Thread({ loop() }, "apx-wake").also { it.start() }
  }

  fun stop() {
    running = false
    thread?.interrupt()
    thread?.join(600)
    thread = null
  }

  @SuppressLint("MissingPermission")
  private fun loop() {
    val minBuf = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    var rec: AudioRecord? = null
    try {
      // A recorder just released can hold the microphone a moment longer.
      for (attempt in 0 until 10) {
        if (!running) return
        rec = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, RATE, AudioFormat.CHANNEL_IN_MONO,
          AudioFormat.ENCODING_PCM_16BIT, max(minBuf * 2, RATE))
        if (rec.state == AudioRecord.STATE_INITIALIZED) {
          try { rec.startRecording() } catch (_: IllegalStateException) {}
          if (rec.recordingState == AudioRecord.RECORDSTATE_RECORDING) break
        }
        rec.release()
        rec = null
        Thread.sleep(150)
      }
      val r = rec ?: return
      val chunk = RATE / 50 // 20 ms
      val buf = ShortArray(chunk)
      val speech = ByteArrayOutputStream()
      val lead = ByteArrayOutputStream()
      var floor = -1.0
      var inSpeech = false
      var speechMs = 0
      var silenceMs = 0
      while (running) {
        val n = r.read(buf, 0, chunk)
        if (n <= 0) {
          if (n < 0) break
          continue
        }
        var sum = 0.0
        for (i in 0 until n) sum += buf[i].toDouble() * buf[i]
        val rms = sqrt(sum / n)
        floor = when {
          floor < 0 -> rms
          rms < floor -> floor * 0.70 + rms * 0.30
          !inSpeech -> floor * 0.995 + rms * 0.005
          else -> floor
        }
        // Starting to speak costs more than going on: soft syllables mid-word stay in.
        val enter = min(max(max(floor * 4.0, floor + MARGIN * 1.6), MIN_THRESHOLD), MAX_THRESHOLD)
        val keep = max(max(floor * 2.6, floor + MARGIN), MIN_THRESHOLD)
        val loud = rms > (if (inSpeech) keep else enter)
        val pcm = bytes(buf, n)
        val ms = n * 1000 / RATE
        if (!inSpeech) {
          lead.write(pcm, 0, pcm.size)
          val maxLead = LEAD_MS * RATE / 1000 * 2
          if (lead.size() > maxLead) {
            val all = lead.toByteArray()
            lead.reset()
            lead.write(all, all.size - maxLead, maxLead)
          }
          if (loud) {
            inSpeech = true
            speechMs = 0
            silenceMs = 0
            val l = lead.toByteArray()
            speech.write(l, 0, l.size)
            lead.reset()
          }
        } else {
          speech.write(pcm, 0, pcm.size)
          speechMs += ms
          silenceMs = if (loud) 0 else silenceMs + ms
          if (speechMs >= MAX_MS || (speechMs >= MIN_MS && silenceMs >= SILENCE_MS)) {
            val clip = speech.toByteArray()
            speech.reset()
            inSpeech = false
            if (speechMs in 500..2600) {
              try { onClip(wav(clip), speechMs) } catch (e: Exception) { Log.w(TAG, "clip: $e") }
            }
            speechMs = 0
            silenceMs = 0
          }
        }
      }
    } catch (_: InterruptedException) {
    } catch (e: Exception) {
      Log.w(TAG, "listening stopped: $e")
    } finally {
      running = false
      rec?.let {
        try { it.stop() } catch (_: Exception) {}
        it.release()
      }
    }
  }

  companion object {
    const val TAG = "apx-voice"
    const val RATE = 16000
    private const val MIN_THRESHOLD = 80.0
    private const val MAX_THRESHOLD = 5000.0
    private const val MARGIN = 55.0
    private const val LEAD_MS = 300
    private const val MIN_MS = 350
    private const val SILENCE_MS = 450
    private const val MAX_MS = 1800

    fun bytes(src: ShortArray, n: Int): ByteArray {
      val out = ByteArray(n * 2)
      for (i in 0 until n) {
        out[i * 2] = (src[i].toInt() and 0xff).toByte()
        out[i * 2 + 1] = ((src[i].toInt() shr 8) and 0xff).toByte()
      }
      return out
    }

    /** Raw PCM16 mono at 16 kHz in a WAV, raised to a level whisper hears well. */
    fun wav(raw: ByteArray): ByteArray {
      val pcm = normalize(raw.copyOf())
      val out = ByteArray(44 + pcm.size)
      fun ascii(off: Int, s: String) { for (i in s.indices) out[off + i] = s[i].code.toByte() }
      fun int(off: Int, v: Int) { for (i in 0..3) out[off + i] = ((v shr (8 * i)) and 0xff).toByte() }
      fun short(off: Int, v: Int) { out[off] = (v and 0xff).toByte(); out[off + 1] = ((v shr 8) and 0xff).toByte() }
      ascii(0, "RIFF"); int(4, 36 + pcm.size); ascii(8, "WAVE"); ascii(12, "fmt ")
      int(16, 16); short(20, 1); short(22, 1); int(24, RATE); int(28, RATE * 2); short(32, 2); short(34, 16)
      ascii(36, "data"); int(40, pcm.size)
      System.arraycopy(pcm, 0, out, 44, pcm.size)
      return out
    }

    private fun normalize(pcm: ByteArray): ByteArray {
      var sum = 0L
      var n = 0
      var peak = 0
      var i = 0
      while (i + 1 < pcm.size) {
        val v = ((pcm[i].toInt() and 0xff) or (pcm[i + 1].toInt() shl 8)).toShort().toInt()
        sum += v.toLong() * v
        peak = max(peak, kotlin.math.abs(v))
        n++
        i += 2
      }
      if (n == 0) return pcm
      val rms = sqrt(sum.toDouble() / n)
      if (rms < 60) return pcm
      var gain = 2200.0 / rms
      if (gain <= 1.2) return pcm
      gain = min(gain, 8.0)
      if (peak * gain > 32000) gain = 32000.0 / peak
      i = 0
      while (i + 1 < pcm.size) {
        val v = ((pcm[i].toInt() and 0xff) or (pcm[i + 1].toInt() shl 8)).toShort().toInt()
        val o = (v * gain).toInt().coerceIn(-32768, 32767)
        pcm[i] = (o and 0xff).toByte()
        pcm[i + 1] = ((o shr 8) and 0xff).toByte()
        i += 2
      }
      return pcm
    }
  }
}
