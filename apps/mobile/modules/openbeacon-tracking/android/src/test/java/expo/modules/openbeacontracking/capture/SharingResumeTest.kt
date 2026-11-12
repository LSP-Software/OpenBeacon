package expo.modules.openbeacontracking.capture

import android.Manifest
import android.app.Application
import android.app.NotificationManager
import android.app.Service
import android.content.ComponentName
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.testing.WorkManagerTestInitHelper
import expo.modules.openbeacontracking.TrackingRuntime
import expo.modules.openbeacontracking.keys.InMemoryEpochKeyStore
import expo.modules.openbeacontracking.keys.ProvisionedEpochKey
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ServiceController

@RunWith(RobolectricTestRunner::class)
class SharingResumeTest {
  private val application: Application = ApplicationProvider.getApplicationContext()
  private var controller: ServiceController<TrackingCaptureService>? = null
  private val keysField = TrackingRuntime::class.java.getDeclaredField("epochKeyStore").apply { isAccessible = true }
  private val indefinitePause = SharingCaptureState(revisionPrefix = "s0.2:", paused = true)

  @Before
  fun setUp() {
    WorkManagerTestInitHelper.initializeTestWorkManager(application, Configuration.Builder().setExecutor(SynchronousExecutor()).build())
    TrackingRuntime.isCaptureRunning = false
    TrackingRuntime.captureCommands.stop()
    application.getSharedPreferences("openbeacon_tracking_queue", Context.MODE_PRIVATE).edit().putString("owner", "test-owner").putString("deviceId", "tablet").commit()
    TrackingRuntime.setCaptureEnabled(application, true)
    TrackingRuntime.setSharingState(application, SharingCaptureState(revisionPrefix = "s0.1:"))
    val keys = InMemoryEpochKeyStore()
    keys.replaceAll(listOf(ProvisionedEpochKey("group", "epoch", ByteArray(32), "tablet", "trackingPoint")))
    keysField.set(null, keys)
    shadowOf(application).grantPermissions(
      Manifest.permission.ACCESS_FINE_LOCATION,
      Manifest.permission.ACCESS_BACKGROUND_LOCATION,
      Manifest.permission.POST_NOTIFICATIONS,
    )
  }

  @After
  fun tearDown() {
    controller?.destroy()
    TrackingRuntime.isCaptureRunning = false
    TrackingRuntime.setCaptureEnabled(application, false)
    keysField.set(null, null)
  }

  @Test
  fun anIndefinitePauseStopsTheForegroundServiceAndSchedulesARemoteCheck() {
    val service = startRunningService()
    assertTrue(TrackingRuntime.applySharingState(application, "test-owner", "tablet", indefinitePause))
    val result = service.onStartCommand(action(TrackingCaptureService.ACTION_SHARING_CHANGED), 0, 2)

    assertEquals(Service.START_NOT_STICKY, result)
    assertFalse(TrackingRuntime.isCaptureRunning)
    assertTrue(TrackingRuntime.isCaptureParked(application))
    assertTrue(shadowOf(service).isForegroundStopped)
    assertTrue(shadowOf(service).isStoppedBySelf)
    assertEquals(WorkInfo.State.ENQUEUED, checkState())
  }

  @Test
  fun aTimedPauseKeepsTheForegroundServiceRunningWithoutARemoteCheck() {
    val service = startRunningService()
    val timed = SharingCaptureState(revisionPrefix = "s0.2:", paused = true, pausedUntil = System.currentTimeMillis() + 3_600_000L)
    assertTrue(TrackingRuntime.applySharingState(application, "test-owner", "tablet", timed))
    val result = service.onStartCommand(action(TrackingCaptureService.ACTION_SHARING_CHANGED), 0, 2)

    assertEquals(Service.START_STICKY, result)
    assertTrue(TrackingRuntime.isCaptureRunning)
    assertFalse(TrackingRuntime.isCaptureParked(application))
    assertNotNull(shadowOf(service).lastForegroundNotification)
    assertNull(checkState())
  }

  @Test
  fun anUnconfirmedLocalPauseKeepsTheServiceRunningUntilTheServerConfirmsIt() {
    val service = startRunningService()
    assertTrue(TrackingRuntime.applySharingState(application, "test-owner", "tablet", SharingCaptureState(paused = true)))
    service.onStartCommand(action(TrackingCaptureService.ACTION_SHARING_CHANGED), 0, 2)

    assertTrue(TrackingRuntime.isCaptureRunning)
    assertNull(checkState())
  }

