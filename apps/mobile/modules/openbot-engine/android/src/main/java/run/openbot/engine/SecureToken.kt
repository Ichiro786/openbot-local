package run.openbot.engine

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Encrypts the GitHub token with an AES-256-GCM key that lives in the Android Keystore and never
 * leaves it (the same scheme expo-secure-store uses on Android). Only the ciphertext and its IV
 * reach SharedPreferences, as `<iv b64>:<ciphertext b64>`. The key cannot be backed up or moved, so
 * a restored backup simply has no token.
 */
internal object SecureToken {
  private const val KEYSTORE = "AndroidKeyStore"
  private const val ALIAS = "openbot_engine_github_token"
  private const val TRANSFORM = "AES/GCM/NoPadding"
  private const val TAG_BITS = 128

  private fun key(): SecretKey {
    val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
    val existing = store.getKey(ALIAS, null) as? SecretKey
    if (existing != null) return existing
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
    generator.init(
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build(),
    )
    return generator.generateKey()
  }

  /** Throws when the Keystore is unusable; callers must then refuse to store the token at all. */
  fun encrypt(plain: String): String {
    val cipher = Cipher.getInstance(TRANSFORM)
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val data = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
    return Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(data, Base64.NO_WRAP)
  }

  /** Null when the value is malformed or the key is gone (app data restored on another device). */
  fun decrypt(stored: String): String? {
    val parts = stored.split(':', limit = 2)
    if (parts.size != 2) return null
    return try {
      val iv = Base64.decode(parts[0], Base64.NO_WRAP)
      val data = Base64.decode(parts[1], Base64.NO_WRAP)
      val cipher = Cipher.getInstance(TRANSFORM)
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, iv))
      String(cipher.doFinal(data), Charsets.UTF_8).ifBlank { null }
    } catch (_: Exception) {
      null
    }
  }
}
