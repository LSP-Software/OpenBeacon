package expo.modules.openbeacontracking.queue

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import expo.modules.openbeacontracking.capture.CapturePipeline
import expo.modules.openbeacontracking.crypto.EncryptedGroupPayload
import expo.modules.openbeacontracking.crypto.GroupPayloadEncrypt
import expo.modules.openbeacontracking.keys.InMemoryEpochKeyStore
import expo.modules.openbeacontracking.keys.ProvisionedEpochKey
import java.util.UUID
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class OfflineTrackingQueueTest {
  private val context: Context = ApplicationProvider.getApplicationContext()
  private lateinit var database: CiphertextQueueDatabase
  private lateinit var queue: RoomCiphertextQueue

  @Before
  fun openDatabase() {
    database = Room.inMemoryDatabaseBuilder(context, CiphertextQueueDatabase::class.java).allowMainThreadQueries().build()
    queue = RoomCiphertextQueue(database)
  }

  @After
  fun closeDatabase() {
    database.close()
  }

  @Test
  fun `keeps each account's points separate`() {
    assertEquals(
      3,
      queue.insertAll(
        listOf(
          row("a", owner = "server-a/user-a"),
          row("b", owner = "server-a/user-b"),
          row("c", owner = "server-b/user-a"),
        ),
      ),
    )
    assertEquals(listOf("a"), pendingIds("server-a/user-a"))
    assertEquals(listOf("b"), pendingIds("server-a/user-b"))
    assertEquals(listOf("c"), pendingIds("server-b/user-a"))

    val accountA = queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10, "server-a/user-a").single()
    queue.markInFlight(listOf(accountA.id), System.currentTimeMillis())
    assertEquals(listOf("a"), queue.listByStatus(CiphertextQueueRow.STATUS_IN_FLIGHT, 10, "server-a/user-a").map { it.clientPointId })
    assertTrue(queue.listByStatus(CiphertextQueueRow.STATUS_IN_FLIGHT, 10, "server-a/user-b").isEmpty())
    assertEquals(listOf("b"), pendingIds("server-a/user-b"))

    queue.requeue(listOf(accountA.id), System.currentTimeMillis(), "offline")
    assertEquals("offline", queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10, "server-a/user-a").single().lastError)
  }

  @Test
  fun `deletes every point an owner has queued, including ones being uploaded`() {
    queue.insertAll(listOf(row("a"), row("b"), row("c"), row("other")).mapIndexed { index, row ->
      row.copy(owner = if (index < 3) "server-a/user-a" else "server-a/user-b")
    })
    val owned = queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10, "server-a/user-a")
    queue.markInFlight(listOf(owned[0].id), System.currentTimeMillis())

    queue.deleteByOwner("server-a/user-a")

    assertTrue(queue.listByStatus(CiphertextQueueRow.STATUS_IN_FLIGHT, 10, "server-a/user-a").isEmpty())
    assertTrue(pendingIds("server-a/user-a").isEmpty())
    assertEquals(listOf("other"), pendingIds("server-a/user-b"))
  }

  @Test
  fun `assigns ownerless points only to the device that captured them`() {
    val dao = database.ciphertextQueueDao()
    queue.insertAll(listOf(row("legacy"), row("a", owner = "server-a/user-a")))
    assertEquals(1, dao.countUnassigned("device"))

    dao.assignUnassigned("other-device", "server-a/user-b")
    assertEquals(1, dao.countUnassigned("device"))
    assertTrue(pendingIds("server-a/user-b").isEmpty())

    dao.assignUnassigned("device", "server-a/user-a")
    assertEquals(0, dao.countUnassigned("device"))
    assertEquals(listOf("legacy", "a"), pendingIds("server-a/user-a"))
  }

  @Test
  fun `drops duplicate client points`() {
    assertEquals(1, queue.insertAll(listOf(row("a", owner = "server-a/user-a"))))
    assertEquals(0, queue.insertAll(listOf(row("a", owner = "server-a/user-a"))))

    val pipeline = pipeline()
    assertEquals(1, capture(pipeline, 100))
    assertEquals(1, capture(pipeline, 101))
    assertEquals(0, capture(pipeline(), 100))

    val first = queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10, "server-a/user-a")[1]
    queue.deleteByIds(listOf(first.id))
    assertEquals(1, capture(pipeline(), 100))
    assertEquals(first.clientPointId, queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10, "server-a/user-a").last().clientPointId)
  }

  @Test
  fun `stores only ciphertext that decrypts with the group key`() {
    assertEquals(1, capture(pipeline(), 100))
    val stored = queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10, "server-a/user-a").single()
    val plaintext =
      GroupPayloadEncrypt.encodeTrackingPointV1Json(51.5, -0.1, "2026-07-13T18:45:00.000Z", null, 80, false)!!.toByteArray(Charsets.UTF_8)
    val ciphertext = GroupPayloadEncrypt.decodeBase64(stored.ciphertext)
    assertFalse(ciphertext.toList().windowed(plaintext.size).contains(plaintext.toList()))

    val encrypted =
      EncryptedGroupPayload(
        algorithm = stored.algorithm,
        ciphertext = stored.ciphertext,
        epochId = stored.epochId,
        groupId = stored.groupId,
        kind = stored.kind,
        nonce = stored.nonce,
        senderDeviceId = stored.senderDeviceId,
      )
    assertTrue(GroupPayloadEncrypt.decryptGroupPayload(ByteArray(32), encrypted).contentEquals(plaintext))
    assertTrue(runCatching { GroupPayloadEncrypt.decryptGroupPayload(ByteArray(32) { 1 }, encrypted) }.isFailure)
  }

  @Test
  fun `migrates version 1 queues to the current schema`() {
    val name = "openbeacon-test-${UUID.randomUUID()}.db"
    val file = context.getDatabasePath(name)
    file.parentFile?.mkdirs()
    SQLiteDatabase.openOrCreateDatabase(file, null).use { old ->
      old.execSQL(
        "CREATE TABLE ciphertext_queue (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, clientPointId TEXT NOT NULL, captureId TEXT NOT NULL, groupId TEXT NOT NULL, epochId TEXT NOT NULL, senderDeviceId TEXT NOT NULL, kind TEXT NOT NULL, algorithm TEXT NOT NULL, nonce TEXT NOT NULL, ciphertext TEXT NOT NULL, queuedAt INTEGER NOT NULL, attemptCount INTEGER NOT NULL, lastAttemptAt INTEGER, lastError TEXT, status TEXT NOT NULL)",
      )
      old.execSQL("CREATE UNIQUE INDEX index_ciphertext_queue_clientPointId ON ciphertext_queue (clientPointId)")
      old.execSQL("CREATE INDEX index_ciphertext_queue_status_id ON ciphertext_queue (status, id)")
      old.execSQL("CREATE INDEX index_ciphertext_queue_groupId_id ON ciphertext_queue (groupId, id)")
      old.execSQL(
        "INSERT INTO ciphertext_queue (clientPointId, captureId, groupId, epochId, senderDeviceId, kind, algorithm, nonce, ciphertext, queuedAt, attemptCount, status) VALUES ('legacy', 'capture', 'group', 'epoch', 'device', 'trackingPoint', 'algorithm', 'nonce', 'ciphertext', 1, 0, 'PENDING')",
      )
      old.version = 1
    }

    val migrated =
      Room
        .databaseBuilder(context, CiphertextQueueDatabase::class.java, name)
        .allowMainThreadQueries()
        .addMigrations(*CiphertextQueueDatabase.MIGRATIONS)
        .build()
    try {
      val dao = migrated.ciphertextQueueDao()
      assertEquals(1, dao.countUnassigned("device"))
      assertTrue(dao.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10, "server-a/user-a", 0).isEmpty())
      dao.assignUnassigned("device", "server-a/user-a")
      assertEquals("ciphertext", dao.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10, "server-a/user-a", 0).single().ciphertext)
      assertTrue(dao.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10, "server-a/user-b", 0).isEmpty())
      assertNull(dao.getEviction("server-a/user-a"))
    } finally {
      migrated.close()
      context.deleteDatabase(name)
    }
  }

  @Test
  fun `evicts the oldest pending points past the size limit`() {
    val limit = 256L * 1024
    val boundedQueue = RoomCiphertextQueue(database, maxDatabaseBytes = limit)
    val dao = database.ciphertextQueueDao()
    assertEquals(1, boundedQueue.insertAll(listOf(sizedRow("server-a/user-b", "group-1", 1))))
    assertEquals(2, boundedQueue.insertAll(listOf(sizedRow("server-a/user-a", "group-1", 2), sizedRow("server-a/user-a", "group-2", 2))))
    val inFlight = boundedQueue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10, "server-a/user-a").map { it.id }
    assertEquals(inFlight, boundedQueue.markInFlight(inFlight, System.currentTimeMillis()))

    var queuedAt = 3L
    val insertPair = {
      assertEquals(2, boundedQueue.insertAll(listOf(sizedRow("server-a/user-a", "group-1", queuedAt), sizedRow("server-a/user-a", "group-2", queuedAt))))
      assertTrue(database.usedBytes() <= limit)
      queuedAt += 1
      assertTrue(queuedAt < 10_000)
    }
    while (dao.getEviction("server-a/user-a") == null) insertPair()
    repeat(100) { insertPair() }

    val pending = boundedQueue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10_000, "server-a/user-a")
    val oldestRetained = pending.first().queuedAt
    assertEquals(queuedAt - 1, pending.last().queuedAt)
    assertEquals((oldestRetained until queuedAt).toSet(), pending.map { it.queuedAt }.toSet())
    assertEquals(setOf("group-1", "group-2"), pending.map { it.groupId }.toSet())
    assertEquals(inFlight, boundedQueue.listByStatus(CiphertextQueueRow.STATUS_IN_FLIGHT, 10, "server-a/user-a").map { it.id })
    assertTrue(boundedQueue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10, "server-a/user-b").isEmpty())

    val otherOwner = checkNotNull(dao.getEviction("server-a/user-b"))
    assertEquals(listOf(1L, 1L, 1L), listOf(otherOwner.pointCount.toLong(), otherOwner.oldestQueuedAt, otherOwner.newestQueuedAt))
    val eviction = checkNotNull(dao.getEviction("server-a/user-a"))
    assertEquals(3L, eviction.oldestQueuedAt)
    assertTrue(eviction.newestQueuedAt <= oldestRetained)
    assertEquals(((queuedAt - 3) * 2).toInt(), eviction.pointCount + pending.size)

    val evictedId = pending.first().id - 1
    assertEquals(listOf(pending.first().id), boundedQueue.markInFlight(listOf(evictedId, pending.first().id), System.currentTimeMillis()))
  }

  @Test
  fun `reports each eviction until its revision is acknowledged`() {
    val boundedQueue = RoomCiphertextQueue(database, maxDatabaseBytes = 256L * 1024)
    val dao = database.ciphertextQueueDao()
    boundedQueue.insertAll(listOf(sizedRow("server-a/user-b", "group-1", 1)))
    var queuedAt = 2L
    val fillUntil = { done: () -> Boolean ->
      while (!done()) {
        boundedQueue.insertAll(listOf(sizedRow("server-a/user-a", "group-1", queuedAt), sizedRow("server-a/user-a", "group-2", queuedAt)))
        queuedAt += 1
        assertTrue(queuedAt < 10_000)
      }
    }

    fillUntil { dao.getEviction("server-a/user-a") != null }
    val eviction = checkNotNull(dao.getEviction("server-a/user-a"))
    val otherOwner = dao.getEviction("server-a/user-b")
    val oldestPending = boundedQueue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 1, "server-a/user-a").single()
    assertEquals(listOf(oldestPending.id), boundedQueue.markInFlight(listOf(oldestPending.id), System.currentTimeMillis()))
    fillUntil { dao.getEviction("server-a/user-a")?.revision != eviction.revision }
    assertEquals(listOf(oldestPending.id), boundedQueue.listByStatus(CiphertextQueueRow.STATUS_IN_FLIGHT, 10, "server-a/user-a").map { it.id })
    val newer = checkNotNull(dao.getEviction("server-a/user-a"))
    assertTrue(newer.revision > eviction.revision)
    assertTrue(newer.pointCount > eviction.pointCount)

    boundedQueue.acknowledgeEviction("server-a/user-a", eviction.revision)
    assertEquals(newer, dao.getEviction("server-a/user-a"))
    boundedQueue.acknowledgeEviction("server-a/user-a", newer.revision)
    assertNull(dao.getEviction("server-a/user-a"))
    assertEquals(otherOwner, dao.getEviction("server-a/user-b"))
  }

  private fun pendingIds(owner: String) = queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10, owner).map { it.clientPointId }

  private fun pipeline(): CapturePipeline {
    val keys = InMemoryEpochKeyStore()
    keys.replaceAll(listOf(ProvisionedEpochKey("group", "epoch", ByteArray(32), "device", "trackingPoint")))
    return CapturePipeline(epochKeyStore = keys, ciphertextQueue = queue, queueOwner = { "server-a/user-a" }, bootId = "boot")
  }

  private fun capture(
    pipeline: CapturePipeline,
    fixId: Long,
  ) = pipeline.onFix(51.5, -0.1, "2026-07-13T18:45:00.000Z", null, 80, false, fixId = fixId)

  private fun row(
    clientPointId: String,
    owner: String? = null,
  ) = CiphertextQueueRow(
    owner = owner,
    clientPointId = clientPointId,
    captureId = "capture",
    groupId = "group",
    epochId = "epoch",
    senderDeviceId = "device",
    kind = "trackingPoint",
    algorithm = "algorithm",
    nonce = "nonce",
    ciphertext = "ciphertext",
    queuedAt = 1,
  )

  private fun sizedRow(
    owner: String,
    groupId: String,
    queuedAt: Long,
  ) = CiphertextQueueRow(
    owner = owner,
    clientPointId = UUID.randomUUID().toString(),
    captureId = "capture-$queuedAt",
    groupId = groupId,
    epochId = "epoch",
    senderDeviceId = "device",
    kind = "trackingPoint",
    algorithm = "algorithm",
    nonce = "n".repeat(32),
    ciphertext = "c".repeat(1_000),
    queuedAt = queuedAt,
  )
}
