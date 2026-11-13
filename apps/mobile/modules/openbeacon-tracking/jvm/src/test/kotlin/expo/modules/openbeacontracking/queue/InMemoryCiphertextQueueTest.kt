package expo.modules.openbeacontracking.queue

import kotlin.test.Test
import kotlin.test.assertEquals

class InMemoryCiphertextQueueTest {
  @Test
  fun deletesEveryPointAnOwnerHasQueuedIncludingOnesBeingUploaded() {
    val queue = InMemoryCiphertextQueue()
    val row = { clientPointId: String, owner: String ->
      CiphertextQueueRow(
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
    }
    queue.insertAll(listOf(row("a", "server-a/user-a"), row("b", "server-a/user-a"), row("other", "server-a/user-b")))
    val inFlight = queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 1, "server-a/user-a").single()
    queue.markInFlight(listOf(inFlight.id), 1)

    queue.deleteByOwner("server-a/user-a")

    assertEquals(emptyList(), queue.listByStatus(CiphertextQueueRow.STATUS_IN_FLIGHT, 10, "server-a/user-a"))
    assertEquals(emptyList(), queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10, "server-a/user-a"))
    assertEquals(listOf("other"), queue.listByStatus(CiphertextQueueRow.STATUS_PENDING, 10).map { it.clientPointId })
  }
}