  @Test
  fun aStickyRestartDuringAnIndefinitePauseParksInsteadOfRunning() {
    TrackingRuntime.setSharingState(application, indefinitePause)
    val service = createService()

    assertEquals(Service.START_NOT_STICKY, service.onStartCommand(null, 0, 1))
    assertFalse(TrackingRuntime.isCaptureRunning)
    assertNull(shadowOf(service).lastForegroundNotification)
    assertFalse(shadowOf(service).isForegroundStopped)
    assertTrue(shadowOf(service).isStoppedBySelf)
    assertEquals(WorkInfo.State.ENQUEUED, checkState())
  }

  @Test
  fun lateSharingCommandsDuringAnIndefinitePauseParkWithoutPromotingCapture() {
    TrackingRuntime.setSharingState(application, indefinitePause)
    for (name in listOf(TrackingCaptureService.ACTION_SHARING_CHANGED, TrackingCaptureService.ACTION_CHECK_SHARING)) {
      WorkManager.getInstance(application).cancelUniqueWork(SharingResumeWorker.WORK_NAME)
      val service = createService()

      assertEquals(Service.START_NOT_STICKY, service.onStartCommand(action(name), 0, 1))
      assertFalse(TrackingRuntime.isCaptureRunning)
      assertNull(shadowOf(service).lastForegroundNotification)
      assertFalse(shadowOf(service).isForegroundStopped)
      assertTrue(shadowOf(service).isStoppedBySelf)
      assertEquals(WorkInfo.State.ENQUEUED, checkState())
    }
  }

  @Test
  fun aForegroundStartDuringAnIndefinitePausePromotesBeforeParking() {
    TrackingRuntime.setSharingState(application, indefinitePause)
    val service = createService()

    assertEquals(Service.START_NOT_STICKY, service.onStartCommand(Intent(application, TrackingCaptureService::class.java), 0, 1))
    assertFalse(TrackingRuntime.isCaptureRunning)
    assertNotEquals(0, shadowOf(service).lastForegroundNotificationId)
    assertTrue(shadowOf(service).isForegroundStopped)
    assertTrue(shadowOf(service).isStoppedBySelf)
    assertEquals(WorkInfo.State.ENQUEUED, checkState())
  }

  @Test
  fun theCheckKeepsWaitingWhileThePauseIsUnchanged() {
    park()
    runWorker()

    assertNull(shadowOf(application).nextStartedService)
    assertEquals(WorkInfo.State.ENQUEUED, checkState())
  }

  @Test
  fun aRemoteResumeRestartsCaptureAndEndsTheCheck() {
    park()
    assertTrue(TrackingRuntime.applySharingState(application, "test-owner", "tablet", SharingCaptureState(revisionPrefix = "s0.3:")))
    runWorker()

    assertEquals(ComponentName(application, TrackingCaptureService::class.java), shadowOf(application).nextStartedService.component)
    assertNull(notice())
    assertEquals(WorkInfo.State.ENQUEUED, checkState())
    val service = createService()
    service.onStartCommand(null, 0, 1)
    assertTrue(TrackingRuntime.isCaptureRunning)
    assertEquals(WorkInfo.State.CANCELLED, checkState())
  }

  @Test
  fun aResumeThatFailsToReachTheForegroundKeepsTheCheckAndAsksTheOwnerToOpenTheApp() {
    park()
    assertTrue(TrackingRuntime.applySharingState(application, "test-owner", "tablet", SharingCaptureState(revisionPrefix = "s0.3:")))
    runWorker()
    val started = shadowOf(application).nextStartedService
    val service = createService()
    shadowOf(service).setThrowInStartForeground(IllegalStateException("startForeground() not allowed"))

    assertEquals(Service.START_NOT_STICKY, service.onStartCommand(started, 0, 1))
    assertFalse(TrackingRuntime.isCaptureRunning)
    assertTrue(shadowOf(service).isStoppedBySelf)
    assertEquals(
      application.getString(expo.modules.openbeacontracking.R.string.openbeacon_tracking_resumed_notice_body),
      notice()?.extras?.getCharSequence(android.app.Notification.EXTRA_TEXT).toString(),
    )
    assertEquals(WorkInfo.State.ENQUEUED, checkState())
  }

  @Test
  fun aRemoteSwitchToATimedPauseRestartsTheForegroundService() {
    park()
    val timed = SharingCaptureState(revisionPrefix = "s0.3:", paused = true, pausedUntil = System.currentTimeMillis() + 900_000L)
    assertTrue(TrackingRuntime.applySharingState(application, "test-owner", "tablet", timed))
    runWorker()

    assertEquals(ComponentName(application, TrackingCaptureService::class.java), shadowOf(application).nextStartedService.component)
    val service = createService()
    assertEquals(Service.START_STICKY, service.onStartCommand(null, 0, 1))
    assertTrue(TrackingRuntime.sharingState(application).isPaused(System.currentTimeMillis()))
    assertNotNull(shadowOf(service).lastForegroundNotification)
  }

