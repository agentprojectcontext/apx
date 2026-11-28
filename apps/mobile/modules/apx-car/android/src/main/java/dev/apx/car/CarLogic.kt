package dev.apx.car

import java.util.Locale

/** The answers the core accepts for an offer (CarAction in packages/protocol/src/car.ts). */
object CarActions {
  const val NAVIGATE = "navigate"
  const val ADD_STOP = "add_stop"
  const val NEXT = "next"
  const val LATER = "later"
  const val SKIP = "skip"
  const val SILENCE = "silence"
  const val DONE = "done"

  /** Google Maps driving to a place, the same link the core gives an offer (wording.ts navigateUrl). */
  fun routeTo(place: CarPlace): String =
    "https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lon}&travelmode=driving"

  /** "I'm going": the phone or the car opens the route after recording the answer. */
  fun opensRoute(action: String): Boolean = action == NAVIGATE || action == ADD_STOP

  /** The phone's heads-up shows at most three answers: the main ones first, then whatever else the offer has. */
  fun forPhone(actions: List<String>): List<String> {
    val order = listOf(NAVIGATE, NEXT, SKIP, ADD_STOP, LATER, DONE, SILENCE)
    return order.filter { it in actions }.take(3)
  }

  /** A car alert has room for two. */
  fun forCarAlert(actions: List<String>): List<String> = listOf(NAVIGATE, SKIP, NEXT).filter { it in actions }.take(2)
}

/**
 * A spoken reply to an offer ("dale", "otro", "ya está") → the answer it means, or null when it is anything else
 * (then it goes to the super-agent as a message). Spanish and English.
 */
object VoiceReply {
  // Checked in this order: "no me avises más" is silence before it is "no", "no, otro" is next before skip.
  private val RULES: List<Pair<String, List<String>>> = listOf(
    CarActions.SILENCE to listOf(
      "no me avises mas", "no avises mas", "no me avises", "basta", "silencio", "no mas avisos",
      "stop alerts", "no more alerts", "no more", "be quiet", "enough",
    ),
    CarActions.DONE to listOf(
      "ya esta", "ya lo hice", "ya la hice", "ya lo compre", "listo", "hecho", "lo hice",
      "already done", "done", "i did it", "did it",
    ),
    CarActions.NEXT to listOf("otro", "otra", "siguiente", "another", "next", "other one", "a different one"),
    CarActions.LATER to listOf("despues", "mas tarde", "luego", "later", "after"),
    CarActions.ADD_STOP to listOf(
      "sumala", "sumalo", "agregala", "agregalo", "parada", "add a stop", "add stop", "add it", "as a stop",
    ),
    CarActions.SKIP to listOf("ahora no", "no gracias", "no", "nop", "not now", "no thanks", "skip"),
    CarActions.NAVIGATE to listOf(
      "voy", "dale", "si", "llevame", "vamos", "navega", "yes", "yeah", "go", "take me", "lets go", "navigate",
    ),
  )

  /** Longer than this, it is a message for the agent, not an answer ("voy a comprar pan después de las seis"). */
  private const val MAX_WORDS = 6

  fun actionFor(reply: String): String? {
    val words = normalizeWords(reply).replace(Regex("[^a-z0-9 ]"), " ").trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    if (words.isEmpty() || words.size > MAX_WORDS) return null
    for ((action, phrases) in RULES) {
      if (phrases.any { containsPhrase(words, it.split(" ")) }) return action
    }
    return null
  }

  private fun containsPhrase(words: List<String>, phrase: List<String>): Boolean {
    if (phrase.size > words.size) return false
    for (start in 0..words.size - phrase.size) {
      if (phrase.indices.all { words[start + it] == phrase[it] }) return true
    }
    return false
  }
}

/** Words the car reads aloud and the rows it shows. */
object CarText {
  /** "850 m", "1.4 km". */
  fun distanceLabel(metres: Int?): String? {
    if (metres == null || metres < 0) return null
    return if (metres >= 1000) String.format(Locale.US, "%.1f km", metres / 1000.0) else "$metres m"
  }

  /** "1.4 km · Farmacia del Puente · Av. San Martín 1234", skipping what is unknown. */
  fun detail(vararg parts: String?): String = parts.filter { !it.isNullOrBlank() }.joinToString(" · ")

  private val EMOJI = Regex(
    "[\\x{1F000}-\\x{1FAFF}\\x{2600}-\\x{27BF}\\x{2B00}-\\x{2BFF}\\x{FE0F}\\x{200D}\\x{20E3}\\x{E0020}-\\x{E007F}]",
  )

  /**
   * An agent's reply as plain words for a voice: no markdown, no emoji, no links' addresses, at most `max` chars
   * (cut at a sentence or word end).
   */
  fun forSpeech(text: String, max: Int = 600): String {
    var out = text
      .replace(Regex("```[\\s\\S]*?```"), " ")
      .replace(Regex("`([^`]*)`"), "$1")
      .replace(Regex("!\\[([^\\]]*)]\\([^)]*\\)"), "$1")
      .replace(Regex("\\[([^\\]]+)]\\([^)]*\\)"), "$1")
      .replace(Regex("https?://\\S+"), "")
      .replace(Regex("(?m)^\\s{0,3}#{1,6}\\s*"), "")
      .replace(Regex("(?m)^\\s*>\\s?"), "")
      .replace(Regex("(?m)^\\s*[-*+]\\s+"), "")
      .replace(Regex("\\*\\*|__|\\*|~~"), "")
      .replace(Regex("(?<![\\p{L}\\p{N}])_([^_]+)_(?![\\p{L}\\p{N}])"), "$1")
      .replace(EMOJI, "")
      .replace(Regex("[ \\t]+"), " ")
      .replace(Regex("\\s*\\n\\s*"), "\n")
      .trim()
    if (out.length > max) {
      val cut = out.take(max)
      val sentence = cut.lastIndexOfAny(charArrayOf('.', '!', '?', '\n'))
      out = if (sentence > max / 2) cut.take(sentence + 1) else cut.substringBeforeLast(' ') + "…"
    }
    return out.trim()
  }
}

/**
 * The reasons this phone thinks the owner is driving. Each comes and goes on its own (a route can end while the car
 * stays connected), so a trip ends only when every one is down.
 */
data class TripSources(
  val auto: Boolean = false,
  val carLink: Boolean = false,
  val maps: Boolean = false,
  val test: Boolean = false,
) {
  val any: Boolean get() = auto || carLink || maps || test
  val car: Boolean get() = auto || carLink

  /** CarTripSource for a new trip. */
  val source: String get() = when {
    car -> "android_auto"
    maps -> "maps"
    else -> "manual"
  }

  sealed interface Change {
    data class Start(val source: String) : Change
    data object End : Change
    data object Keep : Change
  }

  fun decide(tripActive: Boolean): Change = when {
    !tripActive && any -> Change.Start(source)
    tripActive && !any -> Change.End
    else -> Change.Keep
  }
}
