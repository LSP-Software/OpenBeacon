package expo.modules.openbeacontracking.keys

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

class KeystoreSealer(
  private val keyAlias: String,
) {
  fun seal(plaintext: String): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
    return JSONObject()
      .put("version", 1)
      .put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      .put(
        "ciphertext",
        Base64.encodeToString(cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP),
      ).toString()
  }

  fun open(raw: String): String {
    val payload = JSONObject(raw)
    require(payload.getInt("version") == 1) { "Unsupported sealed storage version." }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(
      Cipher.DECRYPT_MODE,
      getOrCreateKey(),
      GCMParameterSpec(128, Base64.decode(payload.getString("iv"), Base64.NO_WRAP)),
    )
    return String(
      cipher.doFinal(Base64.decode(payload.getString("ciphertext"), Base64.NO_WRAP)),
      Charsets.UTF_8,
    )
  }

  private fun getOrCreateKey(): SecretKey {
    val keyStore =
      KeyStore.getInstance(ANDROID_KEY_STORE).apply {
        load(null)
      }
    val existingKey = keyStore.getKey(keyAlias, null)
    if (existingKey is SecretKey) {
      return existingKey
    }

    return KeyGenerator
      .getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEY_STORE)
      .apply {
        init(
          KeyGenParameterSpec
            .Builder(
              keyAlias,
              KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build(),
        )
      }.generateKey()
  }

  companion object {
    private const val ANDROID_KEY_STORE = "AndroidKeyStore"
  }
}
