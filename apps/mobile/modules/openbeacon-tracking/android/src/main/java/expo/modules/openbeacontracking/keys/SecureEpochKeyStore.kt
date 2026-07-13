package expo.modules.openbeacontracking.keys

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import expo.modules.openbeacontracking.crypto.GroupPayloadEncrypt
import org.json.JSONArray
import org.json.JSONObject

class SecureEpochKeyStore(
  context: Context,
) : EpochKeyStore {
  private val preferences =
    EncryptedSharedPreferences.create(
      PREFS_NAME,
      MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC),
      context.applicationContext,
      EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
      EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

  @Synchronized
  override fun replaceAll(keys: List<ProvisionedEpochKey>) {
    preferences.edit().putString(KEYS_JSON, encodeKeys(keys)).apply()
  }

  @Synchronized
  override fun revoke(groupIds: List<String>?) {
    if (groupIds == null || groupIds.isEmpty()) {
      preferences.edit().remove(KEYS_JSON).apply()
      return
    }

    val remaining = list().filterNot { it.groupId in groupIds.toSet() }
    preferences.edit().putString(KEYS_JSON, encodeKeys(remaining)).apply()
  }

  @Synchronized
  override fun list(): List<ProvisionedEpochKey> {
    val raw = preferences.getString(KEYS_JSON, null) ?: return emptyList()
    return decodeKeys(raw)
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
    private const val PREFS_NAME = "openbeacon_tracking_epoch_keys"
    private const val KEYS_JSON = "keys"
  }
}
