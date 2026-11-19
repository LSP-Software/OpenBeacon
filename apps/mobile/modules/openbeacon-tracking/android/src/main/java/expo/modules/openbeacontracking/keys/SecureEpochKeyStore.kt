package expo.modules.openbeacontracking.keys

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import expo.modules.openbeacontracking.crypto.GroupPayloadEncrypt
import org.json.JSONArray
import org.json.JSONObject

class SecureEpochKeyStore(
  private val preferences: SharedPreferences,
  private val sealer: KeystoreSealer = KeystoreSealer(KEY_ALIAS),
) : EpochKeyStore {
  constructor(context: Context) : this(context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE))

  override var revocations = 0L
    @Synchronized get
    private set

  @Synchronized
  override fun replaceAll(keys: List<ProvisionedEpochKey>) {
    check(preferences.edit().putString(KEYS_JSON, sealer.seal(encodeKeys(keys))).commit())
  }

  @Synchronized
  override fun revoke(groupIds: List<String>?) {
    revocations += 1
    if (groupIds == null || groupIds.isEmpty()) {
      check(preferences.edit().remove(KEYS_JSON).commit())
      return
    }

    val remaining = list().filterNot { it.groupId in groupIds.toSet() }
    check(preferences.edit().putString(KEYS_JSON, sealer.seal(encodeKeys(remaining))).commit())
  }

  @Synchronized
  override fun list(): List<ProvisionedEpochKey> {
    val raw = preferences.getString(KEYS_JSON, null) ?: return emptyList()
    return try {
      decodeKeys(sealer.open(raw))
    } catch (error: Exception) {
      Log.e(TAG, "Failed to read provisioned epoch keys.", error)
      emptyList()
    }
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
    private const val KEY_ALIAS = "openbeacon_tracking_epoch_keys_v1"
    private const val PREFS_NAME = "openbeacon_tracking_epoch_keys_v2"
    private const val KEYS_JSON = "keys"
  }
}
