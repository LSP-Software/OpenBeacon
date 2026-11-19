package expo.modules.openbeacontracking.capture

import kotlin.test.Test
import kotlin.test.assertEquals

class LocateWakePolicyTest {
  private var now = 1_000_000L
  private val policy = LocateWakePolicy { now }

  @Test
  fun aCapturingPhoneTakesAFreshFix() {
    assertEquals(LocateWakePolicy.Action.REFRESH, policy.decide(captureRunning = true, captureRestorable = true, parked = false, paused = false))
  }

  @Test
  fun aPausedPhoneOnlySyncs() {
    assertEquals(LocateWakePolicy.Action.SYNC, policy.decide(captureRunning = true, captureRestorable = true, parked = false, paused = true))
    assertEquals(LocateWakePolicy.Action.SYNC, policy.decide(captureRunning = false, captureRestorable = true, parked = false, paused = true))
  }

  @Test
  fun aParkedPhoneOnlySyncs() {
    assertEquals(LocateWakePolicy.Action.SYNC, policy.decide(captureRunning = false, captureRestorable = true, parked = true, paused = false))
  }

  @Test
  fun aSharingPhoneWhoseCaptureStoppedRestartsIt() {
    assertEquals(LocateWakePolicy.Action.RESTART, policy.decide(captureRunning = false, captureRestorable = true, parked = false, paused = false))
  }

  @Test
  fun aPhoneThatStoppedSharingOnlySyncs() {
    assertEquals(LocateWakePolicy.Action.SYNC, policy.decide(captureRunning = false, captureRestorable = false, parked = false, paused = false))
  }

  @Test
  fun locateRequestsWithinTheCooldownDontStackFixes() {
    assertEquals(LocateWakePolicy.Action.REFRESH, policy.decide(captureRunning = true, captureRestorable = true, parked = false, paused = false))
    now += LocateWakePolicy.COOLDOWN_MS - 1
    assertEquals(LocateWakePolicy.Action.SYNC, policy.decide(captureRunning = true, captureRestorable = true, parked = false, paused = false))
    now += 1
    assertEquals(LocateWakePolicy.Action.REFRESH, policy.decide(captureRunning = true, captureRestorable = true, parked = false, paused = false))
  }

  @Test
  fun restartsShareTheCooldownWithFreshFixes() {
    assertEquals(LocateWakePolicy.Action.RESTART, policy.decide(captureRunning = false, captureRestorable = true, parked = false, paused = false))
    now += LocateWakePolicy.COOLDOWN_MS - 1
    assertEquals(LocateWakePolicy.Action.SYNC, policy.decide(captureRunning = false, captureRestorable = true, parked = false, paused = false))
    assertEquals(LocateWakePolicy.Action.SYNC, policy.decide(captureRunning = true, captureRestorable = true, parked = false, paused = false))
    now += 1
    assertEquals(LocateWakePolicy.Action.REFRESH, policy.decide(captureRunning = true, captureRestorable = true, parked = false, paused = false))
  }

  @Test
  fun aSkippedRequestDoesntStartTheCooldown() {
    assertEquals(LocateWakePolicy.Action.SYNC, policy.decide(captureRunning = true, captureRestorable = true, parked = false, paused = true))
    assertEquals(LocateWakePolicy.Action.SYNC, policy.decide(captureRunning = false, captureRestorable = false, parked = false, paused = false))
    assertEquals(LocateWakePolicy.Action.REFRESH, policy.decide(captureRunning = true, captureRestorable = true, parked = false, paused = false))
  }
}
