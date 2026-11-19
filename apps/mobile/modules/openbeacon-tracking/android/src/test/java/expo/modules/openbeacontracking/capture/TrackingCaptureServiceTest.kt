package expo.modules.openbeacontracking.capture

import android.Manifest
import android.app.Application
import android.app.NotificationManager
import android.app.Service
import android.content.ComponentName
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.location.Location
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Looper
import android.os.SystemClock
import android.text.format.DateFormat
import android.text.format.DateUtils
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import expo.modules.openbeacontracking.Notice
import expo.modules.openbeacontracking.Notices
import expo.modules.openbeacontracking.TrackingRuntime
import expo.modules.openbeacontracking.keys.InMemoryEpochKeyStore
import expo.modules.openbeacontracking.keys.ProvisionedEpochKey
import expo.modules.openbeacontracking.places.InMemoryPlaceStore
import expo.modules.openbeacontracking.places.InMemoryPlaceTransitionQueue
import expo.modules.openbeacontracking.places.PlaceDetection
import expo.modules.openbeacontracking.places.PlaceGeofence
import expo.modules.openbeacontracking.queue.CiphertextQueueDatabase
import expo.modules.openbeacontracking.queue.CiphertextQueueRow
import expo.modules.openbeacontracking.queue.RoomCiphertextQueue
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
import org.robolectric.shadows.ShadowNetwork
import org.robolectric.shadows.ShadowNetworkCapabilities
import java.util.Calendar
import java.lang.reflect.Proxy
import java.util.Date

