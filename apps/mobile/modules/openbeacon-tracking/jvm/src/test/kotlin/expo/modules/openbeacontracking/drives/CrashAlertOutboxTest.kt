package expo.modules.openbeacontracking.drives

import expo.modules.openbeacontracking.capture.BatterySnapshot
import expo.modules.openbeacontracking.capture.CaptureSamplingPolicy
import expo.modules.openbeacontracking.crypto.CrashAlertCodec
import expo.modules.openbeacontracking.crypto.CrashAlertType
import expo.modules.openbeacontracking.crypto.SealedCrashAlert
import expo.modules.openbeacontracking.keys.ProvisionedEpochKey
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CrashAlertOutboxTest {
  private val crashAt = 1_795_975_440_000L
  private val suspicion = CrashSuspicion(timeMillis = crashAt, latitude = 51.65, longitude = -0.2, speedBefore = 18.8)
  private val keys =
    listOf(
      ProvisionedEpochKey("family", "family_epoch", ByteArray(32) { 1 }, "phone", "tracking"),
      ProvisionedEpochKey("work", "work_epoch", ByteArray(32) { 2 }, "phone", "tracking"),
    )

  private fun outbox() = CrashAlertOutbox(InMemoryCrashAlertStore())

  private fun open(alert: QueuedCrashAlert) =
    CrashAlertCodec.open(
      SealedCrashAlert(alert.messageId, alert.nonce, alert.ciphertext),
      keys.first { it.groupId == alert.groupId }.epochKey,
      alert.groupId,
      alert.epochId,
      alert.senderDeviceId,
    )

  @Test
  fun aCrashAlertGoesToEveryGroupThePhoneSharesWithAndEachMemberCanReadIt() {
    val outbox = outbox()
    val sentAt = crashAt + 60_000
    val alertId = outbox.queueCrash(suspicion, "Barnet Lane, EN5", keys, "phone", sentAt)

    val waiting = outbox.waiting(sentAt)
    assertEquals(setOf("family", "work"), waiting.map { it.groupId }.toSet())
    for (alert in waiting) {
      val message = open(alert)
      assertEquals(CrashAlertType.CRASH, message.type)
      assertEquals(alertId, message.alertId)
      assertEquals(crashAt, message.crashTimeMillis)
      assertEquals("Barnet Lane, EN5", message.placeLabel)
      assertEquals(sentAt + 15 * 60_000, message.sharingUntilMillis)
    }
  }

  @Test
  fun aCrashAlertWithNoSignalWaitsThenIsDroppedTwoHoursAfterTheCrash() {
    val outbox = outbox()
    val alertId = outbox.queueCrash(suspicion, null, keys, "phone", crashAt + 60_000)

    assertEquals(emptyList(), outbox.expire(crashAt + 2 * 3_600_000 - 1))
    assertEquals(2, outbox.waiting(crashAt + 2 * 3_600_000 - 1).size)

    assertEquals(listOf(alertId), outbox.expire(crashAt + 2 * 3_600_000))
    assertEquals(emptyList(), outbox.waiting(crashAt + 2 * 3_600_000))
    assertEquals(emptyList(), outbox.expire(crashAt + 3 * 3_600_000))
  }

  @Test
  fun aDroppedAlertThatReachedOneGroupIsNotReportedAsNeverSent() {
    val outbox = outbox()
    val alertId = outbox.queueCrash(suspicion, null, keys, "phone", crashAt + 60_000)
    val family = outbox.waiting(crashAt).first { it.groupId == "family" }
    outbox.markSent(listOf(family.messageId to "family"), crashAt + 90_000)

    assertEquals(mapOf("family" to crashAt + 90_000, "work" to null), outbox.deliveries(alertId))
    assertEquals(emptyList(), outbox.expire(crashAt + 2 * 3_600_000))
  }

  @Test
  fun imOkBeforeAnyGroupGotTheAlertCancelsItAndTellsNobody() {
    val outbox = outbox()
    val alertId = outbox.queueCrash(suspicion, null, keys, "phone", crashAt + 60_000)

    assertFalse(outbox.queueOk(alertId, suspicion, null, keys, crashAt + 120_000))
    assertEquals(emptyList(), outbox.waiting(crashAt + 120_000))
  }

  @Test
  fun imOkAfterSendingTellsOnlyTheGroupsThatGotTheAlert() {
    val outbox = outbox()
    val alertId = outbox.queueCrash(suspicion, "Barnet Lane, EN5", keys, "phone", crashAt + 60_000)
    val family = outbox.waiting(crashAt).first { it.groupId == "family" }
    outbox.markSent(listOf(family.messageId to "family"), crashAt + 61_000)

    assertTrue(outbox.queueOk(alertId, suspicion, "Barnet Lane, EN5", keys, crashAt + 300_000))

    val waiting = outbox.waiting(crashAt + 300_000)
    assertEquals(listOf("family"), waiting.map { it.groupId })
    val ok = open(waiting.single())
    assertEquals(CrashAlertType.OK, ok.type)
    assertEquals(alertId, ok.alertId)
    assertEquals(crashAt + 300_000, ok.okAtMillis)
    assertEquals(crashAt, ok.crashTimeMillis)
    assertEquals("Barnet Lane, EN5", ok.placeLabel)
  }

  @Test
  fun anAlertThatLandsAfterImOkIsFollowedByTheOkMessage() {
    val outbox = outbox()
    val alertId = outbox.queueCrash(suspicion, null, keys, "phone", crashAt + 60_000)
    val inFlight = outbox.waiting(crashAt).first { it.groupId == "work" }

    assertFalse(outbox.queueOk(alertId, suspicion, null, keys, crashAt + 120_000))
    outbox.markSent(listOf(inFlight.messageId to "work"), crashAt + 121_000)

    val waiting = outbox.waiting(crashAt + 121_000)
    assertEquals(listOf("work"), waiting.map { it.groupId })
    assertEquals(CrashAlertType.OK, open(waiting.single()).type)
  }

  @Test
  fun aRefusedCopyLeavesTheQueue() {
    val outbox = outbox()
    outbox.queueCrash(suspicion, null, keys, "phone", crashAt + 60_000)
    val work = outbox.waiting(crashAt).first { it.groupId == "work" }

    outbox.drop(listOf(work.messageId to "work"))

    assertEquals(listOf("family"), outbox.waiting(crashAt).map { it.groupId })
  }

  @Test
  fun sharingRunsEveryTenSecondsForFifteenMinutesAfterSendingWhateverTheBatterySettings() {
    val sentAt = crashAt + 60_000
    val until = CrashAlertOutbox.sharingUntil(sentAt)
    val lowBattery = BatterySnapshot(level = 10, levelKnown = true, charging = false, powerSaveMode = true)

    val during =
      CaptureSamplingPolicy.evaluate(
        battery = lowBattery,
        speedMetersPerSecond = 0.0,
        accuracyMeters = 5.0,
        distanceFromLastQueuedMeters = 0.0,
        timeSinceLastQueuedMs = 10_000,
        lowPowerMode = true,
        crashSharing = CrashAlertOutbox.isSharing(until, sentAt + 15 * 60_000 - 1),
      )
    assertEquals(10_000L, during.intervalMs)
    assertTrue(during.shouldQueue)
    assertTrue(during.uploadIntervalMs <= 10_000L)

    val after =
      CaptureSamplingPolicy.evaluate(
        battery = lowBattery,
        speedMetersPerSecond = 0.0,
        accuracyMeters = 5.0,
        distanceFromLastQueuedMeters = 0.0,
        timeSinceLastQueuedMs = 10_000,
        lowPowerMode = true,
        crashSharing = CrashAlertOutbox.isSharing(until, sentAt + 15 * 60_000),
      )
    assertEquals(CaptureSamplingPolicy.BATTERY_SAVER_DEFAULT_INTERVAL_MS, after.intervalMs)
  }

  @Test
  fun deliveriesAreForgottenForUnknownAlerts() {
    assertNull(outbox().deliveries("0123456789abcdef0123456789abcdef"))
  }
}