  @Test
  fun whenAndroidBlocksTheRestartTheOwnerIsAskedToOpenTheApp() {
    park()
    assertTrue(TrackingRuntime.applySharingState(application, "test-owner", "tablet", SharingCaptureState(revisionPrefix = "s0.3:")))
    val blocked =
      object : ContextWrapper(application) {
        override fun startForegroundService(service: Intent) = throw IllegalStateException("startForegroundService() not allowed")
      }
    SharingResumeWorker.restoreCapture(blocked)

    assertNull(shadowOf(application).nextStartedService)
    assertEquals(
      application.getString(expo.modules.openbeacontracking.R.string.openbeacon_tracking_resumed_notice_body),
      notice()?.extras?.getCharSequence(android.app.Notification.EXTRA_TEXT).toString(),
    )
    assertEquals(WorkInfo.State.CANCELLED, checkState())
    startRunningService()
    assertNull(notice())
  }

  @Test
  fun withoutBackgroundLocationTheResumeWaitsForTheAppToOpen() {
    park()
    assertTrue(TrackingRuntime.applySharingState(application, "test-owner", "tablet", SharingCaptureState(revisionPrefix = "s0.3:")))
    shadowOf(application).denyPermissions(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
    runWorker()

    assertNull(shadowOf(application).nextStartedService)
    assertNotNull(notice())
    assertEquals(WorkInfo.State.CANCELLED, checkState())
  }

  @Test
  fun stoppingCaptureCancelsTheCheck() {
    park()
    TrackingRuntime.setCaptureEnabled(application, false)

    assertFalse(TrackingRuntime.isCaptureParked(application))
    assertEquals(WorkInfo.State.CANCELLED, checkState())
  }

  @Test
  fun changingOwnerCancelsTheCheck() {
    park()
    TrackingRuntime.setQueueOwner(application, "other-owner", "tablet")

    assertFalse(TrackingRuntime.isCaptureParked(application))
    assertEquals(WorkInfo.State.CANCELLED, checkState())
  }

  @Test
  fun aLateCheckAfterSignOutDoesNothing() {
    park()
    TrackingRuntime.setCaptureEnabled(application, false)
    TrackingRuntime.setSharingState(application, SharingCaptureState(revisionPrefix = "s0.3:"))
    runWorker()

    assertNull(shadowOf(application).nextStartedService)
    assertNull(notice())
  }

  @Test
  fun afterARebootAnIndefinitePauseSchedulesTheCheckInsteadOfStartingCapture() {
    TrackingRuntime.setSharingState(application, indefinitePause)
    TrackingBootReceiver().onReceive(application, Intent(Intent.ACTION_BOOT_COMPLETED))

    assertNull(shadowOf(application).nextStartedService)
    assertEquals(WorkInfo.State.ENQUEUED, checkState())
  }

  @Test
  fun afterARebootATimedPauseRestartsTheForegroundService() {
    TrackingRuntime.setSharingState(application, SharingCaptureState(revisionPrefix = "s0.2:", paused = true, pausedUntil = System.currentTimeMillis() + 900_000L))
    TrackingBootReceiver().onReceive(application, Intent(Intent.ACTION_BOOT_COMPLETED))

    assertEquals(ComponentName(application, TrackingCaptureService::class.java), shadowOf(application).nextStartedService.component)
    assertNull(checkState())
  }

  private fun park() {
    TrackingRuntime.setSharingState(application, indefinitePause)
    SharingResumeWorker.schedule(application)
    assertEquals(WorkInfo.State.ENQUEUED, checkState())
  }

  private fun runWorker() {
    runBlocking { TestListenableWorkerBuilder<SharingResumeWorker>(application).build().doWork() }
  }

  private fun checkState(): WorkInfo.State? =
    WorkManager.getInstance(application).getWorkInfosForUniqueWork(SharingResumeWorker.WORK_NAME).get().firstOrNull()?.state

  private fun notice() =
    shadowOf(application.getSystemService(NotificationManager::class.java)).getNotification(SharingResumeWorker.NOTICE_ID)

  private fun action(name: String) = Intent(application, TrackingCaptureService::class.java).apply { action = name }

  private fun startRunningService(): TrackingCaptureService {
    val service = createService()
    assertEquals(Service.START_STICKY, service.onStartCommand(null, 0, 1))
    assertTrue(TrackingRuntime.isCaptureRunning)
    return service
  }

  private fun createService(): TrackingCaptureService {
    controller?.destroy()
    val created = Robolectric.buildService(TrackingCaptureService::class.java).create()
    controller = created
    return created.get()
  }
}
