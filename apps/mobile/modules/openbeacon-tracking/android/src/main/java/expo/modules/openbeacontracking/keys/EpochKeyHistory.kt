package expo.modules.openbeacontracking.keys

data class TimedEpochKey(
  val key: ProvisionedEpochKey,
  val sinceMillis: Long,
)

interface TimedEpochKeyStore {
  fun read(): List<TimedEpochKey>

  fun write(keys: List<TimedEpochKey>)
}

class InMemoryTimedEpochKeyStore : TimedEpochKeyStore {
  private var keys = emptyList<TimedEpochKey>()

  @Synchronized
  override fun read(): List<TimedEpochKey> = keys

  @Synchronized
  override fun write(keys: List<TimedEpochKey>) {
    this.keys = keys
  }
}

class EpochKeyHistory(
  private val store: EpochKeyStore,
  private val past: TimedEpochKeyStore,
  private val nowMillis: () -> Long = { System.currentTimeMillis() },
) : EpochKeyStore {
  override val revocations: Long
    get() = store.revocations

  @Synchronized
  override fun replaceAll(keys: List<ProvisionedEpochKey>) {
    store.replaceAll(keys)
    remember()
  }

  @Synchronized
  override fun revoke(groupIds: List<String>?) {
    store.revoke(groupIds)
    remember()
  }

  override fun list(): List<ProvisionedEpochKey> = store.list()

  @Synchronized
  fun keysAt(timeMillis: Long): List<ProvisionedEpochKey> {
    val known = past.read()
    return list().mapNotNull { key ->
      val group = known.filter { it.key.groupId == key.groupId }
      if (group.isEmpty()) key else group.filter { it.sinceMillis <= timeMillis }.maxByOrNull { it.sinceMillis }?.key
    }
  }

  private fun remember() {
    val now = nowMillis()
    val current = list()
    val known = past.read().filter { entry -> current.any { it.groupId == entry.key.groupId } }
    val updated =
      known.map { entry -> current.find { it.groupId == entry.key.groupId && it.epochId == entry.key.epochId }?.let { entry.copy(key = it) } ?: entry } +
        current.mapNotNull { key ->
          val group = known.filter { it.key.groupId == key.groupId }
          when {
            group.isEmpty() -> TimedEpochKey(key, Long.MIN_VALUE)
            group.any { it.key.epochId == key.epochId } -> null
            else -> TimedEpochKey(key, now)
          }
        }
    past.write(
      updated.filterNot { entry ->
        updated.any { it.key.groupId == entry.key.groupId && it.sinceMillis > entry.sinceMillis && it.sinceMillis < now - KEEP_MILLIS }
      },
    )
  }

  companion object {
    const val KEEP_MILLIS = 30L * 60_000
  }
}
