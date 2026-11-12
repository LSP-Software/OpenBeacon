package expo.modules.openbeacontracking.capture

import android.Manifest
import android.app.Application
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import expo.modules.openbeacontracking.TrackingRuntime
import expo.modules.openbeacontracking.keys.InMemoryEpochKeyStore
import expo.modules.openbeacontracking.keys.ProvisionedEpochKey
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ServiceController

@RunWith(RobolectricTestRunner::class)
class TrackingCaptureServiceTest {
  private val application: Application = ApplicationProvider.getApplicationContext()
  private var controller: ServiceController<TrackingCaptureService>? = null
  private val keysField = TrackingRuntime::class.java.getDeclaredField("epochKeyStore").apply { isAccessible = true }

  @Before
  fun setUp() {
    WorkManagerTestInitHelper.initializeTestWorkManager(application, Configuration.Builder().setExecutor(SynchronousExecutor()).build())
    TrackingRuntime.isCaptureRunning = false
    TrackingRuntime.captureCommands.stop()
    application.getSharedPreferences("openbeacon_tracking_queue", Context.MODE_PRIVATE).edit().putString("owner", "test-owner").putString("deviceId", "tablet").commit()
    TrackingRuntime.setCaptureEnabled(application, true)
    TrackingRuntime.setSharingState(application, SharingCaptureState(revisionPrefix = "s0.1:", paused = true, pausedUntil = System.currentTimeMillis() + 3_600_000L))
    val keys = InMemoryEpochKeyStore()
    keys.replaceAll(listOf(ProvisionedEpochKey("group", "epoch", ByteArray(32), "tablet", "trackingPoint")))
    keysField.set(null, keys)
    shadowOf(application).grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_BACKGROUND_LOCATION, Manifest.permission.POST_NOTIFICATIONS)
  }

  @After
  fun tearDown() {
    controller?.destroy()
    TrackingRuntime.isCaptureRunning = false
    TrackingRuntime.setCaptureEnabled(application, false)
    keysField.set(null, null)
  }

  @Test
  fun reregisteringThePhoneDoesNotInheritTheOldDevicesSharingRevision() {
    TrackingRuntime.setSharingState(application, SharingCaptureState(revisionPrefix = "s0.9:", paused = true))
    TrackingRuntime.setQueueOwner(application, "test-owner", "new-phone")

    assertEquals("test-owner", TrackingRuntime.queueOwner(application))
    assertEquals("new-phone", TrackingRuntime.queueDeviceId(application))
    assertTrue(TrackingRuntime.applySharingState(application, "test-owner", "new-phone", SharingCaptureState()))
    assertFalse(TrackingRuntime.sharingState(application).paused)
    assertFalse(TrackingRuntime.applySharingState(application, "test-owner", "tablet", SharingCaptureState(revisionPrefix = "s0.10:", paused = true)))
    assertFalse(TrackingRuntime.sharingState(application).paused)
  }

  @Test
  fun bindingAnExistingQueueToItsDeviceKeepsCaptureAndKeysAvailable() {
    application.getSharedPreferences("openbeacon_tracking_queue", Context.MODE_PRIVATE).edit().remove("deviceId").commit()
    TrackingRuntime.isCaptureRunning = true
    TrackingRuntime.setQueueOwner(application, "test-owner", "tablet")

    assertTrue(TrackingRuntime.isCaptureRunning)
    assertTrue(TrackingRuntime.isCaptureEnabled(application))
    assertEquals(1, TrackingRuntime.epochKeyStore(application).list().size)
    assertEquals("tablet", TrackingRuntime.queueDeviceId(application))
  }

  @Test
  fun rejectedSharingUpdatesReportFailureAndPreserveTheCurrentPause() {
    TrackingRuntime.setSharingState(application, SharingCaptureState(revisionPrefix = "s1.2:", paused = true))
    assertFalse(TrackingRuntime.applySharingState(application, "other-owner", "tablet", SharingCaptureState()))
    assertFalse(TrackingRuntime.applySharingState(application, "test-owner", "other-device", SharingCaptureState()))
    assertFalse(TrackingRuntime.applySharingState(application, "test-owner", "tablet", SharingCaptureState(revisionPrefix = "s1.1:")))
    assertTrue(TrackingRuntime.sharingState(application).paused)
    assertTrue(TrackingRuntime.applySharingState(application, "test-owner", "tablet", SharingCaptureState(revisionPrefix = "s1.2:", paused = true)))
  }

  @Test
  fun alarmRestoresThePersistedPauseAfterTheProcessRestarts() {
    val service = createService()
    val result = service.onStartCommand(Intent(application, TrackingCaptureService::class.java).apply {
      action = TrackingCaptureService.ACTION_CHECK_SHARING
    }, 0, 1)

    assertEquals(Service.START_STICKY, result)
    assertTrue(TrackingRuntime.isCaptureRunning)
    assertTrue(TrackingRuntime.sharingState(application).isPaused(System.currentTimeMillis()))
    assertNotNull(shadowOf(application).nextStartedService)
    assertNotNull(shadowOf(service).lastForegroundNotification)
  }

  @Test
  fun sharingChangesRestoreThePersistedPauseAfterTheProcessRestarts() {
    val service = createService()
    val result = service.onStartCommand(Intent(application, TrackingCaptureService::class.java).apply {
      action = TrackingCaptureService.ACTION_SHARING_CHANGED
    }, 0, 1)

    assertEquals(Service.START_STICKY, result)
    assertTrue(TrackingRuntime.isCaptureRunning)
    assertNotNull(shadowOf(service).lastForegroundNotification)
  }

  @Test
  fun aLateAlarmCannotRestoreCaptureAfterSignOut() {
    TrackingRuntime.setCaptureEnabled(application, false)
    val service = createService()
    val result = service.onStartCommand(Intent(application, TrackingCaptureService::class.java).apply {
      action = TrackingCaptureService.ACTION_CHECK_SHARING
    }, 0, 1)

    assertEquals(Service.START_NOT_STICKY, result)
    assertFalse(TrackingRuntime.isCaptureRunning)
  }

  @Test
  fun aStickyRestartCannotRestoreCaptureAfterSignOut() {
    TrackingRuntime.setCaptureEnabled(application, false)
    val service = createService()
    assertEquals(Service.START_NOT_STICKY, service.onStartCommand(null, 0, 1))
    assertFalse(TrackingRuntime.isCaptureRunning)
  }

  @Test
  fun restoredCaptureNeedsItsKeysAndPermissions() {
    keysField.set(null, InMemoryEpochKeyStore())
    assertFalse(TrackingRuntime.shouldRestoreCapture(application))
    setUp()
    shadowOf(application).denyPermissions(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
    assertFalse(TrackingRuntime.shouldRestoreCapture(application))
  }

  @Test
  fun anExpiredPauseRequestsAFreshFixImmediately() {
    val now = System.currentTimeMillis()
    TrackingRuntime.setSharingState(application, SharingCaptureState(revisionPrefix = "s0.1:", paused = true, pausedUntil = now - 1L, resumeAfter = now - 1L))
    val service = createService()
    service.onStartCommand(Intent(application, TrackingCaptureService::class.java).apply {
      action = TrackingCaptureService.ACTION_CHECK_SHARING
    }, 0, 1)
    val refresh = TrackingCaptureService::class.java.getDeclaredField("refreshState").apply { isAccessible = true }.get(service) as CaptureRefreshState

    assertTrue(TrackingRuntime.isCaptureRunning)
    assertNotNull(refresh.pending())
  }

  @Test
  fun aStartRequestedBeforeASharingChangeStillStartsCapture() {
    val generation = TrackingRuntime.captureCommands.start()
    assertTrue(TrackingRuntime.applySharingState(application, "test-owner", "tablet", SharingCaptureState(revisionPrefix = "s0.2:")))
    val service = createService()
    val result = service.onStartCommand(startIntent(generation), 0, 1)

    assertEquals(Service.START_STICKY, result)
    assertTrue(TrackingRuntime.isCaptureRunning)
  }

  @Test
  fun aStartRequestedBeforeStopIsIgnored() {
    val generation = TrackingRuntime.captureCommands.start()
    TrackingRuntime.captureCommands.stop()
    TrackingRuntime.setCaptureEnabled(application, false)
    val service = createService()

    assertEquals(Service.START_NOT_STICKY, service.onStartCommand(startIntent(generation), 0, 1))
    assertFalse(TrackingRuntime.isCaptureRunning)
  }

  @Test
  fun aRefreshWhilePausedAndStoppedDoesNotKeepTheServiceAlive() {
    val service = createService()
    val result = service.onStartCommand(Intent(application, TrackingCaptureService::class.java).apply {
      action = TrackingCaptureService.ACTION_REFRESH
    }, 0, 1)

    assertEquals(Service.START_NOT_STICKY, result)
    assertFalse(TrackingRuntime.isCaptureRunning)
  }

  @Test
  fun aTimedPauseSaysWhenSharingStartsAgain() {
    val service = createService()
    service.onStartCommand(Intent(application, TrackingCaptureService::class.java).apply {
      action = TrackingCaptureService.ACTION_CHECK_SHARING
    }, 0, 1)
    val notification = shadowOf(service).lastForegroundNotification

    assertEquals(
      application.getString(expo.modules.openbeacontracking.R.string.openbeacon_tracking_notification_paused_title),
      notification.extras.getCharSequence(android.app.Notification.EXTRA_TITLE).toString(),
    )
    assertTrue(notification.extras.getCharSequence(android.app.Notification.EXTRA_TEXT).toString().startsWith("Sharing starts again at "))
  }

  @Test
  fun aPauseWithoutAnEndSaysGroupsCantSeeThePhone() {
    TrackingRuntime.setSharingState(application, SharingCaptureState(paused = true))
    val service = createService()
    service.onStartCommand(startIntent(TrackingRuntime.captureCommands.start()), 0, 1)

    assertEquals(
      application.getString(expo.modules.openbeacontracking.R.string.openbeacon_tracking_notification_paused_body),
      shadowOf(service).lastForegroundNotification.extras.getCharSequence(android.app.Notification.EXTRA_TEXT).toString(),
    )
  }

  @Test
  fun sharingShowsTheBrandedStatusNotification() {
    TrackingRuntime.setSharingState(application, SharingCaptureState(revisionPrefix = "s0.2:"))
    val service = createService()
    service.onStartCommand(startIntent(TrackingRuntime.captureCommands.start()), 0, 1)
    val notification = shadowOf(service).lastForegroundNotification

    assertEquals(
      application.getString(expo.modules.openbeacontracking.R.string.openbeacon_tracking_notification_title),
      notification.extras.getCharSequence(android.app.Notification.EXTRA_TITLE).toString(),
    )
    assertEquals(expo.modules.openbeacontracking.R.drawable.openbeacon_notification_icon, notification.smallIcon.resId)
  }

  @Test
  fun aStickyRestartAfterLocationAccessIsRemovedAsksJsToTellTheOwner() {
    shadowOf(application).denyPermissions(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
    val service = createService()

    assertEquals(Service.START_NOT_STICKY, service.onStartCommand(null, 0, 1))
    assertFalse(TrackingRuntime.isCaptureRunning)
    assertTrue(hasNotice(expo.modules.openbeacontracking.R.string.openbeacon_notice_location_permission_body))
  }

  @Test
  fun aStickyRestartAfterSharingWasTurnedOffSaysNothing() {
    TrackingRuntime.setCaptureEnabled(application, false)
    shadowOf(application).denyPermissions(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
    val service = createService()

    assertEquals(Service.START_NOT_STICKY, service.onStartCommand(null, 0, 1))
    assertFalse(hasNotice(expo.modules.openbeacontracking.R.string.openbeacon_notice_location_permission_body))
  }

  private fun hasNotice(body: Int) =
    shadowOf(application.getSystemService(NotificationManager::class.java)).allNotifications.any {
      it.extras.getCharSequence(android.app.Notification.EXTRA_TEXT)?.toString() == application.getString(body)
    }

  private fun startIntent(generation: Long) =
    Intent(application, TrackingCaptureService::class.java).apply {
      action = TrackingCaptureService.ACTION_START
      putExtra(TrackingCaptureService.EXTRA_COMMAND_GENERATION, generation)
    }

  private fun createService(): TrackingCaptureService {
    val created = Robolectric.buildService(TrackingCaptureService::class.java).create()
    controller = created
    return created.get()
  }
}
