package dev.apx.car

import java.text.Normalizer
import java.util.Locale

/** Lowercase, without accents: notification wording is matched on this. */
internal fun normalizeWords(value: String): String =
  Normalizer.normalize(value.lowercase(Locale.ROOT), Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "")

/**
 * Android Auto's own session notification says the phone is projecting to a car. Android Auto also posts offers
 * ("tap to set up", updates) and, in developer mode, a head-unit-server notice; neither is a car.
 */
object AutoDetector {
  const val PACKAGE = "com.google.android.projection.gearhead"

  private val OFFER = listOf(
    "toca para", "tocar para", "presiona", "configur", "instal", "actualiz", "disponible", "prueba",
    "conecta tu", "conecta el", "tap to", "set up", "setup", "install", "update", "available", "try ", "connect your",
  )
  private val DEVELOPER = listOf("programador", "developer", "servidor de unidad principal", "head unit server")

  /**
   * `persistent` is FLAG_ONGOING_EVENT or FLAG_FOREGROUND_SERVICE: some phones' sessions post only the latter
   * (rules/ERRANDS_ON_THE_WAY.md). Wording this list does not know still counts, so a locale it lacks does not blind the detector.
   */
  fun isSession(packageName: String?, persistent: Boolean, title: CharSequence?, text: CharSequence?): Boolean {
    if (packageName != PACKAGE || !persistent) return false
    val content = normalizeWords("${title ?: ""} ${text ?: ""}")
    if (DEVELOPER.any { content.contains(it) }) return false
    return OFFER.none { content.contains(it) }
  }
}

/** Google Maps' ongoing navigation notification: a route is running. */
object MapsDetector {
  const val PACKAGE = "com.google.android.apps.maps"

  private val GUIDANCE = listOf(
    "naveg", "gira", "continua", "salida", "llegada", "destino",
    "turn", "continue", "exit", "arrival", "destination", " km", " min",
  )
  private val PREFIXES = listOf(
    "en direccion a ", "en camino a ", "hacia ", "estoy yendo a ", "voy a ", "voy hacia ", "me dirijo a ",
    "heading to ", "on the way to ", "toward ", "towards ",
  )

  fun isNavigation(
    packageName: String?,
    category: String?,
    ongoing: Boolean,
    title: CharSequence?,
    text: CharSequence?,
  ): Boolean {
    if (packageName != PACKAGE || !ongoing) return false
    if (category == "navigation") return true
    val content = normalizeWords("${title ?: ""} ${text ?: ""}")
    return GUIDANCE.any { content.contains(it) }
  }

  /**
   * Maps can leave a navigation shell behind after a route is cancelled; a live route has a progress template, a
   * destination, or an "exit navigation" control.
   */
  fun isActiveRoute(template: String?, destination: String, actionLabels: List<String>): Boolean {
    if (template?.endsWith("ProgressStyle") == true) return true
    if (destination.isNotBlank()) return true
    return actionLabels.any { raw ->
      val label = raw.lowercase(Locale.ROOT)
      val navigation = label.contains("naveg") || label.contains("navigation")
      val exit = listOf("salir", "detener", "finalizar", "exit", "stop", "end", "cancel").any { label.contains(it) }
      navigation && exit
    }
  }

  /** "En dirección a Av. Colón 1200" → "Av. Colón 1200"; anything else → "". */
  fun destinationFrom(vararg candidates: CharSequence?): String {
    for (candidate in candidates) {
      val raw = candidate?.toString()?.trim().orEmpty()
      if (raw.isEmpty()) continue
      val normalized = normalizeWords(raw)
      for (prefix in PREFIXES) {
        if (!normalized.startsWith(prefix)) continue
        val skip = prefix.trim().split(Regex("\\s+")).size
        val words = raw.split(Regex("\\s+"))
        if (words.size <= skip) continue
        return words.drop(skip).joinToString(" ").trim().take(120).trim()
      }
    }
    return ""
  }
}
