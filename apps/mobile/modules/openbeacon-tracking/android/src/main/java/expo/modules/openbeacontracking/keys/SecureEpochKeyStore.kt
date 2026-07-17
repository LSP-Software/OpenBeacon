package expo.modules.openbeacontracking.keys

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import expo.modules.openbeacontracking.crypto.GroupPayloadEncrypt
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONArray
import org.json.JSONObject

class SecureEpochKeyStore(
  context: Context,
) : EpochKeyStore {
  private val preferences =
    context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  @Synchronized
  override fun replaceAll(keys: List<ProvisionedEpochKey>) {
    preferences.edit().putString(KEYS_JSON, encrypt(encodeKeys(keys))).apply()
  }

  @Synchronized
  override fun revoke(groupIds: List<String>?) {
    if (groupIds == null || groupIds.isEmpty()) {
      preferences.edit().remove(KEYS_JSON).apply()
      return
    }

    val remaining = list().filterNot { it.groupId in groupIds.toSet() }
    preferences.edit().putString(KEYS_JSON, encrypt(encodeKeys(remaining))).apply()
  }

  @Synchronized
  override fun list(): List<ProvisionedEpochKey> {
    val raw = preferences.getString(KEYS_JSON, null) ?: return emptyList()
    return try {
      decodeKeys(decrypt(raw))
    } catch (error: Exception) {
      Log.e(TAG, "Failed to read provisioned epoch keys.", error)
      emptyList()
    }
  }

  private fun encrypt(plaintext: String): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, getOrCreateEncryptionKey())
    return JSONObject()
      .put("version", 1)
      .put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      .put(
        "ciphertext",
        Base64.encodeToString(cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP),
      ).toString()
  }

  private fun decrypt(raw: String): String {
    val payload = JSONObject(raw)
    require(payload.getInt("version") == 1) { "Unsupported epoch key storage version." }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(
      Cipher.DECRYPT_MODE,
      getOrCreateEncryptionKey(),
      GCMParameterSpec(128, Base64.decode(payload.getString("iv"), Base64.NO_WRAP)),
    )
    return String(
      cipher.doFinal(Base64.decode(payload.getString("ciphertext"), Base64.NO_WRAP)),
      Charsets.UTF_8,
    )
  }

  private fun getOrCreateEncryptionKey(): SecretKey {
    val keyStore =
      KeyStore.getInstance(ANDROID_KEY_STORE).apply {
        load(null)
      }
    val existingKey = keyStore.getKey(KEY_ALIAS, null)
    if (existingKey is SecretKey) {
      return existingKey
    }

    return KeyGenerator
      .getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEY_STORE)
      .apply {
        init(
          KeyGenParameterSpec
            .Builder(
              KEY_ALIAS,
              KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build(),
        )
      }.generateKey()
  }

  private fun encodeKeys(keys: List<ProvisionedEpochKey>): String {
    val array = JSONArray()
    for (key in keys) {
      array.put(
        JSONObject()
          .put("groupId", key.groupId)
          .put("epochId", key.epochId)
          .put("epochKeyBase64", GroupPayloadEncrypt.encodeBase64(key.epochKey))
          .put("senderDeviceId", key.senderDeviceId)
          .put("kind", key.kind),
      )
    }
    return array.toString()
  }

  private fun decodeKeys(raw: String): List<ProvisionedEpochKey> {
    val array = JSONArray(raw)
    val keys = ArrayList<ProvisionedEpochKey>(array.length())
    for (index in 0 until array.length()) {
      val item = array.getJSONObject(index)
      keys.add(
        ProvisionedEpochKey(
          groupId = item.getString("groupId"),
          epochId = item.getString("epochId"),
          epochKey = GroupPayloadEncrypt.decodeBase64(item.getString("epochKeyBase64")),
          senderDeviceId = item.getString("senderDeviceId"),
          kind = item.getString("kind"),
        ),
      )
    }
    return keys
  }

  companion object {
    private const val TAG = "SecureEpochKeyStore"
    private const val ANDROID_KEY_STORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "openbeacon_tracking_epoch_keys_v1"
    private const val PREFS_NAME = "openbeacon_tracking_epoch_keys_v2"
    private const val KEYS_JSON = "keys"
  }
}
