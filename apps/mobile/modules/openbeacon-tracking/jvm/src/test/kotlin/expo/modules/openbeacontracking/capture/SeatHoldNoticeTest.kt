package expo.modules.openbeacontracking.capture

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SeatHoldNoticeTest {
  @Test
  fun noHoldsKeepsTheUsualNotice() {
    val notice = SeatHoldNotice(sharing = listOf("Family"))
    assertFalse(notice.sharesNowhere)
    assertFalse(notice.sharesSomewhere)
  }

  @Test
  fun someHoldsNameOnlyTheGroupsStillSharing() {
    val notice = SeatHoldNotice(sharing = listOf("Family", "Work"), held = listOf("Climbing"))
    assertTrue(notice.sharesSomewhere)
    assertEquals("Family and Work", SeatHoldNotice.join(notice.sharing))
  }

  @Test
  fun everyGroupOnHoldSharesNowhere() {
    val notice = SeatHoldNotice(held = listOf("Family", "Work", "Climbing"))
    assertTrue(notice.sharesNowhere)
    assertEquals("Family, Work and Climbing", SeatHoldNotice.join(notice.held))
  }
}
