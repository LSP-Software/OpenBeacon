package expo.modules.openbeacontracking

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import expo.modules.openbeacontracking.capture.TrackingCaptureService
import expo.modules.openbeacontracking.capture.SharingCaptureState
import expo.modules.openbeacontracking.capture.SharingResumeWorker
import expo.modules.openbeacontracking.capture.UploadTasks
import expo.modules.openbeacontracking.crypto.GroupPayloadEncrypt
import expo.modules.openbeacontracking.keys.ProvisionedEpochKey
import expo.modules.openbeacontracking.places.PlaceGeofence
import expo.modules.openbeacontracking.places.PlaceSearch
import expo.modules.openbeacontracking.places.PlaceSearchBox
import expo.modules.openbeacontracking.push.PushRuntime
import expo.modules.openbeacontracking.queue.CiphertextQueueRow
import expo.modules.openbeacontracking.queue.CiphertextQueueDatabase
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class OpenBeaconTrackingModule : Module() {
  override fun definition() =
    ModuleDefinition {
      Name("OpenBeaconTracking")

      OnCreate {
        Notices.removeOldChannels(requireContext())
      }

      OnActivityEntersForeground {
        appContext.reactContext?.let { TrackingCaptureService.showNoticeIfMissing(it) }
      }

      Function("setSharingState") { owner: String, deviceId: String, prefix: String, paused: Boolean, until: Double?, after: Double? ->
        TrackingRuntime.applySharingState(requireContext(), owner, deviceId, SharingCaptureState(prefix, paused, until?.toLong(), after?.toLong() ?: 0L))
      }

      Function("setHistoryShare") { owner: String, deviceId: String, account: String, groups: Map<String, String> ->
        TrackingRuntime.setHistoryShare(requireContext(), owner, deviceId, account, groups)
      }

      Function("isQueueOwner") { owner: String, deviceId: String ->
        TrackingRuntime.queueOwner(requireContext()) == owner && TrackingRuntime.queueDeviceId(requireContext()) == deviceId
      }

      Function("setQueueOwner") { owner: String, deviceId: String ->
        TrackingRuntime.setQueueOwner(requireContext(), owner, deviceId)
      }

      Function("provisionEpochKeys") { keys: List<Map<String, Any?>>, preserveGroupIds: List<String>? ->
        val parsed =
          keys.map { key ->
            val epochKeyBase64 =
              key.stringValue("epochKeyBase64")
                ?: throw IllegalArgumentException("epochKeyBase64 is required.")
            ProvisionedEpochKey(
              groupId = key.stringValue("groupId") ?: throw IllegalArgumentException("groupId is required."),
              epochId = key.stringValue("epochId") ?: throw IllegalArgumentException("epochId is required."),
              epochKey = GroupPayloadEncrypt.decodeBase64(epochKeyBase64),
              senderDeviceId =
                key.stringValue("senderDeviceId")
                  ?: throw IllegalArgumentException("senderDeviceId is required."),
              kind = key.stringValue("kind") ?: DEFAULT_KIND,
            )
          }

        TrackingRuntime.epochKeyStore(requireContext()).replacePreserving(parsed, preserveGroupIds ?: emptyList())
      }

      Function("revokeEpochKeys") { groupIds: List<String>? ->
        if (groupIds.isNullOrEmpty()) {
          synchronized(TrackingRuntime.captureLock) { TrackingRuntime.setCaptureEnabled(requireContext(), false) }
        }
        TrackingRuntime.epochKeyStore(requireContext()).revoke(groupIds)
        TrackingRuntime.placeDetection(requireContext()).removeGroups(groupIds?.takeIf { it.isNotEmpty() })
      }

      AsyncFunction("setGroupPlaces") { owner: String, deviceId: String, groupId: String, places: List<Map<String, Any?>> ->
        val parsed =
          places.map { place ->
            PlaceGeofence(
              groupId = groupId,
              placeId = place.stringValue("placeId") ?: throw IllegalArgumentException("placeId is required."),
              latitude = place.doubleValue("latitude"),
              longitude = place.doubleValue("longitude"),
              radiusMeters = place.doubleValue("radiusMeters"),
            )
          }
        synchronized(TrackingRuntime.captureLock) {
          val context = requireContext()
          if (TrackingRuntime.queueOwner(context) != owner || TrackingRuntime.queueDeviceId(context) != deviceId) return@AsyncFunction false
          TrackingRuntime.placeDetection(context).setGroupPlaces(groupId, parsed)
        }
        true
      }

      Function("listPlaceGroups") { owner: String, deviceId: String ->
        synchronized(TrackingRuntime.captureLock) {
          val context = requireContext()
          if (TrackingRuntime.queueOwner(context) != owner || TrackingRuntime.queueDeviceId(context) != deviceId) return@Function null
          TrackingRuntime.placeDetection(context).groups().toList()
        }
      }

      AsyncFunction("listPlaceTransitions") { owner: String ->
        TrackingRuntime.placeDetection(requireContext()).queued(owner, MAX_PLACE_TRANSITIONS).map {
          mapOf(
            "clientId" to it.clientId,
            "senderDeviceId" to it.senderDeviceId,
            "groupId" to it.groupId,
            "placeId" to it.placeId,
            "direction" to it.direction,
            "occurredAt" to it.occurredAt.toDouble(),
          )
        }
      }

      AsyncFunction("deletePlaceTransitions") { clientIds: List<String> ->
        TrackingRuntime.placeDetection(requireContext()).acknowledge(clientIds)
      }

      Function("isPlaceSearchAvailable") {
        PlaceSearch.isAvailable()
      }

      AsyncFunction("searchPlaces") { query: String, box: Map<String, Any?>?, promise: Promise ->
        val parsed =
          box?.let {
            PlaceSearchBox(it.doubleValue("south"), it.doubleValue("west"), it.doubleValue("north"), it.doubleValue("east"))
          }
        PlaceSearch.search(requireContext(), query, parsed) { promise.resolve(it) }
      }

      AsyncFunction("checkAppUpdate") { promise: Promise ->
        AppUpdate.check(requireContext()) { promise.resolve(it) }
      }

      AsyncFunction("startAppUpdate") { promise: Promise ->
        val activity = appContext.currentActivity
        if (activity == null) {
          promise.resolve(false)
          return@AsyncFunction
        }
        AppUpdate.start(activity) { promise.resolve(it) }
      }.runOnQueue(Queues.MAIN)

      Function("showEventNotice") { kind: String, key: String, title: String, body: String?, groupName: String?, link: String ->
        Notices.showEvent(requireContext(), EventNoticeKind.of(kind), key, title, body, groupName, link)
      }

      AsyncFunction("clearEventNotices") { keepSecurityAlerts: Boolean ->
        Notices.clearEvents(requireContext(), keepSecurityAlerts)
      }

      Function("pendingPushToken") { scope: String ->
        PushRuntime.tokens(requireContext()).pending(scope)
      }

      Function("confirmPushToken") { scope: String, sent: String?, pushAvailable: Boolean ->
        PushRuntime.confirm(requireContext(), scope, sent, pushAvailable)
      }

      Function("pushStatus") { scope: String ->
        val context = requireContext()
        val status = PushRuntime.tokens(context).status(scope)
        mapOf(
          "builtIn" to PushRuntime.builtIn(context),
          "serverPush" to status.serverPush,
          "registration" to status.registration.value,
          "lastWakeAt" to status.lastWakeAt,
          "lastWakeKind" to status.lastWakeKind,
        )
      }

      Function("forgetPushToken") { scope: String? ->
        PushRuntime.forget(requireContext(), scope)
      }

      Function("listProvisionedEpochKeys") {
        TrackingRuntime.epochKeyStore(requireContext()).list().map { key ->
          mapOf(
            "groupId" to key.groupId,
            "epochId" to key.epochId,
            "senderDeviceId" to key.senderDeviceId,
            "kind" to key.kind,
          )
        }
      }

      AsyncFunction("startCapture") { intervalMs: Double? ->
        val (generation, parked) =
          synchronized(TrackingRuntime.captureLock) {
            TrackingRuntime.setCaptureEnabled(requireContext(), true)
            TrackingRuntime.captureCommands.start() to TrackingRuntime.isCaptureParked(requireContext())
          }
        if (parked) {
          SharingResumeWorker.schedule(requireContext())
          return@AsyncFunction Unit
        }
        val intent =
          Intent(requireContext(), TrackingCaptureService::class.java).apply {
            action = TrackingCaptureService.ACTION_START
            putExtra(TrackingCaptureService.EXTRA_COMMAND_GENERATION, generation)
            if (intervalMs != null) {
              putExtra(TrackingCaptureService.EXTRA_INTERVAL_MS, intervalMs.toLong())
            }
          }
        ContextCompat.startForegroundService(requireContext(), intent)
        Unit
      }

      AsyncFunction("refreshCapture") {
        if (!TrackingRuntime.isCaptureRunning) return@AsyncFunction Unit
        val intent =
          Intent(requireContext(), TrackingCaptureService::class.java).apply {
            action = TrackingCaptureService.ACTION_REFRESH
          }
        ContextCompat.startForegroundService(requireContext(), intent)
        Unit
      }

      AsyncFunction("stopCapture") {
        synchronized(TrackingRuntime.captureLock) {
          TrackingRuntime.captureCommands.stop()
          TrackingRuntime.isCaptureRunning = false
          TrackingRuntime.setCaptureEnabled(requireContext(), false)
        }
        val intent = Intent(requireContext(), TrackingCaptureService::class.java)
        requireContext().stopService(intent)
        Unit
      }

      Function("isCaptureRunning") {
        TrackingRuntime.isCaptureRunning || TrackingRuntime.isCaptureParked(requireContext())
      }

      Function("isLowPowerMode") {
        TrackingRuntime.isLowPowerMode(requireContext())
      }

      Function("setLowPowerMode") { enabled: Boolean ->
        TrackingRuntime.setLowPowerMode(requireContext(), enabled)
      }

      Function("areNotificationsEnabled") {
        Notices.canShowSharing(requireContext())
      }

      Function("shouldShowNotificationRationale") {
        appContext.currentActivity?.let {
          ActivityCompat.shouldShowRequestPermissionRationale(it, Manifest.permission.POST_NOTIFICATIONS)
        } ?: false
      }

      AsyncFunction("setRecentsPreviewHidden") { hidden: Boolean ->
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          appContext.currentActivity?.setRecentsScreenshotEnabled(!hidden)
        }
      }.runOnQueue(Queues.MAIN)

      Function("finishUploadTask") { token: String ->
        UploadTasks.finish(token)
      }

      Function("elapsedRealtime") {
        SystemClock.elapsedRealtime().toDouble()
      }

      Function("showNotice") { kind: String ->
        Notices.show(requireContext(), Notice.of(kind))
      }

      Function("dismissNotice") { slot: String ->
        Notices.dismiss(requireContext(), NoticeSlot.of(slot))
      }

      AsyncFunction("countUnassignedCiphertexts") { senderDeviceId: String ->
        CiphertextQueueDatabase.getInstance(requireContext()).ciphertextQueueDao().countUnassigned(senderDeviceId)
      }

      AsyncFunction("assignUnassignedCiphertexts") { senderDeviceId: String, owner: String ->
        CiphertextQueueDatabase.getInstance(requireContext()).ciphertextQueueDao().assignUnassigned(senderDeviceId, owner)
      }

      AsyncFunction("listPendingCiphertexts") { owner: String, limit: Double?, afterId: Double? ->
        val resolvedLimit = (limit ?: DEFAULT_PENDING_LIMIT.toDouble()).toInt().coerceAtLeast(1)
        TrackingRuntime
          .ciphertextQueue(requireContext())
          .listByStatus(CiphertextQueueRow.STATUS_PENDING, resolvedLimit, owner, (afterId ?: 0.0).toLong())
          .map { it.toMap() }
      }

      AsyncFunction("markCiphertextsInFlight") { ids: List<Double> ->
        TrackingRuntime
          .ciphertextQueue(requireContext())
          .markInFlight(ids.map { it.toLong() }, System.currentTimeMillis())
          .map { it.toDouble() }
      }

      AsyncFunction("getCiphertextEviction") { owner: String ->
        TrackingRuntime.ciphertextQueue(requireContext()).getEviction(owner)?.let { eviction ->
          mapOf(
            "pointCount" to eviction.pointCount.toDouble(),
            "oldestQueuedAt" to eviction.oldestQueuedAt.toDouble(),
            "newestQueuedAt" to eviction.newestQueuedAt.toDouble(),
            "revision" to eviction.revision.toDouble(),
          )
        }
      }

      AsyncFunction("acknowledgeCiphertextEviction") { owner: String, revision: Double ->
        TrackingRuntime.ciphertextQueue(requireContext()).acknowledgeEviction(owner, revision.toLong())
      }

      AsyncFunction("deleteCiphertexts") { ids: List<Double> ->
        TrackingRuntime.ciphertextQueue(requireContext()).deleteByIds(ids.map { it.toLong() })
      }

      AsyncFunction("deleteCiphertextsByOwner") { owner: String ->
        TrackingRuntime.clearHistoryAllowance(requireContext(), owner)
        TrackingRuntime.ciphertextQueue(requireContext()).deleteByOwner(owner)
      }

      AsyncFunction("deleteCiphertextsByGroup") { owner: String, groupId: String ->
        TrackingRuntime.ciphertextQueue(requireContext()).deleteByGroup(owner, groupId)
      }

      AsyncFunction("requeueCiphertexts") { ids: List<Double>, error: String? ->
        TrackingRuntime
          .ciphertextQueue(requireContext())
          .requeue(ids.map { it.toLong() }, System.currentTimeMillis(), error)
      }
    }

  private fun requireContext() =
    appContext.reactContext ?: throw IllegalStateException("React context is unavailable.")

  private fun Map<String, Any?>.stringValue(key: String): String? = this[key]?.toString()

  private fun Map<String, Any?>.doubleValue(key: String): Double =
    (this[key] as? Number)?.toDouble()?.takeIf { it.isFinite() } ?: throw IllegalArgumentException("$key is required.")

  private fun CiphertextQueueRow.toMap(): Map<String, Any?> =
    mapOf(
      "id" to id.toDouble(),
      "clientPointId" to clientPointId,
      "captureId" to captureId,
      "groupId" to groupId,
      "epochId" to epochId,
      "senderDeviceId" to senderDeviceId,
      "kind" to kind,
      "algorithm" to algorithm,
      "nonce" to nonce,
      "ciphertext" to ciphertext,
      "role" to role,
      "capturedHour" to capturedHour?.toDouble(),
      "queuedAt" to queuedAt.toDouble(),
      "attemptCount" to attemptCount.toDouble(),
      "lastAttemptAt" to lastAttemptAt?.toDouble(),
      "lastError" to lastError,
      "status" to status,
    )

  companion object {
    private const val DEFAULT_KIND = "trackingPoint"
    private const val DEFAULT_PENDING_LIMIT = 100
    private const val MAX_PLACE_TRANSITIONS = 200
  }
}
