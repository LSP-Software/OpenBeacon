package expo.modules.openbeacontracking

import android.Manifest
import android.app.Application
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

@RunWith(RobolectricTestRunner::class)
class NoticesTest {
  private val application: Application = ApplicationProvider.getApplicationContext()
  private val manager = application.getSystemService(NotificationManager::class.java)

  @Before
  fun setUp() {
    shadowOf(application).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
  }

  @Test
  fun nothingIsPostedWithoutNotificationPermission() {
    shadowOf(application).denyPermissions(Manifest.permission.POST_NOTIFICATIONS)

    assertFalse(Notices.show(application, Notice.SIGNED_OUT))
    assertTrue(shadowOf(manager).allNotifications.isEmpty())
  }

  @Test
  fun aNewerNoticeInTheSameSlotReplacesTheOlderOne() {
    Notices.show(application, Notice.DEVICE_REMOVED)
    Notices.show(application, Notice.SIGNED_OUT)

    assertEquals(listOf(application.getString(R.string.openbeacon_notice_signed_out_body)), texts())
  }

  @Test
  fun tappingTheLocationNoticeOpensTheAccountScreen() {
    Notices.show(application, Notice.LOCATION_PERMISSION)
    val tap = shadowOf(shadowOf(manager).allNotifications.single().contentIntent).savedIntent

    assertEquals(Uri.parse("openbeacon:///account/overview"), tap.data)
    assertEquals(application.packageName, tap.`package`)
  }

  @Test
  fun dismissingASlotRemovesItsNotice() {
    Notices.show(application, Notice.APP_TOO_OLD)
    Notices.dismiss(application, NoticeSlot.COMPATIBILITY)

    assertTrue(texts().isEmpty())
  }

  @Test
  fun theOldCompatibilityChannelIsRemoved() {
    manager.createNotificationChannel(NotificationChannel("openbeacon_app_compatibility", "App and server updates", NotificationManager.IMPORTANCE_DEFAULT))
    Notices.removeOldChannels(application)

    assertNull(manager.getNotificationChannel("openbeacon_app_compatibility"))
  }

  @Test
  fun aBlockedAlertsChannelCountsAsDisabled() {
    manager.createNotificationChannel(NotificationChannel("openbeacon_sharing_alerts", "Sharing alerts", NotificationManager.IMPORTANCE_NONE))

    assertFalse(Notices.areEnabled(application))
    assertFalse(Notices.show(application, Notice.OUT_OF_SYNC))
    assertTrue(shadowOf(manager).allNotifications.isEmpty())
  }

  @Test
  fun alertsAreEnabledBeforeTheChannelExists() {
    assertTrue(Notices.areEnabled(application))
  }

  @Test
  fun aSwipedLocationNoticeIsNotPostedAgainUntilItIsDismissed() {
    Notices.show(application, Notice.LOCATION_PERMISSION)
    manager.cancelAll()
    Notices.show(application, Notice.LOCATION_PERMISSION)

    assertTrue(texts().isEmpty())

    Notices.dismiss(application, NoticeSlot.LOCATION_PERMISSION)
    Notices.show(application, Notice.LOCATION_PERMISSION)

    assertEquals(listOf(application.getString(R.string.openbeacon_notice_location_permission_body)), texts())
  }

  @Test
  fun bridgeKindsAndSlotsResolveToTheirNotices() {
    assertEquals(Notice.SELF_HOSTED_SERVER_TOO_OLD, Notice.of("selfHostedServerTooOld"))
    assertEquals(NoticeSlot.SIGNED_OUT, NoticeSlot.of("signedOut"))
  }

  private fun texts() =
    shadowOf(manager).allNotifications.map { it.extras.getCharSequence(Notification.EXTRA_TEXT).toString() }
}
