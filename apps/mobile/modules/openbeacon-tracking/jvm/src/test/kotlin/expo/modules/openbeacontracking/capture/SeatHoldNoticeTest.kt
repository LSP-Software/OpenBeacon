package expo.modules.openbeacontracking.capture

import kotlin.test.Test
import kotlin.test.assertEquals

class SeatHoldNoticeTest {
  private val names = mapOf("family" to "Family", "work" to "Work", "climbing" to "Climbing")

  @Test
  fun noHoldsKeepsTheUsualNotice() {
    assertEquals(SeatHoldNotice.Text.Sharing, SeatHoldNotice(names).text(paused = false, keyGroupIds = listOf("family")))
  }

  @Test
  fun aPauseWinsOverHolds() {
    val notice = SeatHoldNotice(names, heldGroupIds = listOf("work"))
    assertEquals(SeatHoldNotice.Text.Paused, notice.text(paused = true, keyGroupIds = listOf("family", "work")))
    assertEquals(SeatHoldNotice.Text.Paused, SeatHoldNotice(names, listOf("family", "work")).text(paused = true, keyGroupIds = listOf("family", "work")))
  }

  @Test
  fun everyGroupOnHoldSharesNowhere() {
    val notice = SeatHoldNotice(names, heldGroupIds = listOf("family", "work", "climbing"))
    assertEquals(SeatHoldNotice.Text.OnHoldEverywhere, notice.text(paused = false, keyGroupIds = listOf("family", "work", "climbing", "family")))
  }

  @Test
  fun someHoldsNameOnlyTheGroupsStillSharing() {
    val notice = SeatHoldNotice(names, heldGroupIds = listOf("climbing"))
    val text = notice.text(paused = false, keyGroupIds = listOf("work", "family", "climbing"))
    assertEquals(SeatHoldNotice.Text.SomeOnHold(sharing = listOf("Family", "Work"), held = listOf("Climbing")), text)
    assertEquals("Family and Work", SeatHoldNotice.join(listOf("Family", "Work")))
    assertEquals("Family, Work and Climbing", SeatHoldNotice.join(listOf("Family", "Work", "Climbing")))
  }

  @Test
  fun aNewlyJoinedGroupWithKeysNeverReadsAsNobodySeeing() {
    val notice = SeatHoldNotice(mapOf("family" to "Family"), heldGroupIds = listOf("family"))
    assertEquals(SeatHoldNotice.Text.Sharing, notice.text(paused = false, keyGroupIds = listOf("family", "club")))
  }

  @Test
  fun aNewlyJoinedGroupAlongsideNamedOnesFallsBackToTheUsualNotice() {
    val notice = SeatHoldNotice(names, heldGroupIds = listOf("work"))
    assertEquals(SeatHoldNotice.Text.Sharing, notice.text(paused = false, keyGroupIds = listOf("family", "work", "club")))
  }

  @Test
  fun groupsWithoutKeysDontCountAsSharing() {
    val notice = SeatHoldNotice(names, heldGroupIds = listOf("work"))
    assertEquals(SeatHoldNotice.Text.OnHoldEverywhere, notice.text(paused = false, keyGroupIds = listOf("work")))
    assertEquals(
      SeatHoldNotice.Text.SomeOnHold(sharing = listOf("Family"), held = listOf("Work")),
      notice.text(paused = false, keyGroupIds = listOf("family", "work")),
    )
  }

  @Test
  fun storedHoldsReadBack() {
    val notice = SeatHoldNotice(groupNames = mapOf("family" to "Family", "work" to "Work"), heldGroupIds = listOf("work"))
    assertEquals(notice, SeatHoldNotice.parse(notice.toJson()))
  }

  @Test
  fun corruptStoredHoldsFallBackToNoHolds() {
    assertEquals(SeatHoldNotice(), SeatHoldNotice.parse("not json"))
    assertEquals(SeatHoldNotice(), SeatHoldNotice.parse("""{"groupNames":{"family":"Family"}}"""))
    assertEquals(SeatHoldNotice(), SeatHoldNotice.parse("""{"groupNames":[],"heldGroupIds":[]}"""))
    assertEquals(SeatHoldNotice(), SeatHoldNotice.parse("""{"sharing":["Family"],"held":["Work"],"heldGroupIds":["work"]}"""))
  }
}
