package expo.modules.openbeacontracking.queue

import android.app.Activity
import android.app.Instrumentation
import android.database.sqlite.SQLiteDatabase
import android.os.Bundle
import androidx.room.Room
import expo.modules.openbeacontracking.capture.CapturePipeline
import expo.modules.openbeacontracking.keys.InMemoryEpochKeyStore
import expo.modules.openbeacontracking.keys.ProvisionedEpochKey
import java.util.UUID

class RoomQueueInstrumentation : Instrumentation() {
  override fun onCreate(arguments: Bundle?) {
    super.onCreate(arguments)
    start()
  }

  override fun onStart() {
    try {
      verifyOwnershipAndDeduplication()
      verifyMigration()
      finish(Activity.RESULT_OK, Bundle().apply { putString("stream", "Room queue privacy tests passed\n") })
    } catch (error: Throwable) {
      finish(Activity.RESULT_CANCELED, Bundle().apply { putString("stream", "Room queue privacy tests failed: ${error.stackTraceToString()}\n") })
    }
  }

  private fun verifyOwnershipAndDeduplication() {
    val database = Room.inMemoryDatabaseBuilder(targetContext, CiphertextQueueDatabase::class.java)
      .allowMainThreadQueries().build()
    try {
      val dao = database.ciphertextQueueDao()
      val queue = RoomCiphertextQueue(dao)
      val row = CiphertextQueueRow(
        clientPointId = "legacy", captureId = "capture", groupId = "group", epochId = "epoch",
        senderDeviceId = "device", kind = "trackingPoint", algorithm = "algorithm", nonce = "nonce",
        ciphertext = "ciphertext", queuedAt = 1,
      )
      check(queue.insertAll(listOf(row, row.copy(clientPointId = "a", owner = "server-a/user-a"), row.copy(clientPointId = "b", owner = "server-a/user-b"), row.copy(clientPointId = "c", owner = "server-b/user-a"))) == 4)
      check(queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10, "server-a/user-a").map { it.clientPointId } == listOf("a"))
      check(queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10, "server-a/user-b").map { it.clientPointId } == listOf("b"))
      check(queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10, "server-b/user-a").map { it.clientPointId } == listOf("c"))
      check(dao.countUnassigned("device") == 1)
      dao.assignUnassigned("other-device", "server-a/user-b")
      check(dao.countUnassigned("device") == 1)
      dao.assignUnassigned("device", "server-a/user-a")
      check(dao.countUnassigned("device") == 0)
      check(queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10, "server-a/user-a").map { it.clientPointId } == listOf("legacy", "a"))
      check(queue.insertAll(listOf(row.copy(clientPointId = "a", owner = "server-a/user-a"))) == 0)
      val accountA = queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10, "server-a/user-a").last()
      queue.markInFlight(listOf(accountA.id), System.currentTimeMillis())
      check(queue.listByStatus(CiphertextQueueRow.STATUS_IN_FLIGHT, 10, "server-a/user-a").single().clientPointId == "a")
      check(queue.listByStatus(CiphertextQueueRow.STATUS_IN_FLIGHT, 10, "server-a/user-b").isEmpty())
      check(queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10, "server-a/user-b").single().clientPointId == "b")
      queue.requeue(listOf(accountA.id), System.currentTimeMillis(), "offline")
      check(queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10, "server-a/user-a").last().lastError == "offline")

      val keys = InMemoryEpochKeyStore()
      keys.replaceAll(listOf(ProvisionedEpochKey("group", "epoch", ByteArray(32), "device", "trackingPoint")))
      fun pipeline() = CapturePipeline(epochKeyStore = keys, ciphertextQueue = queue, queueOwner = { "server-a/user-a" }, bootId = "boot")
      fun capture(pipeline: CapturePipeline, id: Long) = pipeline.onFix(51.5, -0.1, "2026-07-13T18:45:00.000Z", null, 80, false, fixId = id)
      check(capture(pipeline(), 100) == 1)
      val first = queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10, "server-a/user-a").last()
      check(!first.ciphertext.contains("51.5"))
      check(capture(pipeline(), 101) == 1)
      check(capture(pipeline(), 100) == 0)
      queue.deleteByIds(listOf(first.id))
      check(capture(pipeline(), 100) == 1)
      check(queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10, "server-a/user-a").last().clientPointId == first.clientPointId)
    } finally {
      database.close()
    }
  }

  private fun verifyMigration() {
    val name = "openbeacon-test-${UUID.randomUUID()}.db"
    val file = targetContext.getDatabasePath(name)
    file.parentFile?.mkdirs()
    val old = SQLiteDatabase.openOrCreateDatabase(file, null)
    try {
      old.execSQL("CREATE TABLE ciphertext_queue (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, clientPointId TEXT NOT NULL, captureId TEXT NOT NULL, groupId TEXT NOT NULL, epochId TEXT NOT NULL, senderDeviceId TEXT NOT NULL, kind TEXT NOT NULL, algorithm TEXT NOT NULL, nonce TEXT NOT NULL, ciphertext TEXT NOT NULL, queuedAt INTEGER NOT NULL, attemptCount INTEGER NOT NULL, lastAttemptAt INTEGER, lastError TEXT, status TEXT NOT NULL)")
      old.execSQL("CREATE UNIQUE INDEX index_ciphertext_queue_clientPointId ON ciphertext_queue (clientPointId)")
      old.execSQL("CREATE INDEX index_ciphertext_queue_status_id ON ciphertext_queue (status, id)")
      old.execSQL("CREATE INDEX index_ciphertext_queue_groupId_id ON ciphertext_queue (groupId, id)")
      old.execSQL("INSERT INTO ciphertext_queue (clientPointId, captureId, groupId, epochId, senderDeviceId, kind, algorithm, nonce, ciphertext, queuedAt, attemptCount, status) VALUES ('legacy', 'capture', 'group', 'epoch', 'device', 'trackingPoint', 'algorithm', 'nonce', 'ciphertext', 1, 0, 'PENDING')")
      old.version = 1
    } finally {
      old.close()
    }
    val database = Room.databaseBuilder(targetContext, CiphertextQueueDatabase::class.java, name)
      .allowMainThreadQueries().addMigrations(CiphertextQueueDatabase.MIGRATION_1_2).build()
    try {
      val dao = database.ciphertextQueueDao()
      check(dao.countUnassigned("device") == 1)
      check(dao.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10, "server-a/user-a", 0).isEmpty())
      dao.assignUnassigned("device", "server-a/user-a")
      check(dao.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10, "server-a/user-a", 0).single().ciphertext == "ciphertext")
      check(dao.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10, "server-a/user-b", 0).isEmpty())
    } finally {
      database.close()
      targetContext.deleteDatabase(name)
    }
  }
}
