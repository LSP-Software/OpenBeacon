package expo.modules.openbeacontracking.crash

import android.Manifest
import android.app.Application
import android.app.NotificationManager
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

@RunWith(RobolectricTestRunner::class)
class CrashAlertNoticesTest {
  private val application: Application = ApplicationProvider.getApplicationContext()
  private val manager = application.getSystemService(NotificationManager::class.java)

  @Before
  fun setUp() {
    shadowOf(application).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
  }

  @Test
  fun crashAlertsAndTheirFollowUpsAreNeverBundledWithOtherNotices() {
    CrashAlertNotices.show(application, ok = false, key = "alert", title = "Sam: possible crash", body = "At 18:04", link = "openbeacon:///map?crashUserId=sam")
    CrashAlertNotices.show(application, ok = true, key = "ok", title = "Sam says they're OK", body = "After 18:04", link = "openbeacon:///map?crashUserId=sam")

    val groups = shadowOf(manager).allNotifications.map { it.group }
    assertEquals(2, groups.size)
    groups.forEach { assertNotNull(it) }
    assertEquals(1, groups.distinct().size)
  }
}