@RunWith(RobolectricTestRunner::class)
class TrackingCaptureServiceTest {
  private val application: Application = ApplicationProvider.getApplicationContext()
  private var controller: ServiceController<TrackingCaptureService>? = null
  private val keysField = TrackingRuntime::class.java.getDeclaredField("epochKeyStore").apply { isAccessible = true }
  private val queueField = TrackingRuntime::class.java.getDeclaredField("ciphertextQueue").apply { isAccessible = true }
  private val placeDetectionField = TrackingRuntime::class.java.getDeclaredField("placeDetection").apply { isAccessible = true }
  private val locateWakesField = TrackingCaptureService::class.java.getDeclaredField("locateWakes").apply { isAccessible = true }
  private var locateClockMs = 0L

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
    locateWakesField.set(null, LocateWakePolicy { locateClockMs })
  }

  @After
  fun tearDown() {
    controller?.destroy()
    TrackingRuntime.isCaptureRunning = false
    TrackingRuntime.setCaptureEnabled(application, false)
    keysField.set(null, null)
    queueField.set(null, null)
    placeDetectionField.set(null, null)
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
    assertEquals("sharing", shadowOf(application).nextStartedService.getStringExtra(TrackingUploadService.EXTRA_REASON))
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
  fun anUpdateRequestWhilePausedOnlySyncs() {
    TrackingRuntime.isCaptureRunning = true
    TrackingCaptureService.locateNow(application)

    assertEquals(listOf(TrackingUploadService.REASON_PUSH), drainStartedServices().map { it.getStringExtra(TrackingUploadService.EXTRA_REASON) })
  }

  @Test
  fun anUpdateRequestThatArrivesAfterAPauseTakesNoFix() {
    val requests = mutableListOf<CurrentLocationRequest>()
    val service = startLocatingService(requests) { Tasks.forResult(null) }
    TrackingCaptureService.locateNow(application)
    val refresh = drainStartedServices().single { it.action == TrackingCaptureService.ACTION_REFRESH }
    TrackingRuntime.setSharingState(application, SharingCaptureState(revisionPrefix = "s0.3:", paused = true, pausedUntil = System.currentTimeMillis() + 3_600_000L))

    service.onStartCommand(refresh, 0, 2)
    shadowOf(Looper.getMainLooper()).idle()

    assertTrue(requests.isEmpty())
    assertTrue(drainStartedServices().isEmpty())
  }

  @Test
  fun anUpdateRequestWhileCapturingSyncsAndUploadsAFreshFix() {
    val requests = mutableListOf<CurrentLocationRequest>()
    val service = startLocatingService(requests) { Tasks.forResult(freshFix()) }
    TrackingCaptureService.locateNow(application)
    val started = drainStartedServices()

    assertEquals(TrackingUploadService.REASON_PUSH, started[0].getStringExtra(TrackingUploadService.EXTRA_REASON))
    assertEquals(ComponentName(application, TrackingCaptureService::class.java), started[1].component)
    assertEquals(TrackingCaptureService.ACTION_REFRESH, started[1].action)
    assertEquals(2, started.size)

    service.onStartCommand(started[1], 0, 2)
    shadowOf(Looper.getMainLooper()).idle()

    val request = requests.single()
    assertEquals(0L, request.maxUpdateAgeMillis)
    assertEquals(Priority.PRIORITY_HIGH_ACCURACY, request.priority)
    assertEquals(20_000L, request.durationMillis)
    assertEquals(listOf(TrackingUploadService.REASON_UPLOAD), awaitStartedServices().map { it.getStringExtra(TrackingUploadService.EXTRA_REASON) })
  }

  @Test
  fun anUpdateRequestOfflineStillAsksForAnUploadAfterTheFix() {
    val service = startLocatingService(mutableListOf(), online = false) { Tasks.forResult(freshFix()) }
    TrackingCaptureService.locateNow(application)
    val refresh = drainStartedServices().single { it.action == TrackingCaptureService.ACTION_REFRESH }

    service.onStartCommand(refresh, 0, 2)
    shadowOf(Looper.getMainLooper()).idle()

    assertEquals(listOf(TrackingUploadService.REASON_UPLOAD), awaitStartedServices().map { it.getStringExtra(TrackingUploadService.EXTRA_REASON) })
  }

  @Test
  fun anUpdateRequestWithoutAFixStillUploadsQueuedPoints() {
    var outcome: () -> Task<Location?> = { Tasks.forResult(null) }
    val service = startLocatingService(mutableListOf()) { outcome() }
    TrackingCaptureService.locateNow(application)
    val refresh = drainStartedServices().single { it.action == TrackingCaptureService.ACTION_REFRESH }
    val outcomes = listOf<() -> Task<Location?>>(
      { Tasks.forResult(null) },
      { Tasks.forException(RuntimeException("No fix.")) },
      { throw SecurityException("Location access was removed.") },
    )

    outcomes.forEachIndexed { index, next ->
      outcome = next
      service.onStartCommand(refresh, 0, index + 2)
      shadowOf(Looper.getMainLooper()).idle()
      assertEquals(listOf(TrackingUploadService.REASON_UPLOAD), drainStartedServices().map { it.getStringExtra(TrackingUploadService.EXTRA_REASON) })
    }
  }

  @Test
  fun anUpdateRequestAfterTheAppWasClosedRestartsCaptureInTheForeground() {
    TrackingRuntime.setSharingState(application, SharingCaptureState(revisionPrefix = "s0.2:"))
    TrackingCaptureService.locateNow(application)
    val started = drainStartedServices()

    assertEquals(TrackingUploadService.REASON_PUSH, started[0].getStringExtra(TrackingUploadService.EXTRA_REASON))
    assertEquals(ComponentName(application, TrackingCaptureService::class.java), started[1].component)
    assertEquals(null, started[1].action)
    assertTrue(started[1].getBooleanExtra(TrackingCaptureService.EXTRA_LOCATE, false))
    assertEquals(2, started.size)
  }

  @Test
  fun aRestartedCaptureShowsItsNoticeAndUploadsAFreshFix() {
    val requests = mutableListOf<CurrentLocationRequest>()
    val service = locatingService(requests) { Tasks.forResult(freshFix()) }
    TrackingCaptureService.locateNow(application)
    val restart = drainStartedServices().single { it.component == ComponentName(application, TrackingCaptureService::class.java) }

    assertEquals(Service.START_STICKY, service.onStartCommand(restart, 0, 1))
    shadowOf(Looper.getMainLooper()).idle()

    assertTrue(TrackingRuntime.isCaptureRunning)
    assertEquals(
      application.getString(expo.modules.openbeacontracking.R.string.openbeacon_tracking_notification_title),
      shadowOf(service).lastForegroundNotification.extras.getCharSequence(android.app.Notification.EXTRA_TITLE).toString(),
    )
    val request = requests.single()
    assertEquals(0L, request.maxUpdateAgeMillis)
    assertEquals(Priority.PRIORITY_HIGH_ACCURACY, request.priority)
    assertEquals(listOf(TrackingUploadService.REASON_UPLOAD), awaitStartedServices().map { it.getStringExtra(TrackingUploadService.EXTRA_REASON) })
  }

  @Test
  fun aRestartThatArrivesAfterATimedPauseShowsThePauseAndTakesNoFix() {
    val requests = mutableListOf<CurrentLocationRequest>()
    val service = locatingService(requests) { Tasks.forResult(freshFix()) }
    TrackingRuntime.setSharingState(application, SharingCaptureState(revisionPrefix = "s0.3:", paused = true, pausedUntil = System.currentTimeMillis() + 3_600_000L))

    service.onStartCommand(locateRestartIntent(), 0, 1)
    shadowOf(Looper.getMainLooper()).idle()

    assertTrue(TrackingRuntime.isCaptureRunning)
    assertEquals(
      application.getString(expo.modules.openbeacontracking.R.string.openbeacon_tracking_notification_paused_title),
      shadowOf(service).lastForegroundNotification.extras.getCharSequence(android.app.Notification.EXTRA_TITLE).toString(),
    )
    assertTrue(requests.isEmpty())
    assertTrue(drainStartedServices().isEmpty())
  }

  @Test
  fun aRestartThatArrivesAfterAnIndefinitePausePromotesThenParks() {
    val requests = mutableListOf<CurrentLocationRequest>()
    val service = locatingService(requests) { Tasks.forResult(freshFix()) }
    TrackingRuntime.setSharingState(application, SharingCaptureState(revisionPrefix = "s0.3:", paused = true))

    assertEquals(Service.START_NOT_STICKY, service.onStartCommand(locateRestartIntent(), 0, 1))
    shadowOf(Looper.getMainLooper()).idle()

    assertTrue(shadowOf(service).lastForegroundNotificationId != 0)
    assertTrue(shadowOf(service).notificationShouldRemoved)
    assertFalse(TrackingRuntime.isCaptureRunning)
    assertTrue(shadowOf(service).isStoppedBySelf)
    assertTrue(requests.isEmpty())
  }

  @Test
  fun aRestartThatArrivesAfterSharingStoppedPromotesThenStops() {
    val cases = listOf<(TrackingCaptureService) -> Unit>(
      { TrackingRuntime.setCaptureEnabled(application, false) },
      { shadowOf(application).denyPermissions(Manifest.permission.ACCESS_BACKGROUND_LOCATION) },
      { service ->
        shadowOf(application).denyPermissions(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        shadowOf(service).setThrowInStartForeground(SecurityException("Location access was removed."))
      },
    )

    cases.forEach { stopSharing ->
      setUp()
      val requests = mutableListOf<CurrentLocationRequest>()
      val service = locatingService(requests) { Tasks.forResult(freshFix()) }
      stopSharing(service)

      assertEquals(Service.START_NOT_STICKY, service.onStartCommand(locateRestartIntent(), 0, 1))
      shadowOf(Looper.getMainLooper()).idle()

      assertTrue(shadowOf(service).isForegroundStopped)
      assertTrue(shadowOf(service).isStoppedBySelf)
      assertFalse(TrackingRuntime.isCaptureRunning)
      assertTrue(requests.isEmpty())
      controller?.destroy()
    }
    assertTrue(hasNotice(expo.modules.openbeacontracking.R.string.openbeacon_notice_location_permission_body))
  }

  @Test
  fun aRefusedRestartFallsBackToUploadingQueuedPoints() {
    TrackingRuntime.setSharingState(application, SharingCaptureState(revisionPrefix = "s0.2:"))
    listOf(IllegalStateException("Not allowed in the background."), SecurityException("Location access was removed.")).forEach { refusal ->
      val refusing =
        object : ContextWrapper(application) {
          override fun startForegroundService(service: Intent): ComponentName = throw refusal
        }
      locateClockMs += LocateWakePolicy.COOLDOWN_MS

      TrackingCaptureService.locateNow(refusing)

      assertEquals(listOf(TrackingUploadService.REASON_PUSH, TrackingUploadService.REASON_UPLOAD), drainStartedServices().map { it.getStringExtra(TrackingUploadService.EXTRA_REASON) })
      assertFalse(TrackingRuntime.isCaptureRunning)
    }
  }

  @Test
  fun restartRequestsWithinThirtySecondsStartCaptureOnce() {
    TrackingRuntime.setSharingState(application, SharingCaptureState(revisionPrefix = "s0.2:"))
    TrackingCaptureService.locateNow(application)
    locateClockMs += 29_999L
    TrackingCaptureService.locateNow(application)

    assertEquals(1, drainStartedServices().count { it.component == ComponentName(application, TrackingCaptureService::class.java) })
  }

  @Test
  fun anUpdateRequestAfterSharingWasTurnedOffOnlySyncs() {
    TrackingRuntime.setSharingState(application, SharingCaptureState(revisionPrefix = "s0.2:"))
    TrackingRuntime.setCaptureEnabled(application, false)
    TrackingCaptureService.locateNow(application)

    assertEquals(listOf(TrackingUploadService.REASON_PUSH), drainStartedServices().map { it.getStringExtra(TrackingUploadService.EXTRA_REASON) })
  }

  @Test
  fun updateRequestsWithinThirtySecondsShareOneFix() {
    TrackingRuntime.setSharingState(application, SharingCaptureState(revisionPrefix = "s0.2:"))
    TrackingRuntime.isCaptureRunning = true
    TrackingCaptureService.locateNow(application)
    locateClockMs += 29_999L
    TrackingCaptureService.locateNow(application)

    assertEquals(
      listOf(TrackingUploadService.REASON_PUSH, null, TrackingUploadService.REASON_PUSH),
      drainStartedServices().map { it.getStringExtra(TrackingUploadService.EXTRA_REASON) },
    )

    locateClockMs += 1L
    TrackingCaptureService.locateNow(application)
    assertEquals(TrackingCaptureService.ACTION_REFRESH, drainStartedServices().last().action)
  }

  @Test
  fun aSwipedAwaySharingNoticeIsShownAgain() {
    val service = createService()
    service.onStartCommand(checkSharingIntent(), 0, 1)
    val manager = application.getSystemService(NotificationManager::class.java)
    val deleteIntent = shadowOf(shadowOf(service).lastForegroundNotification.deleteIntent).savedIntent
    manager.cancel(7260)

    assertEquals(TrackingCaptureService.ACTION_SHOW_NOTICE, deleteIntent.action)
    assertTrue(TrackingCaptureService.isNoticeMissing(application))
    assertEquals(Service.START_STICKY, service.onStartCommand(deleteIntent, 0, 2))
    assertFalse(TrackingCaptureService.isNoticeMissing(application))
  }

  @Test
  fun aSharingNoticeHiddenWhileNotificationsWereOffIsShownOnceTheyAreAllowed() {
    val service = createService()
    val manager = application.getSystemService(NotificationManager::class.java)
    shadowOf(manager).setNotificationsEnabled(false)
    service.onStartCommand(checkSharingIntent(), 0, 1)
    manager.cancel(7260)
    drainStartedServices()

    TrackingCaptureService.showNoticeIfMissing(application)
    assertTrue(drainStartedServices().isEmpty())

    shadowOf(manager).setNotificationsEnabled(true)
    TrackingCaptureService.showNoticeIfMissing(application)
    val show = drainStartedServices().single()
    assertEquals(TrackingCaptureService.ACTION_SHOW_NOTICE, show.action)
    service.onStartCommand(show, 0, 2)
    assertFalse(TrackingCaptureService.isNoticeMissing(application))
  }

  @Test
  fun aShowNoticeRequestAfterCaptureStoppedDoesNotKeepTheServiceAlive() {
    val service = createService()
    val result = service.onStartCommand(Intent(application, TrackingCaptureService::class.java).apply {
      action = TrackingCaptureService.ACTION_SHOW_NOTICE
    }, 0, 1)

    assertEquals(Service.START_NOT_STICKY, result)
    assertTrue(shadowOf(service).isStoppedBySelf)
    assertTrue(TrackingCaptureService.isNoticeMissing(application))
  }

  @Test
  fun aTimedPauseSaysWhenSharingStartsAgain() {
    val until = Calendar.getInstance().apply {
      set(Calendar.HOUR_OF_DAY, 23)
      set(Calendar.MINUTE, 59)
      set(Calendar.SECOND, 59)
      set(Calendar.MILLISECOND, 999)
    }.timeInMillis
    TrackingRuntime.setSharingState(application, SharingCaptureState(revisionPrefix = "s0.1:", paused = true, pausedUntil = until))
    val service = createService()
    service.onStartCommand(Intent(application, TrackingCaptureService::class.java).apply {
      action = TrackingCaptureService.ACTION_CHECK_SHARING
    }, 0, 1)
    val notification = shadowOf(service).lastForegroundNotification

    assertEquals(
      application.getString(expo.modules.openbeacontracking.R.string.openbeacon_tracking_notification_paused_title),
      notification.extras.getCharSequence(android.app.Notification.EXTRA_TITLE).toString(),
    )
    assertEquals(
      application.getString(
        expo.modules.openbeacontracking.R.string.openbeacon_tracking_notification_paused_until_body,
        DateFormat.getTimeFormat(application).format(Date(until)),
      ),
      notification.extras.getCharSequence(android.app.Notification.EXTRA_TEXT).toString(),
    )
  }

  @Test
  fun aTimedPauseEndingTomorrowSaysTomorrow() {
    val until = Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, 1) }.timeInMillis
    TrackingRuntime.setSharingState(application, SharingCaptureState(revisionPrefix = "s0.1:", paused = true, pausedUntil = until))
    val service = createService()
    service.onStartCommand(startIntent(TrackingRuntime.captureCommands.start()), 0, 1)

    assertEquals(
      application.getString(
        expo.modules.openbeacontracking.R.string.openbeacon_tracking_notification_paused_until_tomorrow_body,
        DateFormat.getTimeFormat(application).format(Date(until)),
      ),
      shadowOf(service).lastForegroundNotification.extras.getCharSequence(android.app.Notification.EXTRA_TEXT).toString(),
    )
  }

  @Test
  fun reconnectingUploadsPendingFixesWithoutWaitingForTheNextFix() {
    val queue = RoomCiphertextQueue(Room.inMemoryDatabaseBuilder(application, CiphertextQueueDatabase::class.java).allowMainThreadQueries().build())
    queueField.set(null, queue)
    TrackingRuntime.setSharingState(application, SharingCaptureState(revisionPrefix = "s0.2:"))
    val generation = TrackingRuntime.captureCommands.start()
    val service = createService()
    service.onStartCommand(startIntent(generation), 0, 1)
    service.onStartCommand(startIntent(generation), 0, 2)
    val connectivity = shadowOf(application.getSystemService(ConnectivityManager::class.java))

    assertEquals(1, connectivity.networkCallbacks.size)
    connectivity.networkCallbacks.single().onAvailable(ShadowNetwork.newInstance(1))
    Thread.sleep(500)
    assertEquals(null, shadowOf(application).peekNextStartedService())

    queue.insertAll(listOf(CiphertextQueueRow(owner = "test-owner", clientPointId = "point", captureId = "capture", groupId = "group", epochId = "epoch", senderDeviceId = "tablet", kind = "trackingPoint", algorithm = "algorithm", nonce = "nonce", ciphertext = "ciphertext", queuedAt = 1)))
    TrackingRuntime.captureCommands.stop()
    connectivity.networkCallbacks.single().onAvailable(ShadowNetwork.newInstance(1))
    connectivity.networkCallbacks.single().onAvailable(ShadowNetwork.newInstance(2))
    val deadline = System.currentTimeMillis() + 30_000L
    while (shadowOf(application).peekNextStartedService() == null && System.currentTimeMillis() < deadline) Thread.sleep(10)
    Thread.sleep(200)

    assertEquals("upload", shadowOf(application).nextStartedService.getStringExtra(TrackingUploadService.EXTRA_REASON))
    assertEquals(null, shadowOf(application).nextStartedService)

    service.onStartCommand(Intent(application, TrackingCaptureService::class.java).apply {
      action = TrackingCaptureService.ACTION_STOP
    }, 0, 3)
    assertTrue(connectivity.networkCallbacks.isEmpty())
  }

  @Test
  fun aConfirmedArrivalStartsOneUploadInsideTheUploadInterval() {
    queueField.set(null, RoomCiphertextQueue(Room.inMemoryDatabaseBuilder(application, CiphertextQueueDatabase::class.java).allowMainThreadQueries().build()))
    val transitions = InMemoryPlaceTransitionQueue()
    placeDetectionField.set(null, PlaceDetection(InMemoryPlaceStore().apply { replaceGroup("group", listOf(PlaceGeofence("group", "home", 51.5, -0.1, 100.0))) }, transitions))
    TrackingRuntime.setSharingState(application, SharingCaptureState(revisionPrefix = "s0.2:"))
    val connectivity = application.getSystemService(ConnectivityManager::class.java)
    shadowOf(connectivity).setNetworkCapabilities(connectivity.activeNetwork, ShadowNetworkCapabilities.newInstance().apply { shadowOf(this).addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) })
    val generation = TrackingRuntime.captureCommands.start()
    val service = createService()
    service.onStartCommand(startIntent(generation), 0, 1)
    val enqueue = TrackingCaptureService::class.java.getDeclaredMethod("enqueueEncryptedFix", Location::class.java, Long::class.javaPrimitiveType).apply { isAccessible = true }
    val requestUploadIfDue = TrackingCaptureService::class.java.getDeclaredMethod("requestUploadIfDue", Long::class.javaPrimitiveType).apply { isAccessible = true }
    val nowMs = System.currentTimeMillis()
    val fix = { offset: Int, latitude: Double, atMs: Long ->
      Location("test").apply {
        this.latitude = latitude
        longitude = -0.1
        accuracy = 10f
        time = atMs
        elapsedRealtimeNanos = SystemClock.elapsedRealtimeNanos() + offset
      }
    }
    while (shadowOf(application).nextStartedService != null) Unit

    enqueue.invoke(service, fix(1, 51.51, nowMs - 300_000L), generation)
    assertEquals("upload", shadowOf(application).nextStartedService.getStringExtra(TrackingUploadService.EXTRA_REASON))
    enqueue.invoke(service, fix(2, 51.5, nowMs - 200_000L), generation)
    assertEquals(null, shadowOf(application).nextStartedService)
    assertFalse(transitions.hasAny("test-owner"))

    enqueue.invoke(service, fix(3, 51.5, nowMs - 60_000L), generation)
    requestUploadIfDue.invoke(service, generation)
    assertTrue(transitions.hasAny("test-owner"))
    assertEquals("upload", shadowOf(application).nextStartedService.getStringExtra(TrackingUploadService.EXTRA_REASON))
    assertEquals(null, shadowOf(application).nextStartedService)
  }

  @Test
  fun anArrivalQueuedOfflineUploadsWhenThePhoneIsBackOnline() {
    queueField.set(null, RoomCiphertextQueue(Room.inMemoryDatabaseBuilder(application, CiphertextQueueDatabase::class.java).allowMainThreadQueries().build()))
    val transitions = InMemoryPlaceTransitionQueue()
    placeDetectionField.set(null, PlaceDetection(InMemoryPlaceStore().apply { replaceGroup("group", listOf(PlaceGeofence("group", "home", 51.5, -0.1, 100.0))) }, transitions))
    TrackingRuntime.setSharingState(application, SharingCaptureState(revisionPrefix = "s0.2:"))
    val connectivity = application.getSystemService(ConnectivityManager::class.java)
    val setOnline = { online: Boolean ->
      shadowOf(connectivity).setNetworkCapabilities(
        connectivity.activeNetwork,
        ShadowNetworkCapabilities.newInstance().apply { if (online) shadowOf(this).addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) },
      )
    }
    setOnline(true)
    val generation = TrackingRuntime.captureCommands.start()
    val service = createService()
    service.onStartCommand(startIntent(generation), 0, 1)
    val enqueue = TrackingCaptureService::class.java.getDeclaredMethod("enqueueEncryptedFix", Location::class.java, Long::class.javaPrimitiveType).apply { isAccessible = true }
    val requestUploadIfDue = TrackingCaptureService::class.java.getDeclaredMethod("requestUploadIfDue", Long::class.javaPrimitiveType).apply { isAccessible = true }
    val nowMs = System.currentTimeMillis()
    val fix = { offset: Int, latitude: Double, atMs: Long ->
      Location("test").apply {
        this.latitude = latitude
        longitude = -0.1
        accuracy = 10f
        time = atMs
        elapsedRealtimeNanos = SystemClock.elapsedRealtimeNanos() + offset
      }
    }
    while (shadowOf(application).nextStartedService != null) Unit

    enqueue.invoke(service, fix(1, 51.51, nowMs - 300_000L), generation)
    assertEquals("upload", shadowOf(application).nextStartedService.getStringExtra(TrackingUploadService.EXTRA_REASON))
    setOnline(false)
    enqueue.invoke(service, fix(2, 51.5, nowMs - 200_000L), generation)
    enqueue.invoke(service, fix(3, 51.5, nowMs - 60_000L), generation)
    assertTrue(transitions.hasAny("test-owner"))
    assertEquals(null, shadowOf(application).nextStartedService)

    setOnline(true)
    requestUploadIfDue.invoke(service, generation)
    assertEquals("upload", shadowOf(application).nextStartedService.getStringExtra(TrackingUploadService.EXTRA_REASON))
    requestUploadIfDue.invoke(service, generation)
    assertEquals(null, shadowOf(application).nextStartedService)
  }

  @Test
  fun aTimedPauseEndingOnAnotherDaySaysWhichDay() {
    val until = System.currentTimeMillis() + 2 * 86_400_000L
    TrackingRuntime.setSharingState(application, SharingCaptureState(revisionPrefix = "s0.1:", paused = true, pausedUntil = until))
    val service = createService()
    service.onStartCommand(startIntent(TrackingRuntime.captureCommands.start()), 0, 1)

    assertEquals(
      application.getString(
        expo.modules.openbeacontracking.R.string.openbeacon_tracking_notification_paused_until_day_body,
        DateUtils.formatDateTime(application, until, DateUtils.FORMAT_SHOW_WEEKDAY or DateUtils.FORMAT_SHOW_DATE),
        DateFormat.getTimeFormat(application).format(Date(until)),
      ),
      shadowOf(service).lastForegroundNotification.extras.getCharSequence(android.app.Notification.EXTRA_TEXT).toString(),
    )
  }

  @Test
  fun turningSharingOffClearsStaleSharingAlerts() {
    Notices.show(application, Notice.LOCATION_PERMISSION)
    Notices.show(application, Notice.SHARING_CHANGED)
    TrackingRuntime.setCaptureEnabled(application, false)

    assertTrue(shadowOf(application.getSystemService(NotificationManager::class.java)).allNotifications.isEmpty())
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
  fun aStickyRestartAfterLocationAccessIsRemovedTellsTheOwner() {
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

  @Test
  fun aResumeThatLosesLocationAccessLeavesNoSharingNotification() {
    val service = createService()
    service.onStartCommand(startIntent(TrackingRuntime.captureCommands.start()), 0, 1)
    assertTrue(TrackingRuntime.isCaptureRunning)
    val refusingClient =
      Proxy.newProxyInstance(FusedLocationProviderClient::class.java.classLoader, arrayOf(FusedLocationProviderClient::class.java)) { _, method, _ ->
        if (method.name == "requestLocationUpdates") throw SecurityException("Location access was removed.")
        null
      } as FusedLocationProviderClient
    TrackingCaptureService::class.java.getDeclaredField("fusedLocationClient\$delegate").apply { isAccessible = true }.set(service, lazyOf(refusingClient))
    assertTrue(TrackingRuntime.applySharingState(application, "test-owner", "tablet", SharingCaptureState(revisionPrefix = "s0.2:")))

    service.onStartCommand(Intent(application, TrackingCaptureService::class.java).apply { action = TrackingCaptureService.ACTION_SHARING_CHANGED }, 0, 2)

    assertFalse(TrackingRuntime.isCaptureRunning)
    assertTrue(shadowOf(service).isStoppedBySelf)
    assertTrue(shadowOf(application.getSystemService(NotificationManager::class.java)).allNotifications.isEmpty())
  }

  private fun startLocatingService(
    requests: MutableList<CurrentLocationRequest>,
    online: Boolean = true,
    fix: () -> Task<Location?>,
  ): TrackingCaptureService {
    val service = locatingService(requests, online, fix)
    service.onStartCommand(startIntent(TrackingRuntime.captureCommands.start()), 0, 1)
    assertTrue(TrackingRuntime.isCaptureRunning)
    drainStartedServices()
    return service
  }

  private fun locatingService(
    requests: MutableList<CurrentLocationRequest>,
    online: Boolean = true,
    fix: () -> Task<Location?>,
  ): TrackingCaptureService {
    queueField.set(null, RoomCiphertextQueue(Room.inMemoryDatabaseBuilder(application, CiphertextQueueDatabase::class.java).allowMainThreadQueries().build()))
    TrackingRuntime.setSharingState(application, SharingCaptureState(revisionPrefix = "s0.2:"))
    val connectivity = application.getSystemService(ConnectivityManager::class.java)
    shadowOf(connectivity).setNetworkCapabilities(
      connectivity.activeNetwork,
      ShadowNetworkCapabilities.newInstance().apply { if (online) shadowOf(this).addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) },
    )
    val client =
      Proxy.newProxyInstance(FusedLocationProviderClient::class.java.classLoader, arrayOf(FusedLocationProviderClient::class.java)) { _, method, args ->
        val request = args?.firstOrNull()
        if (method.name == "getCurrentLocation" && request is CurrentLocationRequest) {
          requests.add(request)
          fix()
        } else {
          null
        }
      } as FusedLocationProviderClient
    val service = createService()
    TrackingCaptureService::class.java.getDeclaredField("fusedLocationClient\$delegate").apply { isAccessible = true }.set(service, lazyOf(client))
    return service
  }

  private fun locateRestartIntent() = Intent(application, TrackingCaptureService::class.java).putExtra(TrackingCaptureService.EXTRA_LOCATE, true)

  private fun freshFix() =
    Location("test").apply {
      latitude = 51.5
      longitude = -0.1
      accuracy = 10f
      time = System.currentTimeMillis()
      elapsedRealtimeNanos = SystemClock.elapsedRealtimeNanos() + 1
    }

  private fun drainStartedServices(): List<Intent> = generateSequence { shadowOf(application).nextStartedService }.toList()

  private fun awaitStartedServices(): List<Intent> {
    val deadline = System.currentTimeMillis() + 30_000L
    while (shadowOf(application).peekNextStartedService() == null && System.currentTimeMillis() < deadline) Thread.sleep(10)
    Thread.sleep(200)
    return drainStartedServices()
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

  private fun checkSharingIntent() =
    Intent(application, TrackingCaptureService::class.java).apply { action = TrackingCaptureService.ACTION_CHECK_SHARING }

  private fun createService(): TrackingCaptureService {
    val created = Robolectric.buildService(TrackingCaptureService::class.java).create()
    controller = created
    return created.get()
  }
}
