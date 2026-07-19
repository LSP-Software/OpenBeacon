package expo.modules.openbeacontracking.capture

data class BatterySnapshot(
  val level: Int,
  val charging: Boolean,
  val powerSaveMode: Boolean,
  val levelKnown: Boolean,
)
