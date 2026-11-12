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

    assertFalse(Notices.show(application, "signedOut"))
    assertTrue(shadowOf(manager).allNotifications.isEmpty())
  }

  @Test
  fun aNewerNoticeInTheSameSlotReplacesTheOlderOne() {
    Notices.show(application, "deviceRemoved")
    Notices.show(application, "signedOut")

    assertEquals(listOf(application.getString(R.string.openbeacon_notice_signed_out_body)), texts())
  }

  @Test
  fun tappingTheLocationNoticeOpensTheAccountScreen() {
    Notices.show(application, Notices.LOCATION_PERMISSION)
    val tap = shadowOf(shadowOf(manager).allNotifications.single().contentIntent).savedIntent

    assertEquals(Uri.parse("openbeacon:///account/overview"), tap.data)
    assertEquals(application.packageName, tap.`package`)
  }

  @Test
  fun dismissingASlotRemovesItsNotice() {
    Notices.show(application, "appTooOld")
    Notices.dismiss(application, Notices.SLOT_COMPATIBILITY)

    assertTrue(texts().isEmpty())
  }

  @Test
  fun theOldCompatibilityChannelIsRemoved() {
    manager.createNotificationChannel(NotificationChannel("openbeacon_app_compatibility", "App and server updates", NotificationManager.IMPORTANCE_DEFAULT))
    Notices.show(application, "outOfSync")

    assertNull(manager.getNotificationChannel("openbeacon_app_compatibility"))
    assertEquals(NotificationManager.IMPORTANCE_HIGH, manager.getNotificationChannel("openbeacon_sharing_alerts").importance)
  }

  private fun texts() =
    shadowOf(manager).allNotifications.map { it.extras.getCharSequence(Notification.EXTRA_TEXT).toString() }
}
