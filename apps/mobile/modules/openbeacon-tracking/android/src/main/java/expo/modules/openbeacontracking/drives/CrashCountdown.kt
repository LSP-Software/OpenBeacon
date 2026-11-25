package expo.modules.openbeacontracking.drives

enum class CrashCountdownPhase {
  COUNTING,
  SENT,
  CANCELLED,
  SAID_OK,
  TEST_FINISHED,
}

data class CrashCountdown(
  val suspicion: CrashSuspicion,
  val test: Boolean,
  val startedMillis: Long,
  val phase: CrashCountdownPhase,
) {
  val endsAtMillis: Long
    get() = startedMillis + if (test) TEST_MILLIS else REAL_MILLIS

  fun secondsLeft(nowMillis: Long): Int = ((endsAtMillis - nowMillis + 999) / 1_000).coerceAtLeast(0).toInt()

  fun tick(nowMillis: Long): CrashCountdown =
    if (phase == CrashCountdownPhase.COUNTING && nowMillis >= endsAtMillis) finish() else this

  fun sendNow(): CrashCountdown = if (phase == CrashCountdownPhase.COUNTING) finish() else this

  fun imOk(): CrashCountdown =
    when (phase) {
      CrashCountdownPhase.COUNTING -> copy(phase = CrashCountdownPhase.CANCELLED)
      CrashCountdownPhase.SENT -> copy(phase = CrashCountdownPhase.SAID_OK)
      else -> this
    }

  fun save(): String =
    listOf(
      FORMAT,
      phase.name,
      test.toString(),
      startedMillis.toString(),
      suspicion.timeMillis.toString(),
      suspicion.latitude.toString(),
      suspicion.longitude.toString(),
      suspicion.speedBefore.toString(),
    ).joinToString("|")

  private fun finish() = copy(phase = if (test) CrashCountdownPhase.TEST_FINISHED else CrashCountdownPhase.SENT)

  companion object {
    const val REAL_MILLIS = 60_000L
    const val TEST_MILLIS = 10_000L
    private const val FORMAT = "crash-countdown-1"

    fun start(
      suspicion: CrashSuspicion,
      test: Boolean,
      nowMillis: Long,
    ) = CrashCountdown(suspicion, test, nowMillis, CrashCountdownPhase.COUNTING)

    fun restore(saved: String): CrashCountdown? {
      val parts = saved.split("|")
      if (parts.size != 8 || parts[0] != FORMAT) return null
      return CrashCountdown(
        suspicion =
          CrashSuspicion(
            timeMillis = parts[4].toLongOrNull() ?: return null,
            latitude = parts[5].toDoubleOrNull() ?: return null,
            longitude = parts[6].toDoubleOrNull() ?: return null,
            speedBefore = parts[7].toDoubleOrNull() ?: return null,
          ),
        test = parts[2].toBooleanStrictOrNull() ?: return null,
        startedMillis = parts[3].toLongOrNull() ?: return null,
        phase = CrashCountdownPhase.entries.firstOrNull { it.name == parts[1] } ?: return null,
      )
    }
  }
}
