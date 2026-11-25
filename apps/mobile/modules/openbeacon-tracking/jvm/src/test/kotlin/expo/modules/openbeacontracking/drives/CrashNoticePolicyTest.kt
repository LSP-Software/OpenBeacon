package expo.modules.openbeacontracking.drives

import kotlin.test.Test
import kotlin.test.assertEquals

class CrashNoticePolicyTest {
  private val suspicion = CrashSuspicion(timeMillis = 1_000L, latitude = 51.5, longitude = -0.1, speedBefore = 15.0)
  private val counting = CrashCountdown.start(suspicion, test = false, nowMillis = 1_000L)
  private val testCounting = CrashCountdown.start(suspicion, test = true, nowMillis = 1_000L)
  private val sent = counting.sendNow()

  @Test
  fun aRealCountdownAlarmsOnlyWhileItsScreenIsNotShowing() {
    assertEquals(CrashNotice.COUNTDOWN_ALARM, CrashNoticePolicy.of(counting, screenVisible = false, alertQueued = false, anyDelivered = false))
    assertEquals(CrashNotice.COUNTDOWN_QUIET, CrashNoticePolicy.of(counting, screenVisible = true, alertQueued = false, anyDelivered = false))
  }

  @Test
  fun tryItNeverPutsAHeadsUpOverItsOwnScreen() {
    assertEquals(CrashNotice.COUNTDOWN_QUIET, CrashNoticePolicy.of(testCounting, screenVisible = false, alertQueued = false, anyDelivered = false))
  }

  @Test
  fun afterTheTimerRunsOutANoticeStaysSoThePersonCanStillSayTheyAreOk() {
    assertEquals(CrashNotice.NOT_SENT, CrashNoticePolicy.of(sent, screenVisible = false, alertQueued = true, anyDelivered = false))
    assertEquals(CrashNotice.SENT, CrashNoticePolicy.of(sent, screenVisible = true, alertQueued = true, anyDelivered = true))
  }

  @Test
  fun nothingIsLeftWhenNoAlertWasQueuedOrTheCountdownIsOver() {
    assertEquals(CrashNotice.NONE, CrashNoticePolicy.of(sent, screenVisible = false, alertQueued = false, anyDelivered = false))
    assertEquals(CrashNotice.NONE, CrashNoticePolicy.of(counting.imOk(), screenVisible = false, alertQueued = false, anyDelivered = false))
    assertEquals(CrashNotice.NONE, CrashNoticePolicy.of(null, screenVisible = false, alertQueued = false, anyDelivered = false))
  }
}
