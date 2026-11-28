package dev.apx.voice

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * What the voice needs with the app closed: the core's address and this phone's key (encrypted with a Keystore key),
 * whether it listens for its name, the agent's name and look, and the words it shows (the app's language).
 */
class Settings(context: Context) {
  private val prefs = context.getSharedPreferences("apx.voice", Context.MODE_PRIVATE)

  var url: String
    get() = prefs.getString("url", "") ?: ""
    set(v) = prefs.edit().putString("url", v).apply()
  var token: String
    get() = prefs.getString("token", null)?.let { decrypt(it) } ?: ""
    set(v) = prefs.edit().putString("token", encrypt(v)).apply()
  var wake: Boolean
    get() = prefs.getBoolean("wake", false)
    set(v) = prefs.edit().putBoolean("wake", v).apply()
  var agentName: String
    get() = prefs.getString("agent", "") ?: ""
    set(v) = prefs.edit().putString("agent", v).apply()
  var avatar: String
    get() = prefs.getString("avatar", "") ?: ""
    set(v) = prefs.edit().putString("avatar", v).apply()
  /** The avatar's eyes in its 256-unit box, as JSON [{x,y,w,h,rx}], and their color. */
  var eyes: String
    get() = prefs.getString("eyes", "[]") ?: "[]"
    set(v) = prefs.edit().putString("eyes", v).apply()
  var eyeColor: String
    get() = prefs.getString("eyeColor", "#15181C") ?: "#15181C"
    set(v) = prefs.edit().putString("eyeColor", v).apply()
  var labels: JSONObject
    get() = try { JSONObject(prefs.getString("labels", "{}") ?: "{}") } catch (_: Exception) { JSONObject() }
    set(v) = prefs.edit().putString("labels", v.toString()).apply()

  fun label(key: String, fallback: String): String = labels.optString(key, "").ifEmpty { fallback }

  fun paired(): Boolean = url.isNotEmpty() && token.isNotEmpty()

  fun clear() = prefs.edit().clear().apply()

  private fun key(): SecretKey {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    gen.init(
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .build(),
    )
    return gen.generateKey()
  }

  private fun encrypt(plain: String): String {
    val c = Cipher.getInstance("AES/GCM/NoPadding")
    c.init(Cipher.ENCRYPT_MODE, key())
    val out = c.doFinal(plain.toByteArray())
    return Base64.encodeToString(c.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(out, Base64.NO_WRAP)
  }

  private fun decrypt(stored: String): String? = try {
    val (iv, data) = stored.split(":", limit = 2)
    val c = Cipher.getInstance("AES/GCM/NoPadding")
    c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
    String(c.doFinal(Base64.decode(data, Base64.NO_WRAP)))
  } catch (_: Exception) {
    null
  }

  companion object {
    private const val ALIAS = "apx.voice.key"
  }
}
