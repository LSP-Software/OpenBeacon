package expo.modules.openbeacontracking.capture

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class UploadWakeGateTest {
  private var now = 1_000_000L
  private val gate = UploadWakeGate { now }

  @Test
  fun aPushOnAnIdlePhoneStartsAnUpload() {
    assertNotNull(gate.accept(push = true))
  }

  @Test
  fun aPushWhileAnUploadRunsDoesntStartASecondOne() {
    assertNotNull(gate.accept(push = false))
    gate.started(1)
    assertNull(gate.accept(push = true))
    assertNull(gate.accept(push = true))
  }

  @Test
  fun aPushWhileAnUploadIsStillStartingIsHeldBack() {
    assertNotNull(gate.accept(push = true))
    assertNull(gate.accept(push = true))
  }

  @Test
  fun heldBackPushesRunOnceAfterTheUploadFinishes() {
    gate.accept(push = false)
    gate.started(1)
    gate.accept(push = true)
    gate.accept(push = true)
    assertTrue(gate.finished(1))
    assertNotNull(gate.accept(push = true))
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
    assertNotNull(gate.accept(push = false))
  }

  @Test
  fun anUploadStartedElsewhereCountsAsRunning() {
    gate.started(7)
    assertNull(gate.accept(push = true))
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
    assertNotNull(gate.accept(push = true))
  }

  @Test
  fun anUploadThatNeverStartsStopsHoldingBackPushes() {
    assertNotNull(gate.accept(push = false))
    now += UploadWakeGate.START_TIMEOUT_MS - 1
    assertNull(gate.accept(push = true))
    now += 1
    assertNotNull(gate.accept(push = true))
  }

  @Test
  fun aLateStartStillCountsAsRunning() {
    assertNotNull(gate.accept(push = false))
    now += UploadWakeGate.START_TIMEOUT_MS
    gate.started(1)
    assertNull(gate.accept(push = true))
    assertTrue(gate.finished(1))
  }

  @Test
  fun eachUploadIsMatchedToItsOwnTaskInStartOrder() {
    val first = assertNotNull(gate.accept(push = false))
    val second = assertNotNull(gate.accept(push = false))
    assertNotEquals(first, second)
    assertEquals(first, gate.started(4))
    assertEquals(second, gate.started(5))
  }

  @Test
  fun replayedStartsDontTakeAnotherUploadsToken() {
    val first = assertNotNull(gate.accept(push = false))
    assertEquals(first, gate.started(1))
    val second = assertNotNull(gate.accept(push = false))
    assertNull(gate.started(1))
    assertEquals(second, gate.started(2))
  }

  @Test
  fun uploadsCanFinishInAnyOrder() {
    gate.accept(push = false)
    gate.accept(push = false)
    gate.started(1)
    gate.started(2)
    gate.accept(push = true)
    assertFalse(gate.finished(2))
    assertTrue(gate.finished(1))
  }

  @Test
  fun aHeldBackPushGetsNoTokenAndTakesNoTask() {
    val upload = assertNotNull(gate.accept(push = false))
    assertNull(gate.accept(push = true))
    assertEquals(upload, gate.started(1))
    assertTrue(gate.finished(1))
    val followUp = assertNotNull(gate.accept(push = true))
    assertEquals(followUp, gate.started(2))
  }

  @Test
  fun anUploadThatNeverStartsDoesntShiftLaterTokens() {
    assertNotNull(gate.accept(push = false))
    now += UploadWakeGate.START_TIMEOUT_MS
    val next = assertNotNull(gate.accept(push = false))
    assertEquals(next, gate.started(1))
  }

  @Test
  fun aLateStartDoesntTakeANewerUploadsToken() {
    assertNotNull(gate.accept(push = false))
    now += UploadWakeGate.START_TIMEOUT_MS
    assertNull(gate.started(1))
    val next = assertNotNull(gate.accept(push = false))
    assertEquals(next, gate.started(2))
  }

  @Test
  fun stoppingTheServiceForgetsEveryToken() {
    gate.accept(push = false)
    gate.started(1)
    gate.accept(push = false)
    gate.stopped()
    assertNull(gate.started(2))
  }
}
