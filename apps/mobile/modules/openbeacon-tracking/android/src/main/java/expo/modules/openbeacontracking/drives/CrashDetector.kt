package expo.modules.openbeacontracking.drives

import kotlin.math.abs

data class CrashSuspicion(
  val timeMillis: Long,
  val latitude: Double,
  val longitude: Double,
  val speedBefore: Double,
)

class CrashDetector {
  private data class SeenFix(
    val fix: DriveFix,
    val inDrive: Boolean,
  )

  private val fixes = ArrayDeque<SeenFix>()
  private val spikes = mutableListOf<Long>()
  private var quietUntilMillis = Long.MIN_VALUE

  @Synchronized
  fun onFix(
    fix: DriveFix,
    inDrive: Boolean,
  ): CrashSuspicion? {
    val accuracy = fix.accuracy
    if (accuracy == null || accuracy > DriveDetector.MAX_ACCURACY_METERS || fix.speed == null) return null
    if (fixes.isNotEmpty() && fix.timeMillis <= fixes.last().fix.timeMillis) return null
    fixes.addLast(SeenFix(fix, inDrive))
    while (fix.timeMillis - fixes.first().fix.timeMillis > KEEP_FIXES_MILLIS) fixes.removeFirst()
    return evaluate()
  }

  @Synchronized
  fun onMotion(
    timeMillis: Long,
    magnitude: Double,
  ): CrashSuspicion? {
    if (magnitude < SPIKE_MAGNITUDE || timeMillis < quietUntilMillis) return null
    if (spikes.any { abs(it - timeMillis) <= SETTLE_MILLIS }) return null
    spikes += timeMillis
    spikes.sort()
    if (spikes.size > MAX_PENDING_SPIKES) spikes.removeAt(0)
    return evaluate()
  }

  @Synchronized
  fun reset() {
    fixes.clear()
    spikes.clear()
    quietUntilMillis = Long.MIN_VALUE
  }

  private fun evaluate(): CrashSuspicion? {
    val latest = fixes.lastOrNull()?.fix?.timeMillis ?: return null
    for (spike in spikes.toList()) {
      if (latest < spike) continue
      val outcome = judge(spike, latest)
      if (outcome == Outcome.WAIT) continue
      spikes.remove(spike)
      if (outcome is Outcome.Crash) {
        spikes.clear()
        quietUntilMillis = spike + QUIET_AFTER_MILLIS
        return outcome.suspicion
      }
    }
    return null
  }

  private sealed interface Outcome {
    data object WAIT : Outcome

    data object DROP : Outcome

    data class Crash(
      val suspicion: CrashSuspicion,
    ) : Outcome
  }

  private fun judge(
    spike: Long,
    latest: Long,
  ): Outcome {
    if (spike < quietUntilMillis) return Outcome.DROP
    val gate = fixes.lastOrNull { it.fix.timeMillis <= spike } ?: return Outcome.DROP
    val maxAge = if (gate.fix.batterySaver) BATTERY_SAVER_GATE_AGE_MILLIS else GATE_AGE_MILLIS
    if (!gate.inDrive || (gate.fix.speed ?: 0.0) < GATE_SPEED || spike - gate.fix.timeMillis > maxAge) return Outcome.DROP
    val after = fixes.filter { it.fix.timeMillis > spike + SETTLE_MILLIS }
    if (after.any { (it.fix.speed ?: 0.0) >= STILL_SPEED }) return Outcome.DROP
    val confirming = after.firstOrNull { it.fix.timeMillis >= spike + STILL_MILLIS }
    if (confirming == null) return if (latest > spike + GIVE_UP_MILLIS) Outcome.DROP else Outcome.WAIT
    if (confirming.fix.timeMillis > spike + GIVE_UP_MILLIS) return Outcome.DROP
    val spot = after.first().fix
    return Outcome.Crash(
      CrashSuspicion(timeMillis = spike, latitude = spot.latitude, longitude = spot.longitude, speedBefore = gate.fix.speed ?: 0.0),
    )
  }

  companion object {
    const val GATE_SPEED = 40 / 3.6
    const val SPIKE_MAGNITUDE = 4 * 9.80665
    const val GATE_AGE_MILLIS = 5_000L
    const val BATTERY_SAVER_GATE_AGE_MILLIS = 25_000L
    const val SETTLE_MILLIS = 3_000L
    const val STILL_SPEED = 2.0
    const val STILL_MILLIS = 15_000L
    const val GIVE_UP_MILLIS = 60_000L
    const val QUIET_AFTER_MILLIS = 300_000L
    private const val KEEP_FIXES_MILLIS = 120_000L
    private const val MAX_PENDING_SPIKES = 32
  }
}
