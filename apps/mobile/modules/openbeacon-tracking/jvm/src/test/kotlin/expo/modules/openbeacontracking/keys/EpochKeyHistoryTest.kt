package expo.modules.openbeacontracking.keys

import kotlin.test.Test
import kotlin.test.assertEquals

class EpochKeyHistoryTest {
  private var now = 1_795_594_440_000L
  private val history = EpochKeyHistory(InMemoryEpochKeyStore(), InMemoryTimedEpochKeyStore(), nowMillis = { now })

  private fun key(
    groupId: String,
    epochId: String,
  ) = ProvisionedEpochKey(groupId, epochId, ByteArray(32) { epochId.length.toByte() }, "device-1", "trackingPoint")

  @Test
  fun aTimeBeforeTheNewestEpochGetsTheEpochThatWasCurrentThen() {
    history.replaceAll(listOf(key("family", "epoch-1")))
    val before = now
    now += 600_000
    history.replacePreserving(listOf(key("family", "epoch-2")), emptyList())

    assertEquals(listOf("epoch-1"), history.keysAt(before).map { it.epochId })
    assertEquals(listOf("epoch-2"), history.keysAt(now).map { it.epochId })
    assertEquals(listOf("epoch-2"), history.list().map { it.epochId })
  }

  @Test
  fun aGroupWhoseEpochAtThatTimeIsNoLongerHeldIsLeftOut() {
    history.replaceAll(listOf(key("family", "epoch-1"), key("work", "work-1")))
    val before = now
    now += 60_000
    history.replaceAll(listOf(key("family", "epoch-2"), key("work", "work-1")))
    now += EpochKeyHistory.KEEP_MILLIS + 1
    history.replaceAll(listOf(key("family", "epoch-3"), key("work", "work-1")))

    assertEquals(listOf("work-1"), history.keysAt(before).map { it.epochId })
  }

  @Test
  fun leavingAGroupForgetsItsPastEpochs() {
    history.replaceAll(listOf(key("family", "epoch-1")))
    val before = now
    now += 60_000
    history.replaceAll(listOf(key("family", "epoch-2")))
    history.revoke(listOf("family"))
    history.replaceAll(listOf(key("family", "epoch-3")))

    assertEquals(listOf("epoch-3"), history.keysAt(before).map { it.epochId })
  }
}
