package expo.modules.openbeacontracking.drives

import android.content.Context
import android.util.Log
import expo.modules.openbeacontracking.crypto.DriveRecord
import expo.modules.openbeacontracking.crypto.DriveRecordCodec
import expo.modules.openbeacontracking.crypto.GroupPayloadEncrypt
import expo.modules.openbeacontracking.keys.KeystoreSealer
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

class SecureDriveRecordStore(
  context: Context,
  private val nowMillis: () -> Long = { System.currentTimeMillis() },
) : DriveRecordStore {
  private val file = File(context.applicationContext.noBackupFilesDir, FILE_NAME)
  private val sealer = KeystoreSealer(KEY_ALIAS)

  @Synchronized
  override fun save(owner: String, record: DriveRecord) {
    write(read() + (owner to record))
  }

  @Synchronized
  override fun list(owner: String): List<DriveRecord> = read().filter { it.first == owner }.map { it.second }

  @Synchronized
  override fun delete(owner: String, driveIds: Set<String>) {
    write(read().filterNot { it.first == owner && it.second.driveId in driveIds })
  }

  @Synchronized
  override fun clear(owner: String?) {
    write(read().filterNot { owner == null || it.first == owner })
  }

  private fun read(): List<Pair<String, DriveRecord>> {
    if (!file.exists()) return emptyList()
    return try {
      val array = JSONObject(sealer.open(file.readText())).getJSONArray("records")
      (0 until array.length()).mapNotNull { index ->
        val item = array.getJSONObject(index)
        DriveRecordCodec.decode(GroupPayloadEncrypt.decodeBase64(item.getString("record")))?.let { item.getString("owner") to it }
      }
    } catch (error: Exception) {
      Log.e(TAG, "Failed to read recorded drives.", error)
      emptyList()
    }
  }

  private fun write(records: List<Pair<String, DriveRecord>>) {
    val kept = records.filter { nowMillis() - it.second.end.timeMillis < DriveRecordLimits.KEEP_MILLIS }.takeLast(DriveRecordLimits.MAX_RECORDS)
    if (kept.isEmpty()) {
      if (file.exists()) file.delete()
      return
    }
    val array = JSONArray()
    kept.forEach { (owner, record) ->
      val encoded = DriveRecordCodec.encode(record) ?: return@forEach
      array.put(JSONObject().put("owner", owner).put("record", GroupPayloadEncrypt.encodeBase64(encoded)))
    }
    val temporary = File(file.parentFile, "$FILE_NAME.tmp")
    temporary.writeText(sealer.seal(JSONObject().put("records", array).toString()))
    check(temporary.renameTo(file))
  }

  companion object {
    private const val TAG = "SecureDriveRecordStore"
    private const val KEY_ALIAS = "openbeacon_tracking_drive_records_v1"
    private const val FILE_NAME = "openbeacon_drive_records_v1"
  }
}
