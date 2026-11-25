package expo.modules.openbeacontracking.keys

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import expo.modules.openbeacontracking.crypto.GroupPayloadEncrypt
import org.json.JSONArray
import org.json.JSONObject

class SecureTimedEpochKeyStore(
  private val preferences: SharedPreferences,
  private val sealer: KeystoreSealer = KeystoreSealer(KEY_ALIAS),
) : TimedEpochKeyStore {
  constructor(context: Context) : this(context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE))

  @Synchronized
  override fun read(): List<TimedEpochKey> {
    val raw = preferences.getString(KEYS_JSON, null) ?: return emptyList()
    return try {
      val array = JSONArray(sealer.open(raw))
      (0 until array.length()).map { index ->
        val item = array.getJSONObject(index)
        TimedEpochKey(
          ProvisionedEpochKey(
            groupId = item.getString("groupId"),
            epochId = item.getString("epochId"),
            epochKey = GroupPayloadEncrypt.decodeBase64(item.getString("epochKeyBase64")),
            senderDeviceId = item.getString("senderDeviceId"),
            kind = item.getString("kind"),
          ),
          item.getLong("sinceMillis"),
        )
      }
    } catch (error: Exception) {
      Log.e(TAG, "Failed to read past epoch keys.", error)
      emptyList()
    }
  }

  @Synchronized
  override fun write(keys: List<TimedEpochKey>) {
    if (keys.isEmpty()) {
      check(preferences.edit().remove(KEYS_JSON).commit())
      return
    }
    val array = JSONArray()
    keys.forEach { (key, sinceMillis) ->
      array.put(
        JSONObject()
          .put("groupId", key.groupId)
          .put("epochId", key.epochId)
          .put("epochKeyBase64", GroupPayloadEncrypt.encodeBase64(key.epochKey))
          .put("senderDeviceId", key.senderDeviceId)
          .put("kind", key.kind)
          .put("sinceMillis", sinceMillis),
      )
    }
    check(preferences.edit().putString(KEYS_JSON, sealer.seal(array.toString())).commit())
  }

  companion object {
    private const val TAG = "SecureTimedEpochKeyStore"
    private const val KEY_ALIAS = "openbeacon_tracking_past_epoch_keys_v1"
    private const val PREFS_NAME = "openbeacon_tracking_past_epoch_keys_v1"
    private const val KEYS_JSON = "keys"
  }
}
