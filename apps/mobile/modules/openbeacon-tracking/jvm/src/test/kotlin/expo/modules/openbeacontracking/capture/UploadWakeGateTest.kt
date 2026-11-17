package expo.modules.openbeacontracking.capture

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class UploadWakeGateTest {
  private var now = 1_000_000L
  private val gate = UploadWakeGate { now }

  @Test
  fun aPushOnAnIdlePhoneStartsAnUpload() {
    assertTrue(gate.accept(push = true))
  }

  @Test
  fun aPushWhileAnUploadRunsDoesntStartASecondOne() {
    assertTrue(gate.accept(push = false))
    gate.started(1)
    assertFalse(gate.accept(push = true))
    assertFalse(gate.accept(push = true))
  }

  @Test
  fun aPushWhileAnUploadIsStillStartingIsHeldBack() {
    assertTrue(gate.accept(push = true))
    assertFalse(gate.accept(push = true))
  }

  @Test
  fun heldBackPushesRunOnceAfterTheUploadFinishes() {
    gate.accept(push = false)
    gate.started(1)
    gate.accept(push = true)
    gate.accept(push = true)
    assertTrue(gate.finished(1))
    assertTrue(gate.accept(push = true))
    gate.started(2)
    assertFalse(gate.finished(2))
  }

  @Test
  fun aFollowUpWaitsForEveryRunningUpload() {
    gate.accept(push = false)
    gate.started(1)
    gate.accept(push = false)
    gate.started(2)
    gate.accept(push = true)
    assertFalse(gate.finished(1))
    assertTrue(gate.finished(2))
  }

  @Test
  fun anUploadWithPointsStillStartsWhileAPushRuns() {
    gate.accept(push = true)
    gate.started(1)
    assertTrue(gate.accept(push = false))
  }

  @Test
  fun anUploadStartedElsewhereCountsAsRunning() {
    gate.started(7)
    assertFalse(gate.accept(push = true))
    assertTrue(gate.finished(7))
  }

  @Test
  fun noFollowUpWithoutAHeldBackPush() {
    gate.accept(push = false)
    gate.started(1)
    assertFalse(gate.finished(1))
  }

  @Test
  fun stoppingTheServiceReleasesAHeldBackPush() {
    gate.accept(push = true)
    gate.accept(push = true)
    assertTrue(gate.stopped())
    assertTrue(gate.accept(push = true))
  }

  @Test
  fun anUploadThatNeverStartsStopsHoldingBackPushes() {
    assertTrue(gate.accept(push = false))
    now += UploadWakeGate.START_TIMEOUT_MS - 1
    assertFalse(gate.accept(push = true))
    now += 1
    assertTrue(gate.accept(push = true))
  }

  @Test
  fun aLateStartStillCountsAsRunning() {
    assertTrue(gate.accept(push = false))
    now += UploadWakeGate.START_TIMEOUT_MS
    gate.started(1)
    assertFalse(gate.accept(push = true))
    assertTrue(gate.finished(1))
  }
}
