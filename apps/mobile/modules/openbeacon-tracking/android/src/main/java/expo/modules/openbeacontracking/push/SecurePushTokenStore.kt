package expo.modules.openbeacontracking.push

import android.content.Context
import android.util.Log
import expo.modules.openbeacontracking.keys.KeystoreSealer
import org.json.JSONObject

class SecurePushTokenStore(
  context: Context,
) : PushTokenStore {
  private val preferences = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
  private val sealer = KeystoreSealer(KEY_ALIAS)

  override fun load(): PushTokenState {
    val raw = preferences.getString(STATE_JSON, null) ?: return PushTokenState()
    return try {
      val stored = JSONObject(sealer.open(raw))
      PushTokenState(
        token = stored.optString("token").ifEmpty { null },
        scope = stored.optString("scope").ifEmpty { null },
        sent = stored.optString("sent").ifEmpty { null },
        pushAvailable = if (stored.has("pushAvailable")) stored.getBoolean("pushAvailable") else null,
      )
    } catch (error: Exception) {
      Log.e(TAG, "Failed to read the push token.", error)
      PushTokenState()
    }
  }

  override fun save(state: PushTokenState) {
    if (state == PushTokenState()) {
      check(preferences.edit().remove(STATE_JSON).commit())
      return
    }
    val stored =
      JSONObject()
        .put("token", state.token ?: "")
        .put("scope", state.scope ?: "")
        .put("sent", state.sent ?: "")
    state.pushAvailable?.let { stored.put("pushAvailable", it) }
    check(preferences.edit().putString(STATE_JSON, sealer.seal(stored.toString())).commit())
  }

  companion object {
    private const val TAG = "SecurePushTokenStore"
    private const val KEY_ALIAS = "openbeacon_tracking_push_v1"
    private const val PREFS_NAME = "openbeacon_tracking_push_v1"
    private const val STATE_JSON = "state"
  }
}
