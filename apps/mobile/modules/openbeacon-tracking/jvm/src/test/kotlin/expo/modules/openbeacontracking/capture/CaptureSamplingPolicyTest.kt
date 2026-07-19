package expo.modules.openbeacontracking.capture

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CaptureSamplingPolicyTest {
  @Test
  fun defaultIntervalWhenIdleAndNotBatterySaver() {
    val decision =
      CaptureSamplingPolicy.evaluate(
        battery = battery(level = 80),
        speedMetersPerSecond = 0.2,
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
        distanceFromLastQueuedMeters = 5.0,
        timeSinceLastQueuedMs = 5_000L,
      )

    assertTrue(decision.shouldQueue)
    assertEquals(10_000L, decision.intervalMs)
  }

  @Test
  fun batterySaverDoublesIntervals() {
    val idle =
      CaptureSamplingPolicy.evaluate(
        battery = battery(level = 80, powerSaveMode = true),
        speedMetersPerSecond = 0.0,
        distanceFromLastQueuedMeters = 40.0,
        timeSinceLastQueuedMs = 30_000L,
      )
    val moving =
      CaptureSamplingPolicy.evaluate(
        battery = battery(level = 80, powerSaveMode = true),
        speedMetersPerSecond = 2.0,
        distanceFromLastQueuedMeters = 40.0,
        timeSinceLastQueuedMs = 10_000L,
      )

    assertEquals(60_000L, idle.intervalMs)
    assertEquals(20_000L, moving.intervalMs)
  }

  @Test
  fun startWithoutPriorFixUsesBatterySaverInterval() {
    val decision =
      CaptureSamplingPolicy.evaluate(
        battery = battery(level = 80, powerSaveMode = true),
        speedMetersPerSecond = null,
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
        distanceFromLastQueuedMeters = 40.0,
        timeSinceLastQueuedMs = 30_000L,
      )

    assertEquals(60_000L, decision.intervalMs)
  }

  @Test
  fun unknownBatteryLevelDoesNotCountAsBatterySaver() {
    val decision =
      CaptureSamplingPolicy.evaluate(
        battery = battery(level = 0, levelKnown = false),
        speedMetersPerSecond = null,
        distanceFromLastQueuedMeters = 40.0,
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
        distanceFromLastQueuedMeters = 40.0,
        timeSinceLastQueuedMs = 30_000L,
      )

    assertEquals(30_000L, decision.intervalMs)
  }

  @Test
  fun skipsStationaryFixesBelowMovementThreshold() {
    val decision =
      CaptureSamplingPolicy.evaluate(
        battery = battery(level = 80),
        speedMetersPerSecond = 0.1,
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
        distanceFromLastQueuedMeters = 1.0,
        timeSinceLastQueuedMs = 5_000L,
      )

    assertTrue(decision.shouldQueue)
    assertEquals(10_000L, decision.intervalMs)
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
