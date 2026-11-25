package expo.modules.openbeacontracking.drives

import expo.modules.openbeacontracking.crypto.DriveRecord

interface DriveRecordStore {
  fun save(owner: String, record: DriveRecord)

  fun list(owner: String): List<DriveRecord>

  fun delete(owner: String, driveIds: Set<String>)

  fun clear(owner: String?)
}

object DriveRecordLimits {
  const val MAX_RECORDS = 1_000
  const val KEEP_MILLIS = 31L * 24 * 3_600_000
}

class InMemoryDriveRecordStore : DriveRecordStore {
  private val records = mutableListOf<Pair<String, DriveRecord>>()

  @Synchronized
  override fun save(owner: String, record: DriveRecord) {
    records += owner to record
    while (records.size > DriveRecordLimits.MAX_RECORDS) records.removeAt(0)
  }

  @Synchronized
  override fun list(owner: String): List<DriveRecord> = records.filter { it.first == owner }.map { it.second }

  @Synchronized
  override fun delete(owner: String, driveIds: Set<String>) {
    records.removeAll { it.first == owner && it.second.driveId in driveIds }
  }

  @Synchronized
  override fun clear(owner: String?) {
    records.removeAll { owner == null || it.first == owner }
  }
}
