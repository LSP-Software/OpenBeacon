package expo.modules.openbeacontracking.push

data class PushTokenState(
  val token: String? = null,
  val scope: String? = null,
  val sent: String? = null,
  val pushAvailable: Boolean? = null,
  val lastWakeAt: Long? = null,
  val lastWakeKind: String? = null,
)

interface PushTokenStore {
  fun load(): PushTokenState

  fun save(state: PushTokenState)
}

class PushTokens(
  private val store: PushTokenStore,
  private val clock: () -> Long,
) {
  private var cached: PushTokenState? = null
  private var lastRequestAt: Long? = null
  private var generation = 0L
  private var acceptingTokens = true

  @Synchronized
  fun pending(scope: String): String? {
    val slot = slot(scope)
    return slot.token?.takeIf { slot.pushAvailable == true && it != slot.sent }
  }

  @Synchronized
  fun status(scope: String): Status {
    val slot = slot(scope)
    val registration =
      when {
        slot.token == null -> Registration.NO_TOKEN
        slot.token == slot.sent -> Registration.REGISTERED
        else -> Registration.NOT_SENT
      }
    return Status(
      serverPush = slot.pushAvailable,
      registration = registration,
      lastWakeAt = slot.lastWakeAt,
      lastWakeKind = slot.lastWakeKind,
    )
  }

  @Synchronized
  fun recordWake(kind: String) {
    val current = state()
    if (current.scope == null) return
    update(current.copy(lastWakeAt = clock(), lastWakeKind = kind))
  }

  @Synchronized
  fun confirm(scope: String, sent: String?, pushAvailable: Boolean): Long? {
    val slot = slot(scope)
    update(slot.copy(pushAvailable = pushAvailable, sent = if (pushAvailable) sent ?: slot.sent else null))
    if (!pushAvailable || slot.token != null) return null
    val now = clock()
    if (lastRequestAt?.let { now - it < TOKEN_RETRY_MS } == true) return null
    lastRequestAt = now
    acceptingTokens = true
    return generation
  }

  @Synchronized
  fun receive(token: String, requested: Long? = null): Boolean {
    if (!acceptingTokens || (requested != null && requested != generation)) return false
    val current = state()
    if (current.token == token) return false
    update(current.copy(token = token))
    return current.scope != null && current.pushAvailable == true
  }

  @Synchronized
  fun forget(scope: String?, autoInitEnabled: Boolean): Forgotten {
    val current = state()
    val forgotten =
      Forgotten(
        clearOnServer = scope != null && current.scope == scope && current.pushAvailable == true && current.sent != null,
        deleteToken = autoInitEnabled || current.token != null || lastRequestAt != null,
      )
    update(PushTokenState())
    lastRequestAt = null
    generation += 1
    acceptingTokens = false
    return forgotten
  }

  data class Status(
    val serverPush: Boolean?,
    val registration: Registration,
    val lastWakeAt: Long? = null,
    val lastWakeKind: String? = null,
  )

  enum class Registration(val value: String) {
    NO_TOKEN("noToken"),
    NOT_SENT("notSent"),
    REGISTERED("registered"),
  }

  data class Forgotten(val clearOnServer: Boolean, val deleteToken: Boolean)

  private fun state(): PushTokenState = cached ?: store.load().also { cached = it }

  private fun slot(scope: String): PushTokenState =
    state().let { if (it.scope == scope) it else PushTokenState(token = it.token, scope = scope) }

  private fun update(next: PushTokenState) {
    if (next != state()) store.save(next)
    cached = next
  }

  companion object {
    const val TOKEN_RETRY_MS = 3_600_000L
  }
}
