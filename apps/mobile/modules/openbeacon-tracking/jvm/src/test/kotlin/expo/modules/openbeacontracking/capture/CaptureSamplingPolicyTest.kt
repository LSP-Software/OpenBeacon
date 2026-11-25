package expo.modules.openbeacontracking.capture

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CaptureSamplingPolicyTest {
  @Test
  fun forcedRefreshQueuesAStationaryFixAndRequestsImmediateUpload() {
    val normal = CaptureSamplingPolicy.evaluate(
      battery = battery(level = 80),
      speedMetersPerSecond = 0.0,
      accuracyMeters = 5.0,
      distanceFromLastQueuedMeters = 0.0,
      timeSinceLastQueuedMs = 5_000L,
    )
    val forced = CaptureSamplingPolicy.evaluate(
      battery = battery(level = 80),
      speedMetersPerSecond = 0.0,
      accuracyMeters = 5.0,
      distanceFromLastQueuedMeters = 0.0,
      timeSinceLastQueuedMs = 5_000L,
      forcedRefresh = true,
    )
    assertFalse(normal.shouldQueue)
    assertFalse(normal.forceUpload)
    assertTrue(forced.shouldQueue)
    assertTrue(forced.forceUpload)
  }

  @Test
  fun aStillPhoneConfirmingAPlaceSamplesLikeAMovingOne() {
    val confirming = { level: Int, saver: Boolean, confirmingPlace: Boolean ->
      CaptureSamplingPolicy.evaluate(
        battery = battery(level = level, powerSaveMode = saver),
        speedMetersPerSecond = 0.0,
        accuracyMeters = 5.0,
        distanceFromLastQueuedMeters = 0.0,
        timeSinceLastQueuedMs = 30_000L,
        confirmingPlace = confirmingPlace,
      )
    }
    assertEquals(30_000L, confirming(80, false, false).intervalMs)
    assertEquals(10_000L, confirming(80, false, true).intervalMs)
    assertEquals(20_000L, confirming(80, true, true).intervalMs)
    assertEquals(60_000L, confirming(80, false, true).uploadIntervalMs)
    assertFalse(confirming(80, false, true).shouldQueue)
  }

  @Test
  fun defaultIntervalWhenIdleAndNotBatterySaver() {
    val decision =
      CaptureSamplingPolicy.evaluate(
        battery = battery(level = 80),
        speedMetersPerSecond = 0.2,
        accuracyMeters = 5.0,
        distanceFromLastQueuedMeters = 40.0,
        timeSinceLastQueuedMs = 30_000L,
      )

    assertTrue(decision.shouldQueue)
    assertEquals(30_000L, decision.intervalMs)
  }

  @Test
  fun higherFrequencyWhenMoving() {
    val decision =
      CaptureSamplingPolicy.evaluate(
        battery = battery(level = 80),
        speedMetersPerSecond = 1.5,
        accuracyMeters = 5.0,
        distanceFromLastQueuedMeters = 5.0,
        timeSinceLastQueuedMs = 5_000L,
      )

    assertTrue(decision.shouldQueue)
    assertEquals(10_000L, decision.intervalMs)
  }

  @Test
  fun aSlowWalkCountsAsMoving() {
    val decision =
      CaptureSamplingPolicy.evaluate(
        battery = battery(level = 80),
        speedMetersPerSecond = 0.6,
        accuracyMeters = 5.0,
        distanceFromLastQueuedMeters = 5.0,
        timeSinceLastQueuedMs = 10_000L,
      )

    assertTrue(decision.shouldQueue)
    assertEquals(10_000L, decision.intervalMs)
  }

  @Test
  fun aFixWithoutASpeedCountsAsMovingOnceThePhoneHasCoveredTheDistance() {
    val intervalMs = { distance: Double, elapsedMs: Long ->
      CaptureSamplingPolicy.evaluate(
        battery = battery(level = 80),
        speedMetersPerSecond = null,
        accuracyMeters = null,
        distanceFromLastQueuedMeters = distance,
        timeSinceLastQueuedMs = elapsedMs,
      ).intervalMs
    }

    assertEquals(10_000L, intervalMs(40.0, 30_000L))
    assertEquals(30_000L, intervalMs(20.0, 30_000L))
    assertEquals(30_000L, intervalMs(40.0, 300_000L))
  }

  @Test
  fun uploadsMoreOftenTheFasterThePhoneMoves() {
    val uploadIntervalMs = { speed: Double? ->
      CaptureSamplingPolicy.evaluate(
        battery = battery(level = 80),
        speedMetersPerSecond = speed,
        accuracyMeters = 5.0,
        distanceFromLastQueuedMeters = 5.0,
        timeSinceLastQueuedMs = 5_000L,
      ).uploadIntervalMs
    }

    assertEquals(60_000L, uploadIntervalMs(null))
    assertEquals(60_000L, uploadIntervalMs(0.4))
    assertEquals(55_000L, uploadIntervalMs(1.4))
    assertEquals(15_000L, uploadIntervalMs(5.0))
    assertEquals(5_000L, uploadIntervalMs(10.0))
    assertEquals(5_000L, uploadIntervalMs(31.0))
  }

  @Test
  fun aMovingPhoneUploadsWithTheFixNearestItsDueTime() {
    val fixTimes = generateSequence(9_900L) { it + 9_900L }.take(12).toList()
    val uploadTimes = { speed: Double ->
      val interval =
        CaptureSamplingPolicy.evaluate(
          battery = battery(level = 80),
          speedMetersPerSecond = speed,
          accuracyMeters = 5.0,
          distanceFromLastQueuedMeters = 5.0,
          timeSinceLastQueuedMs = 5_000L,
        ).uploadIntervalMs
      fixTimes.fold(listOf(0L)) { uploads, fix -> if (fix - uploads.last() >= interval) uploads + fix else uploads }.drop(1)
    }

    assertEquals(fixTimes, uploadTimes(13.0))
    assertEquals(listOf(19_800L, 39_600L, 59_400L, 79_200L, 99_000L, 118_800L), uploadTimes(5.5))
    assertEquals(listOf(59_400L, 118_800L), uploadTimes(1.4))
  }

  @Test
  fun lowPowerModeUploadsWithTheFixNearestAMinuteAtAnySpeed() {
    val decision = { speed: Double ->
      CaptureSamplingPolicy.evaluate(
        battery = battery(level = 80),
        speedMetersPerSecond = speed,
        accuracyMeters = 5.0,
        distanceFromLastQueuedMeters = 5.0,
        timeSinceLastQueuedMs = 5_000L,
        lowPowerMode = true,
      )
    }

    assertEquals(10_000L, decision(31.0).intervalMs)
    assertEquals(55_000L, decision(31.0).uploadIntervalMs)
    assertEquals(55_000L, decision(1.4).uploadIntervalMs)
    assertEquals(30_000L, decision(0.0).intervalMs)
    assertEquals(60_000L, decision(0.0).uploadIntervalMs)
  }

  @Test
  fun batterySaverDoublesIntervals() {
    val idle =
      CaptureSamplingPolicy.evaluate(
        battery = battery(level = 80, powerSaveMode = true),
        speedMetersPerSecond = 0.0,
        accuracyMeters = 5.0,
        distanceFromLastQueuedMeters = 40.0,
        timeSinceLastQueuedMs = 30_000L,
      )
    val moving =
      CaptureSamplingPolicy.evaluate(
        battery = battery(level = 80, powerSaveMode = true),
        speedMetersPerSecond = 2.0,
        accuracyMeters = 5.0,
        distanceFromLastQueuedMeters = 40.0,
        timeSinceLastQueuedMs = 10_000L,
      )

    assertEquals(60_000L, idle.intervalMs)
    assertEquals(20_000L, moving.intervalMs)
    assertEquals(120_000L, idle.uploadIntervalMs)
    assertEquals(120_000L, moving.uploadIntervalMs)
  }

  @Test
  fun startWithoutPriorFixUsesBatterySaverInterval() {
    val decision =
      CaptureSamplingPolicy.evaluate(
        battery = battery(level = 80, powerSaveMode = true),
        speedMetersPerSecond = null,
        accuracyMeters = null,
        distanceFromLastQueuedMeters = null,
        timeSinceLastQueuedMs = null,
      )

    assertTrue(decision.shouldQueue)
    assertEquals(60_000L, decision.intervalMs)
  }

  @Test
  fun lowBatteryUnpluggedCountsAsBatterySaver() {
    val decision =
      CaptureSamplingPolicy.evaluate(
        battery = battery(level = 15),
        speedMetersPerSecond = null,
        accuracyMeters = null,
        distanceFromLastQueuedMeters = 5.0,
        timeSinceLastQueuedMs = 30_000L,
      )

    assertEquals(60_000L, decision.intervalMs)
    assertEquals(120_000L, decision.uploadIntervalMs)
  }

  @Test
  fun unknownBatteryLevelDoesNotCountAsBatterySaver() {
    val decision =
      CaptureSamplingPolicy.evaluate(
        battery = battery(level = 0, levelKnown = false),
        speedMetersPerSecond = null,
        accuracyMeters = null,
        distanceFromLastQueuedMeters = 5.0,
        timeSinceLastQueuedMs = 30_000L,
      )

    assertEquals(30_000L, decision.intervalMs)
  }

  @Test
  fun lowBatteryWhileChargingDoesNotCountAsBatterySaver() {
    val decision =
      CaptureSamplingPolicy.evaluate(
        battery = battery(level = 10, charging = true),
        speedMetersPerSecond = null,
        accuracyMeters = null,
        distanceFromLastQueuedMeters = 5.0,
        timeSinceLastQueuedMs = 30_000L,
      )

    assertEquals(30_000L, decision.intervalMs)
    assertEquals(60_000L, decision.uploadIntervalMs)
  }

  @Test
  fun skipsStationaryFixesBelowMovementThreshold() {
    val decision =
      CaptureSamplingPolicy.evaluate(
        battery = battery(level = 80),
        speedMetersPerSecond = 0.1,
        accuracyMeters = 5.0,
        distanceFromLastQueuedMeters = 10.0,
        timeSinceLastQueuedMs = 45_000L,
      )

    assertFalse(decision.shouldQueue)
    assertEquals(30_000L, decision.intervalMs)
  }

  @Test
  fun queuesStationaryHeartbeatAfterMaxSkip() {
    val decision =
      CaptureSamplingPolicy.evaluate(
        battery = battery(level = 80),
        speedMetersPerSecond = 0.0,
        accuracyMeters = 5.0,
        distanceFromLastQueuedMeters = 2.0,
        timeSinceLastQueuedMs = 300_000L,
      )

    assertTrue(decision.shouldQueue)
  }

  @Test
  fun firstFixAlwaysQueues() {
    val decision =
      CaptureSamplingPolicy.evaluate(
        battery = battery(level = 80),
        speedMetersPerSecond = null,
        accuracyMeters = null,
        distanceFromLastQueuedMeters = null,
        timeSinceLastQueuedMs = null,
      )

    assertTrue(decision.shouldQueue)
    assertEquals(30_000L, decision.intervalMs)
  }

  @Test
  fun movingAlwaysQueuesEvenBelowDistanceThreshold() {
    val decision =
      CaptureSamplingPolicy.evaluate(
        battery = battery(level = 80),
        speedMetersPerSecond = 1.0,
        accuracyMeters = 5.0,
        distanceFromLastQueuedMeters = 1.0,
        timeSinceLastQueuedMs = 5_000L,
      )

    assertTrue(decision.shouldQueue)
    assertEquals(10_000L, decision.intervalMs)
  }

  @Test
  fun aSpeedFromAPoorFixIsIgnored() {
    val intervalMs = { accuracy: Double? ->
      CaptureSamplingPolicy.evaluate(
        battery = battery(level = 80),
        speedMetersPerSecond = 1.2,
        accuracyMeters = accuracy,
        distanceFromLastQueuedMeters = 5.0,
        timeSinceLastQueuedMs = 30_000L,
      ).intervalMs
    }

    assertEquals(30_000L, intervalMs(35.0))
    assertEquals(30_000L, intervalMs(null))
    assertEquals(10_000L, intervalMs(20.0))
    assertEquals(10_000L, intervalMs(8.0))
  }

  @Test
  fun aPoorFixStillCountsAsMovingOnceThePhoneHasCoveredTheDistance() {
    val decision =
      CaptureSamplingPolicy.evaluate(
        battery = battery(level = 80),
        speedMetersPerSecond = 0.1,
        accuracyMeters = 30.0,
        distanceFromLastQueuedMeters = 60.0,
        timeSinceLastQueuedMs = 30_000L,
      )

    assertEquals(10_000L, decision.intervalMs)
    assertEquals(55_000L, decision.uploadIntervalMs)
  }

  @Test
  fun aCoarseFixThatJumpedWithinItsAccuracyIsNotMoving() {
    val intervalMs = { accuracy: Double ->
      CaptureSamplingPolicy.evaluate(
        battery = battery(level = 80),
        speedMetersPerSecond = null,
        accuracyMeters = accuracy,
        distanceFromLastQueuedMeters = 40.0,
        timeSinceLastQueuedMs = 30_000L,
      ).intervalMs
    }

    assertEquals(30_000L, intervalMs(30.0))
    assertEquals(10_000L, intervalMs(5.0))
  }

  @Test
  fun movingStartsExactlyAtTheThresholds() {
    val speedIntervalMs = { speed: Double ->
      CaptureSamplingPolicy.evaluate(
        battery = battery(level = 80),
        speedMetersPerSecond = speed,
        accuracyMeters = 5.0,
        distanceFromLastQueuedMeters = 5.0,
        timeSinceLastQueuedMs = 10_000L,
      ).intervalMs
    }
    val distanceIntervalMs = { distance: Double ->
      CaptureSamplingPolicy.evaluate(
        battery = battery(level = 80),
        speedMetersPerSecond = null,
        accuracyMeters = null,
        distanceFromLastQueuedMeters = distance,
        timeSinceLastQueuedMs = 50_000L,
      ).intervalMs
    }

    assertEquals(10_000L, speedIntervalMs(0.5))
    assertEquals(30_000L, speedIntervalMs(0.49))
    assertEquals(10_000L, distanceIntervalMs(25.0))
    assertEquals(30_000L, distanceIntervalMs(24.9))
  }

  @Test
  fun aPhoneMovingByDistanceUploadsWithTheFixNearestAMinute() {
    val decision =
      CaptureSamplingPolicy.evaluate(
        battery = battery(level = 80),
        speedMetersPerSecond = null,
        accuracyMeters = null,
        distanceFromLastQueuedMeters = 40.0,
        timeSinceLastQueuedMs = 30_000L,
      )

    assertEquals(10_000L, decision.intervalMs)
    assertEquals(55_000L, decision.uploadIntervalMs)
  }

  @Test
  fun batterySaverKeepsTheSlowestUploadRateWhileMovingByDistance() {
    val decision =
      CaptureSamplingPolicy.evaluate(
        battery = battery(level = 80, powerSaveMode = true),
        speedMetersPerSecond = null,
        accuracyMeters = null,
        distanceFromLastQueuedMeters = 40.0,
        timeSinceLastQueuedMs = 30_000L,
      )

    assertEquals(20_000L, decision.intervalMs)
    assertEquals(120_000L, decision.uploadIntervalMs)
  }

  @Test
  fun anOpenDriveAsksForBatchedSecondFixesUntilACrashAlertNeedsAFixEveryTenSeconds() {
    val driving =
      CaptureSamplingPolicy.evaluate(
        battery = battery(level = 80),
        speedMetersPerSecond = 0.0,
        accuracyMeters = 5.0,
        distanceFromLastQueuedMeters = 0.0,
        timeSinceLastQueuedMs = 1_000L,
        fastDriveFixes = true,
      )
    val afterCrash =
      CaptureSamplingPolicy.evaluate(
        battery = battery(level = 80),
        speedMetersPerSecond = 0.0,
        accuracyMeters = 5.0,
        distanceFromLastQueuedMeters = 0.0,
        timeSinceLastQueuedMs = 1_000L,
        fastDriveFixes = true,
        crashSharing = true,
      )

    assertEquals(CaptureSamplingPolicy.DRIVE_INTERVAL_MS, driving.intervalMs)
    assertEquals(CaptureSamplingPolicy.DRIVE_BATCH_MS, CaptureSamplingPolicy.maxUpdateDelayMs(driving.intervalMs))
    assertEquals(10_000L, afterCrash.intervalMs)
    assertEquals(10_000L, CaptureSamplingPolicy.maxUpdateDelayMs(afterCrash.intervalMs))
  }

  private fun battery(
    level: Int,
    charging: Boolean = false,
    powerSaveMode: Boolean = false,
    levelKnown: Boolean = true,
  ) = BatterySnapshot(
    level = level,
    charging = charging,
    powerSaveMode = powerSaveMode,
    levelKnown = levelKnown,
  )
}
