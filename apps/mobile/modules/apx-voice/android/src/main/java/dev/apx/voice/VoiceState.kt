package dev.apx.voice

import android.os.Handler
import android.os.Looper
import java.util.concurrent.CopyOnWriteArrayList

/** What the voice is doing now, shared by the service, the call screen and the app. Changed on the main thread. */
object VoiceState {
  /** off | wake (listening for its name) | connecting | preparing | listening | thinking | speaking */
  @Volatile var phase: String = "off"
    private set
  /** What the owner is saying right now. */
  @Volatile var heard: String = ""
    private set
  @Volatile var thread: String? = null
    private set
  /** The voice's loudness as it plays, 0..1, for the waves around the avatar. */
  @Volatile var level: Float = 0f
  /** When the voice's audio last reached the speaker (uptime ms): what the screen says follows what is heard. */
  @Volatile var lastAudio: Long = 0L

  /** The voice is audible now, whatever the engine last said about its turn. */
  fun audible(): Boolean = android.os.SystemClock.uptimeMillis() - lastAudio < 450
  /** Why the last call ended, when it failed. */
  @Volatile var problem: String? = null
    private set
  @Volatile var mode: String = "call"
    private set

  private val main = Handler(Looper.getMainLooper())
  private val listeners = CopyOnWriteArrayList<() -> Unit>()

  fun live(): Boolean = phase != "off" && phase != "wake"

  fun listen(l: () -> Unit): () -> Unit {
    listeners.add(l)
    return { listeners.remove(l) }
  }

  fun set(
    phase: String? = null,
    heard: String? = null,
    thread: String? = null,
    problem: String? = null,
    mode: String? = null,
    clearProblem: Boolean = false,
  ) {
    main.post {
      if (phase != null) this.phase = phase
      if (heard != null) this.heard = heard
      if (thread != null) this.thread = thread.ifEmpty { null }
      if (mode != null) this.mode = mode
      if (problem != null) this.problem = problem
      if (clearProblem) this.problem = null
      for (l in listeners) l()
    }
  }
}
