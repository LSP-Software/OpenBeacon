package expo.modules.openbeacontracking.queue

import android.app.Activity
import android.app.Instrumentation
import android.os.Bundle
import androidx.room.Room
import expo.modules.openbeacontracking.capture.CapturePipeline
import expo.modules.openbeacontracking.keys.InMemoryEpochKeyStore
import expo.modules.openbeacontracking.keys.ProvisionedEpochKey
import java.util.UUID

class OfflineQueueStorageBenchmark : Instrumentation() {
  override fun onCreate(arguments: Bundle?) {
    super.onCreate(arguments)
    start()
  }

  override fun onStart() {
    try {
      val measurement = measureProductionStorage()
      finish(Activity.RESULT_OK, Bundle().apply { putString("stream", "Offline queue storage benchmark finished\n$measurement\n") })
    } catch (error: Throwable) {
      finish(Activity.RESULT_CANCELED, Bundle().apply { putString("stream", "Offline queue storage benchmark failed: ${error.stackTraceToString()}\n") })
    }
  }

  private fun measureProductionStorage(): String {
    val name = "openbeacon-size-${UUID.randomUUID()}.db"
    val database = Room.databaseBuilder(targetContext, CiphertextQueueDatabase::class.java, name)
      .allowMainThreadQueries().addCallback(CiphertextQueueDatabase.BOUND_WAL).build()
    try {
      val queue = RoomCiphertextQueue(database)
      val keys = InMemoryEpochKeyStore()
      keys.replaceAll(listOf(
        ProvisionedEpochKey("group-1", "epoch", ByteArray(32), "device", "trackingPoint"),
        ProvisionedEpochKey("group-2", "epoch", ByteArray(32) { 1 }, "device", "trackingPoint"),
      ))
      val pipeline = CapturePipeline(epochKeyStore = keys, ciphertextQueue = queue, queueOwner = { "server-a/user-a" }, bootId = "boot")
      for (fixId in 1L..12_000L) {
        check(pipeline.onFix(51.5 + fixId / 1e6, -0.1, at("2026-07-13T18:45:00.000Z"), 1.5, 80, false, fixId = fixId) == 2)
      }
      val files = listOf("", "-wal", "-shm").map { suffix -> targetContext.getDatabasePath(name + suffix) }
      val diskBytes = files.sumOf { it.length() }
      val retained = database.ciphertextQueueDao().count()
      val eviction = database.ciphertextQueueDao().getEviction("server-a/user-a") ?: error("Expected evictions at production limit")
      check(database.usedBytes() <= CiphertextQueueDatabase.MAX_DATABASE_BYTES)
      check(diskBytes <= CiphertextQueueDatabase.MAX_TOTAL_BYTES + 64 * 1024)
      return "Production queue limit: $retained group-points retained, ${eviction.pointCount} evicted, " +
        "${database.usedBytes()} live database bytes, $diskBytes bytes on disk (${files.joinToString { "${it.name.substringAfter(name).ifEmpty { "db" }}=${it.length()}" }})"
    } finally {
      database.close()
      targetContext.deleteDatabase(name)
    }
  }
}

private fun at(iso: String) = java.time.Instant.parse(iso).toEpochMilli()
