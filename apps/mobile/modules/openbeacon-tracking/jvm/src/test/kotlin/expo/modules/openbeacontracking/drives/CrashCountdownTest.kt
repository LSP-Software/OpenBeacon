package expo.modules.openbeacontracking.drives

import kotlin.test.Test
import kotlin.test.assertEquals

class CrashCountdownTest {
  private val suspicion = CrashSuspicion(timeMillis = 1_000_000L, latitude = 51.5, longitude = -0.1, speedBefore = 18.8)
  private val start = 1_020_000L

  @Test
  fun countsDownSixtySecondsThenSendsTheAlert() {
    val countdown = CrashCountdown.start(suspicion, test = false, nowMillis = start)

    assertEquals(60, countdown.secondsLeft(start))
    assertEquals(13, countdown.secondsLeft(start + 47_000))
    assertEquals(CrashCountdownPhase.COUNTING, countdown.tick(start + 59_999).phase)
    assertEquals(CrashCountdownPhase.SENT, countdown.tick(start + 60_000).phase)
    assertEquals(0, countdown.secondsLeft(start + 61_000))
  }

  @Test
  fun imOkBeforeTheEndSendsNothing() {
    val cancelled = CrashCountdown.start(suspicion, test = false, nowMillis = start).tick(start + 20_000).imOk()

    assertEquals(CrashCountdownPhase.CANCELLED, cancelled.phase)
    assertEquals(CrashCountdownPhase.CANCELLED, cancelled.tick(start + 90_000).phase)
    assertEquals(CrashCountdownPhase.CANCELLED, cancelled.sendNow().phase)
  }

  @Test
  fun sendNowSendsStraightAway() {
    val sent = CrashCountdown.start(suspicion, test = false, nowMillis = start).sendNow()

    assertEquals(CrashCountdownPhase.SENT, sent.phase)
    assertEquals(CrashCountdownPhase.SENT, sent.tick(start + 90_000).phase)
  }

  @Test
  fun imOkAfterSendingTellsTheGroupsOnce() {
    val sent = CrashCountdown.start(suspicion, test = false, nowMillis = start).tick(start + 60_000)

    val ok = sent.imOk()
    assertEquals(CrashCountdownPhase.SAID_OK, ok.phase)
    assertEquals(CrashCountdownPhase.SAID_OK, ok.imOk().phase)
    assertEquals(CrashCountdownPhase.SAID_OK, ok.sendNow().phase)
  }

  @Test
  fun tryItRunsTenSecondsAndNeverSends() {
    val test = CrashCountdown.start(suspicion, test = true, nowMillis = start)

    assertEquals(10, test.secondsLeft(start))
    assertEquals(CrashCountdownPhase.COUNTING, test.tick(start + 9_999).phase)
    assertEquals(CrashCountdownPhase.TEST_FINISHED, test.tick(start + 10_000).phase)
    assertEquals(CrashCountdownPhase.TEST_FINISHED, test.sendNow().phase)
    assertEquals(CrashCountdownPhase.CANCELLED, test.imOk().phase)
    assertEquals(CrashCountdownPhase.TEST_FINISHED, test.tick(start + 10_000).imOk().phase)
  }

  @Test
  fun aCountdownThatOutlivedTheAppSendsWhenRestored() {
    val saved = CrashCountdown.start(suspicion, test = false, nowMillis = start)
    val restored = CrashCountdown.restore(saved.save())

    assertEquals(saved, restored)
    assertEquals(CrashCountdownPhase.SENT, restored!!.tick(start + 5 * 60_000).phase)
    assertEquals(null, CrashCountdown.restore("{"))
  }
}
