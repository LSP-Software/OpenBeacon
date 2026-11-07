package expo.modules.openbeacontracking.queue

import android.app.Activity
import android.app.Instrumentation
import android.database.sqlite.SQLiteDatabase
import android.os.Bundle
import androidx.room.Room
import expo.modules.openbeacontracking.capture.CapturePipeline
import expo.modules.openbeacontracking.crypto.EncryptedGroupPayload
import expo.modules.openbeacontracking.crypto.GroupPayloadEncrypt
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
      verifyEviction()
      val measurement = measureProductionStorage()
      finish(Activity.RESULT_OK, Bundle().apply { putString("stream", "Room queue privacy tests passed\n$measurement\n") })
    } catch (error: Throwable) {
      finish(Activity.RESULT_CANCELED, Bundle().apply { putString("stream", "Room queue privacy tests failed: ${error.stackTraceToString()}\n") })
    }
  }

  private fun verifyOwnershipAndDeduplication() {
    val database = Room.inMemoryDatabaseBuilder(targetContext, CiphertextQueueDatabase::class.java)
      .allowMainThreadQueries().build()
    try {
      val dao = database.ciphertextQueueDao()
      val queue = RoomCiphertextQueue(database)
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
      val plaintext = GroupPayloadEncrypt.encodeTrackingPointV1Json(51.5, -0.1, "2026-07-13T18:45:00.000Z", null, 80, false).toByteArray(Charsets.UTF_8)
      val ciphertext = GroupPayloadEncrypt.decodeBase64(first.ciphertext)
      check(!ciphertext.toList().windowed(plaintext.size).contains(plaintext.toList()))
      val encrypted = EncryptedGroupPayload(
        algorithm = first.algorithm, ciphertext = first.ciphertext, epochId = first.epochId,
        groupId = first.groupId, kind = first.kind, nonce = first.nonce, senderDeviceId = first.senderDeviceId,
      )
      check(GroupPayloadEncrypt.decryptGroupPayload(ByteArray(32), encrypted).contentEquals(plaintext))
      check(runCatching { GroupPayloadEncrypt.decryptGroupPayload(ByteArray(32) { 1 }, encrypted) }.isFailure)
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
      .allowMainThreadQueries().addMigrations(CiphertextQueueDatabase.MIGRATION_1_2, CiphertextQueueDatabase.MIGRATION_2_3).build()
    try {
      val dao = database.ciphertextQueueDao()
      check(dao.countUnassigned("device") == 1)
      check(dao.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10, "server-a/user-a", 0).isEmpty())
      dao.assignUnassigned("device", "server-a/user-a")
      check(dao.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10, "server-a/user-a", 0).single().ciphertext == "ciphertext")
      check(dao.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10, "server-a/user-b", 0).isEmpty())
      check(dao.getEviction("server-a/user-a") == null)
    } finally {
      database.close()
      targetContext.deleteDatabase(name)
    }
  }

  private fun queueRow(owner: String, groupId: String, queuedAt: Long) = CiphertextQueueRow(
    owner = owner, clientPointId = UUID.randomUUID().toString(), captureId = "capture-$queuedAt", groupId = groupId,
    epochId = "epoch", senderDeviceId = "device", kind = "trackingPoint", algorithm = "algorithm",
    nonce = "n".repeat(32), ciphertext = "c".repeat(1_000), queuedAt = queuedAt,
  )

  private fun verifyEviction() {
    val database = Room.inMemoryDatabaseBuilder(targetContext, CiphertextQueueDatabase::class.java)
      .allowMainThreadQueries().build()
    try {
      val limit = 256L * 1024
      val queue = RoomCiphertextQueue(database, maxDatabaseBytes = limit)
      val dao = database.ciphertextQueueDao()
      check(queue.insertAll(listOf(queueRow("server-a/user-b", "group-1", 1))) == 1)
      check(queue.insertAll(listOf(queueRow("server-a/user-a", "group-1", 2), queueRow("server-a/user-a", "group-2", 2))) == 2)
      val inFlight = queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10, "server-a/user-a")
      check(queue.markInFlight(inFlight.map { it.id }, System.currentTimeMillis()) == inFlight.map { it.id })
      var queuedAt = 3L
      while (dao.getEviction("server-a/user-a") == null) {
        check(queue.insertAll(listOf(queueRow("server-a/user-a", "group-1", queuedAt), queueRow("server-a/user-a", "group-2", queuedAt))) == 2)
        check(database.usedBytes() <= limit)
        queuedAt += 1
        check(queuedAt < 10_000)
      }
      for (index in 0 until 100) {
        queue.insertAll(listOf(queueRow("server-a/user-a", "group-1", queuedAt), queueRow("server-a/user-a", "group-2", queuedAt)))
        check(database.usedBytes() <= limit)
        queuedAt += 1
      }

      val pending = queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10_000, "server-a/user-a")
      val oldestRetained = pending.first().queuedAt
      check(pending.last().queuedAt == queuedAt - 1)
      check(pending.map { it.queuedAt }.toSet() == (oldestRetained until queuedAt).toSet())
      check(pending.groupBy { it.groupId }.keys == setOf("group-1", "group-2"))
      check(queue.listByStatus(CiphertextQueueRow.STATUS_IN_FLIGHT, 10, "server-a/user-a").map { it.id } == inFlight.map { it.id })
      check(queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10, "server-a/user-b").isEmpty())

      val otherOwner = dao.getEviction("server-a/user-b") ?: error("Other owner's eviction was not recorded")
      check(otherOwner.pointCount == 1 && otherOwner.oldestQueuedAt == 1L && otherOwner.newestQueuedAt == 1L)
      val eviction = dao.getEviction("server-a/user-a") ?: error("Eviction was not recorded")
      check(eviction.oldestQueuedAt == 3L)
      check(eviction.newestQueuedAt <= oldestRetained)
      check(eviction.pointCount + pending.size == ((queuedAt - 3) * 2).toInt())

      val evictedId = pending.first().id - 1
      check(queue.markInFlight(listOf(evictedId, pending.first().id), System.currentTimeMillis()) == listOf(pending.first().id))

      while (dao.getEviction("server-a/user-a")?.revision == eviction.revision) {
        queue.insertAll(listOf(queueRow("server-a/user-a", "group-1", queuedAt), queueRow("server-a/user-a", "group-2", queuedAt)))
        queuedAt += 1
      }
      check(queue.listByStatus(CiphertextQueueRow.STATUS_IN_FLIGHT, 10, "server-a/user-a").any { it.id == pending.first().id })
      val newer = dao.getEviction("server-a/user-a") ?: error("Eviction disappeared")
      check(newer.revision > eviction.revision && newer.pointCount > eviction.pointCount)
      queue.acknowledgeEviction("server-a/user-a", eviction.revision)
      check(dao.getEviction("server-a/user-a") == newer)
      queue.acknowledgeEviction("server-a/user-a", newer.revision)
      check(dao.getEviction("server-a/user-a") == null)
      check(dao.getEviction("server-a/user-b") == otherOwner)
    } finally {
      database.close()
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
        check(pipeline.onFix(51.5 + fixId / 1e6, -0.1, "2026-07-13T18:45:00.000Z", 1.5, 80, false, fixId = fixId) == 2)
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
