package expo.modules.openbeacontracking.capture

import android.app.Application
import android.content.ComponentName
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class TrackingBootReceiverTest {
  private val application: Application = ApplicationProvider.getApplicationContext()

  @Test
  fun otherAppsCannotCallTheBootReceiver() {
    val receiver = application.packageManager.getReceiverInfo(ComponentName(application, TrackingBootReceiver::class.java), 0)

    assertFalse(receiver.exported)
  }

  @Test
  fun theBootReceiverStillListensForRebootsAndUpdates() {
    val actions =
      listOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED).map { action ->
        application.packageManager.queryBroadcastReceivers(Intent(action).setPackage(application.packageName), 0).map { it.activityInfo.name }
      }

    assertEquals(listOf(listOf(TrackingBootReceiver::class.java.name), listOf(TrackingBootReceiver::class.java.name)), actions)
  }
}
