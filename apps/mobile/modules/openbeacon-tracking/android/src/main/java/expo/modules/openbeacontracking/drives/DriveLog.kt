package expo.modules.openbeacontracking.drives

data class DriveLogEntry(
  val owner: String,
  val startEpochs: Map<String, String>,
  val fixes: List<DriveFix>,
)

interface DriveLog {
  fun read(): DriveLogEntry?

  fun save(entry: DriveLogEntry)

  fun clear()
}

class InMemoryDriveLog : DriveLog {
  private var entry: DriveLogEntry? = null

  @Synchronized
  override fun read(): DriveLogEntry? = entry

  @Synchronized
  override fun save(entry: DriveLogEntry) {
    this.entry = entry
  }

  @Synchronized
  override fun clear() {
    entry = null
  }
}
