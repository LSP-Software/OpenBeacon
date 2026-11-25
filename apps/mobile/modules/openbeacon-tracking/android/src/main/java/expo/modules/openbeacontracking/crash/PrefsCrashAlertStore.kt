package expo.modules.openbeacontracking.crash

import android.content.Context
import android.util.Log
import expo.modules.openbeacontracking.crypto.CrashAlertType
import expo.modules.openbeacontracking.drives.CrashAlertStore
import expo.modules.openbeacontracking.drives.QueuedCrashAlert
import org.json.JSONArray
import org.json.JSONObject

class PrefsCrashAlertStore(
  private val context: Context,
) : CrashAlertStore {
  private fun prefs() = context.getSharedPreferences("openbeacon_crash_alerts", Context.MODE_PRIVATE)

  override fun load(): List<QueuedCrashAlert> {
    val saved = prefs().getString("outbox", null) ?: return emptyList()
    return try {
      val array = JSONArray(saved)
      (0 until array.length()).map { index ->
        val item = array.getJSONObject(index)
        QueuedCrashAlert(
          messageId = item.getString("messageId"),
          alertId = item.getString("alertId"),
          type = CrashAlertType.valueOf(item.getString("type")),
          groupId = item.getString("groupId"),
          epochId = item.getString("epochId"),
          senderDeviceId = item.getString("senderDeviceId"),
          nonce = item.getString("nonce"),
          ciphertext = item.getString("ciphertext"),
          crashTimeMillis = item.getLong("crashTimeMillis"),
          sentAtMillis = if (item.isNull("sentAtMillis")) null else item.getLong("sentAtMillis"),
          held = item.getBoolean("held"),
        )
      }
    } catch (error: Exception) {
      Log.w("CrashAlerts", "Couldn't read queued Crash alerts.", error)
      emptyList()
    }
  }

  override fun save(alerts: List<QueuedCrashAlert>) {
    val array = JSONArray()
    for (alert in alerts) {
      array.put(
        JSONObject()
          .put("messageId", alert.messageId)
          .put("alertId", alert.alertId)
          .put("type", alert.type.name)
          .put("groupId", alert.groupId)
          .put("epochId", alert.epochId)
          .put("senderDeviceId", alert.senderDeviceId)
          .put("nonce", alert.nonce)
          .put("ciphertext", alert.ciphertext)
          .put("crashTimeMillis", alert.crashTimeMillis)
          .put("sentAtMillis", alert.sentAtMillis ?: JSONObject.NULL)
          .put("held", alert.held),
      )
    }
    check(prefs().edit().putString("outbox", array.toString()).commit())
  }
}
