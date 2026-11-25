package net.openbeacon.speedlimits

sealed interface MaxSpeed {
  data class Speed(val tenthsKmh: Int) : MaxSpeed

  data object NoLimit : MaxSpeed

  data class Implicit(val value: String) : MaxSpeed

  data object Invalid : MaxSpeed
}

private const val KMH_PER_MPH = 1.609344
private const val KMH_PER_KNOT = 1.852
private const val HIGHEST_PLAUSIBLE_KMH = 300.0

private val speedPattern = Regex("""^(\d{1,3}(?:\.\d+)?)\s*(km/h|kmh|kph|mph|knots)?$""")
private val implicitPattern = Regex("""^[A-Z]{2}(?:-[A-Z0-9]{1,3})?:[a-z_]+$""")

fun parseMaxSpeed(raw: String): MaxSpeed {
  val value = raw.trim()

  if (value == "none") {
    return MaxSpeed.NoLimit
  }
  if (implicitPattern.matches(value)) {
    return MaxSpeed.Implicit(value)
  }

  val match = speedPattern.matchEntire(value) ?: return MaxSpeed.Invalid
  val number = match.groupValues[1].toDouble()
  val kmh =
    when (match.groupValues[2]) {
      "mph" -> number * KMH_PER_MPH
      "knots" -> number * KMH_PER_KNOT
      else -> number
    }

  return if (kmh <= 0 || kmh > HIGHEST_PLAUSIBLE_KMH) MaxSpeed.Invalid else MaxSpeed.Speed(Math.round(kmh * 10).toInt())
}
