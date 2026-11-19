package expo.modules.openbeacontracking.push

import android.app.Application
import android.content.Context
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import com.google.firebase.messaging.RemoteMessage
import expo.modules.openbeacontracking.TrackingRuntime
import expo.modules.openbeacontracking.capture.LocateWakePolicy
import expo.modules.openbeacontracking.capture.SharingCaptureState
import expo.modules.openbeacontracking.capture.TrackingCaptureService
import expo.modules.openbeacontracking.capture.TrackingUploadService
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

@RunWith(RobolectricTestRunner::class)
class PushWakeServiceTest {
  private val application: Application = ApplicationProvider.getApplicationContext()
  private val service = Robolectric.buildService(PushWakeService::class.java).create().get()

  @Before
  fun setUp() {
    TrackingCaptureService::class.java.getDeclaredField("locateWakes").apply { isAccessible = true }.set(null, LocateWakePolicy { 0L })
    application.getSharedPreferences("openbeacon_tracking_queue", Context.MODE_PRIVATE).edit().putString("owner", "test-owner").putString("deviceId", "tablet").commit()
    TrackingRuntime.setSharingState(application, SharingCaptureState(revisionPrefix = "s0.2:"))
    TrackingRuntime.isCaptureRunning = true
  }

  @After
  fun tearDown() {
    TrackingRuntime.isCaptureRunning = false
  }

  @Test
  fun aSyncWakeOnlySyncs() {
    service.onMessageReceived(wake("sync"))

    assertEquals(listOf(TrackingUploadService.REASON_PUSH), startedServices().map { it.getStringExtra(TrackingUploadService.EXTRA_REASON) })
  }

  @Test
  fun aLocateWakeSyncsAndAsksCaptureForAFix() {
    service.onMessageReceived(wake("locate"))
    val started = startedServices()

    assertEquals(TrackingUploadService.REASON_PUSH, started[0].getStringExtra(TrackingUploadService.EXTRA_REASON))
    assertEquals(TrackingCaptureService.ACTION_REFRESH, started[1].action)
    assertEquals(2, started.size)
  }

  @Test
  fun anUnknownWakeDoesNothing() {
    service.onMessageReceived(wake("other"))

    assertTrue(startedServices().isEmpty())
  }

  private fun wake(type: String) = RemoteMessage.Builder("openbeacon@fcm.googleapis.com").addData("t", type).build()

  private fun startedServices(): List<Intent> = generateSequence { shadowOf(application).nextStartedService }.toList()
}
