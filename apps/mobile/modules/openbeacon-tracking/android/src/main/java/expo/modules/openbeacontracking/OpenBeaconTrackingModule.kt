package expo.modules.openbeacontracking

import android.content.Intent
import androidx.core.content.ContextCompat
import expo.modules.openbeacontracking.capture.TrackingCaptureService
import expo.modules.openbeacontracking.capture.SharingCaptureState
import expo.modules.openbeacontracking.capture.SharingResumeWorker
import expo.modules.openbeacontracking.crypto.GroupPayloadEncrypt
import expo.modules.openbeacontracking.keys.ProvisionedEpochKey
import expo.modules.openbeacontracking.queue.CiphertextQueueRow
import expo.modules.openbeacontracking.queue.CiphertextQueueDatabase
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class OpenBeaconTrackingModule : Module() {
  override fun definition() =
    ModuleDefinition {
      Name("OpenBeaconTracking")

      OnCreate {
        Notices.removeOldChannels(requireContext())
      }

      Function("setSharingState") { owner: String, deviceId: String, prefix: String, paused: Boolean, until: Double?, after: Double? ->
        TrackingRuntime.applySharingState(requireContext(), owner, deviceId, SharingCaptureState(prefix, paused, until?.toLong(), after?.toLong() ?: 0L))
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

      Function("areNotificationsEnabled") {
        Notices.areEnabled(requireContext())
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

      AsyncFunction("requeueCiphertexts") { ids: List<Double>, error: String? ->
        TrackingRuntime
          .ciphertextQueue(requireContext())
          .requeue(ids.map { it.toLong() }, System.currentTimeMillis(), error)
      }
    }

  private fun requireContext() =
    appContext.reactContext ?: throw IllegalStateException("React context is unavailable.")

  private fun Map<String, Any?>.stringValue(key: String): String? = this[key]?.toString()

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
      "queuedAt" to queuedAt.toDouble(),
      "attemptCount" to attemptCount.toDouble(),
      "lastAttemptAt" to lastAttemptAt?.toDouble(),
      "lastError" to lastError,
      "status" to status,
    )

  companion object {
    private const val DEFAULT_KIND = "trackingPoint"
    private const val DEFAULT_PENDING_LIMIT = 100
  }
}
