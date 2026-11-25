package expo.modules.openbeacontracking.drives

import android.content.Context
import android.util.Log
import expo.modules.openbeacontracking.keys.KeystoreSealer
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

class SecureDriveLog(
  context: Context,
) : DriveLog {
  private val file = File(context.applicationContext.noBackupFilesDir, FILE_NAME)
  private val sealer = KeystoreSealer(KEY_ALIAS)
  private var saved: DriveLogEntry? = null

  @Synchronized
  override fun read(): DriveLogEntry? {
    if (!file.exists()) return null
    return try {
      val lines = file.readLines().filter { it.isNotBlank() }.map { JSONObject(sealer.open(it)) }
      val header = lines.first()
      val epochs = header.getJSONObject("startEpochs")
      DriveLogEntry(
        owner = header.getString("owner"),
        startEpochs = epochs.keys().asSequence().associateWith { epochs.getString(it) },
        fixes = lines.drop(1).flatMap { line -> line.getJSONArray("fixes").let { array -> (0 until array.length()).map { fix(array.getJSONArray(it)) } } },
      ).also { saved = it }
    } catch (error: Exception) {
      Log.e(TAG, "Failed to read the drive in progress.", error)
      clear()
      null
    }
  }

  @Synchronized
  override fun save(entry: DriveLogEntry) {
    val previous = saved
    val appendable =
      previous != null &&
        file.exists() &&
        previous.owner == entry.owner &&
        previous.startEpochs == entry.startEpochs &&
        entry.fixes.size >= previous.fixes.size &&
        entry.fixes.subList(0, previous.fixes.size) == previous.fixes
    if (appendable) {
      val added = entry.fixes.drop(previous!!.fixes.size)
      if (added.isNotEmpty()) file.appendText(line(added) + "\n")
    } else {
      val header = JSONObject().put("owner", entry.owner).put("startEpochs", JSONObject(entry.startEpochs))
      val temporary = File(file.parentFile, "$FILE_NAME.tmp")
      temporary.writeText(sealer.seal(header.toString()) + "\n" + (if (entry.fixes.isEmpty()) "" else line(entry.fixes) + "\n"))
      check(temporary.renameTo(file))
    }
    saved = entry
  }

  @Synchronized
  override fun clear() {
    saved = null
    if (file.exists()) file.delete()
  }

  private fun line(fixes: List<DriveFix>): String =
    sealer.seal(
      JSONObject()
        .put(
          "fixes",
          JSONArray(
            fixes.map { fix ->
              JSONArray()
                .put(fix.timeMillis)
                .put(fix.latitude)
                .put(fix.longitude)
                .put(fix.speed ?: JSONObject.NULL)
                .put(fix.accuracy ?: JSONObject.NULL)
                .put(fix.batterySaver)
            },
          ),
        ).toString(),
    )

  private fun fix(array: JSONArray) =
    DriveFix(
      timeMillis = array.getLong(0),
      latitude = array.getDouble(1),
      longitude = array.getDouble(2),
      speed = if (array.isNull(3)) null else array.getDouble(3),
      accuracy = if (array.isNull(4)) null else array.getDouble(4),
      batterySaver = array.getBoolean(5),
    )

  companion object {
    private const val TAG = "SecureDriveLog"
    private const val KEY_ALIAS = "openbeacon_tracking_drive_log_v1"
    private const val FILE_NAME = "openbeacon_drive_log_v1"
  }
}
