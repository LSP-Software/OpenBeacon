package expo.modules.openbeacontracking.push

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PushTokensTest {
  private val scope = "[\"https://api.openbeacon.net\",\"user-1\",\"device-1\"]"

  private class MemoryStore : PushTokenStore {
    var state = PushTokenState()
    var saves = 0

    override fun load() = state

    override fun save(state: PushTokenState) {
      this.state = state
      saves += 1
    }
  }

  private var now = 1_000_000L
  private val store = MemoryStore()
  private val tokens = PushTokens(store) { now }

  private fun registered(token: String = "token-1") {
    assertNotNull(tokens.confirm(scope, null, pushAvailable = true))
    assertTrue(tokens.receive(token))
  }

  @Test
  fun asksForATokenOnlyOnceTheServerSaysPushIsAvailable() {
    assertNull(tokens.confirm(scope, null, pushAvailable = false))
    assertNull(tokens.pending(scope))
    assertNotNull(tokens.confirm(scope, null, pushAvailable = true))
  }

  @Test
  fun aNewTokenStartsAnUploadAndRidesTheNextOne() {
    registered()
    assertEquals("token-1", tokens.pending(scope))
  }

  @Test
  fun theTokenIsKeptUntilAnUploadCarryingItSucceeds() {
    registered()
    assertEquals("token-1", tokens.pending(scope))
    assertEquals("token-1", tokens.pending(scope))
    tokens.confirm(scope, null, pushAvailable = true)
    assertEquals("token-1", tokens.pending(scope))
    tokens.confirm(scope, "token-1", pushAvailable = true)
    assertNull(tokens.pending(scope))
  }

  @Test
  fun aRefreshedTokenIsSentEvenIfAnOlderOneWasConfirmedMeanwhile() {
    registered()
    assertTrue(tokens.receive("token-2"))
    tokens.confirm(scope, "token-1", pushAvailable = true)
    assertEquals("token-2", tokens.pending(scope))
  }

  @Test
  fun theSameTokenTwiceStartsOneUpload() {
    registered()
    assertFalse(tokens.receive("token-1"))
  }

  @Test
  fun nothingIsResentToAServerWithoutPush() {
    registered()
    tokens.confirm(scope, "token-1", pushAvailable = false)
    assertNull(tokens.pending(scope))
    assertFalse(tokens.receive("token-2"))
    assertNull(tokens.pending(scope))
  }

  @Test
  fun aServerThatTurnsOnPushGetsTheTokenAgain() {
    registered()
    tokens.confirm(scope, "token-1", pushAvailable = false)
    tokens.confirm(scope, null, pushAvailable = true)
    assertEquals("token-1", tokens.pending(scope))
  }

  @Test
  fun aFailedTokenFetchIsRetriedAtMostHourly() {
    assertNotNull(tokens.confirm(scope, null, pushAvailable = true))
    now += PushTokens.TOKEN_RETRY_MS - 1
    assertNull(tokens.confirm(scope, null, pushAvailable = true))
    now += 1
    assertNotNull(tokens.confirm(scope, null, pushAvailable = true))
  }

  @Test
  fun aNewDeviceRegistrationSendsTheTokenAgainOnceItsServerHasPush() {
    registered()
    tokens.confirm(scope, "token-1", pushAvailable = true)
    val next = "[\"https://api.openbeacon.net\",\"user-1\",\"device-2\"]"
    assertNull(tokens.pending(next))
    assertNull(tokens.confirm(next, null, pushAvailable = true))
    assertEquals("token-1", tokens.pending(next))
  }

  @Test
  fun noTokenIsSentBeforeTheServerSaysItHasPush() {
    registered()
    val next = "[\"https://self-hosted.example\",\"user-1\",\"device-2\"]"
    assertNull(tokens.pending(next))
    tokens.confirm(next, null, pushAvailable = false)
    assertNull(tokens.pending(next))
  }

  @Test
  fun signingOutClearsTheServerOnlyWhenItHoldsTheToken() {
    registered()
    tokens.confirm(scope, "token-1", pushAvailable = true)
    assertEquals(PushTokens.Forgotten(clearOnServer = true, deleteToken = true), tokens.forget(scope, autoInitEnabled = false))
    assertNull(tokens.pending(scope))
    assertEquals(PushTokenState(), store.state)
    assertEquals(PushTokens.Forgotten(clearOnServer = false, deleteToken = false), tokens.forget(scope, autoInitEnabled = false))
  }

  @Test
  fun signingOutBeforeTheTokenReachedTheServerOnlyDeletesIt() {
    registered()
    assertEquals(PushTokens.Forgotten(clearOnServer = false, deleteToken = true), tokens.forget(scope, autoInitEnabled = false))
  }

  @Test
  fun aPhoneThatNeverUsedPushLeavesFirebaseAlone() {
    tokens.confirm(scope, null, pushAvailable = false)
    assertEquals(PushTokens.Forgotten(clearOnServer = false, deleteToken = false), tokens.forget(scope, autoInitEnabled = false))
  }

  @Test
  fun signingOutAfterARestartDeletesATokenFirebaseMayStillBeFetching() {
    assertNotNull(tokens.confirm(scope, null, pushAvailable = true))
    val restarted = PushTokens(store) { now }
    assertEquals(PushTokens.Forgotten(clearOnServer = false, deleteToken = true), restarted.forget(scope, autoInitEnabled = true))
  }

  @Test
  fun aTokenArrivingAfterSigningOutIsIgnored() {
    val requested = assertNotNull(tokens.confirm(scope, null, pushAvailable = true))
    tokens.forget(scope, autoInitEnabled = false)
    assertFalse(tokens.receive("token-1", requested))
    assertFalse(tokens.receive("token-1"))
    val next = "[\"https://api.openbeacon.net\",\"user-2\",\"device-3\"]"
    assertNull(tokens.pending(next))
    assertNotNull(tokens.confirm(next, null, pushAvailable = true))
    assertNull(tokens.pending(next))
  }

  @Test
  fun aTokenFromTheLastAccountsRequestIsIgnoredByTheNextAccount() {
    val old = assertNotNull(tokens.confirm(scope, null, pushAvailable = true))
    tokens.forget(scope, autoInitEnabled = false)
    val next = "[\"https://api.openbeacon.net\",\"user-2\",\"device-3\"]"
    val current = assertNotNull(tokens.confirm(next, null, pushAvailable = true))
    assertFalse(tokens.receive("token-old", old))
    assertTrue(tokens.receive("token-new", current))
    assertEquals("token-new", tokens.pending(next))
  }

  @Test
  fun stateSurvivesARestart() {
    registered()
    tokens.confirm(scope, "token-1", pushAvailable = true)
    val restarted = PushTokens(store) { now }
    assertNull(restarted.pending(scope))
    assertTrue(restarted.receive("token-2"))
    assertEquals("token-2", restarted.pending(scope))
  }

  @Test
  fun unchangedResponsesDontRewriteTheStore() {
    registered()
    tokens.confirm(scope, "token-1", pushAvailable = true)
    val saves = store.saves
    tokens.confirm(scope, null, pushAvailable = true)
    tokens.confirm(scope, "token-1", pushAvailable = true)
    assertEquals(saves, store.saves)
  }

  @Test
  fun statusFollowsTheTokenFromFetchToServer() {
    assertEquals(PushTokens.Status(serverPush = null, registration = PushTokens.Registration.NO_TOKEN), tokens.status(scope))
    registered()
    assertEquals(PushTokens.Status(serverPush = true, registration = PushTokens.Registration.NOT_SENT), tokens.status(scope))
    tokens.confirm(scope, "token-1", pushAvailable = true)
    assertEquals(PushTokens.Status(serverPush = true, registration = PushTokens.Registration.REGISTERED), tokens.status(scope))
    tokens.receive("token-2")
    assertEquals(PushTokens.Registration.NOT_SENT, tokens.status(scope).registration)
  }

  @Test
  fun statusForAnotherDeviceDoesntBorrowTheLastServersAnswer() {
    registered()
    tokens.confirm(scope, "token-1", pushAvailable = true)
    val next = "[\"https://self-hosted.example\",\"user-1\",\"device-2\"]"
    assertEquals(PushTokens.Status(serverPush = null, registration = PushTokens.Registration.NOT_SENT), tokens.status(next))
  }

  @Test
  fun aWakeIsRecordedWithItsTimeAndKindForThatAccount() {
    registered()
    tokens.recordWake("locate")
    val status = tokens.status(scope)
    assertEquals(now, status.lastWakeAt)
    assertEquals("locate", status.lastWakeKind)
  }

  @Test
  fun anotherAccountDoesntSeeTheLastWake() {
    registered()
    tokens.recordWake("sync")
    val next = "[\"https://api.openbeacon.net\",\"user-2\",\"device-3\"]"
    assertNull(tokens.status(next).lastWakeAt)
    assertNull(tokens.status(next).lastWakeKind)
    tokens.confirm(next, null, pushAvailable = true)
    assertNull(tokens.status(next).lastWakeAt)
    assertNull(tokens.status(scope).lastWakeAt)
  }

  @Test
  fun noWakeIsRecordedWithoutAnAccount() {
    tokens.recordWake("sync")
    assertEquals(PushTokenState(), store.state)
    assertEquals(0, store.saves)
  }

  @Test
  fun signingOutClearsTheLastWakeAndIgnoresLaterOnes() {
    registered()
    tokens.recordWake("sync")
    tokens.forget(scope, autoInitEnabled = false)
    assertEquals(PushTokenState(), store.state)
    tokens.recordWake("locate")
    assertEquals(PushTokenState(), store.state)
    assertNull(tokens.status(scope).lastWakeAt)
  }

  @Test
  fun theLastWakeSurvivesARestartAndTokenChanges() {
    registered()
    tokens.recordWake("locate")
    val at = now
    now += 1_000
    val restarted = PushTokens(store) { now }
    restarted.confirm(scope, "token-1", pushAvailable = true)
    assertTrue(restarted.receive("token-2"))
    restarted.confirm(scope, "token-2", pushAvailable = false)
    val status = restarted.status(scope)
    assertEquals(at, status.lastWakeAt)
    assertEquals("locate", status.lastWakeKind)
  }

  @Test
  fun forgettingWithoutAScopeClearsEverythingButLeavesTheServerAlone() {
    registered()
    tokens.confirm(scope, "token-1", pushAvailable = true)
    tokens.recordWake("sync")
    assertEquals(PushTokens.Forgotten(clearOnServer = false, deleteToken = true), tokens.forget(null, autoInitEnabled = false))
    assertEquals(PushTokenState(), store.state)
    assertEquals(PushTokens.Status(serverPush = null, registration = PushTokens.Registration.NO_TOKEN), tokens.status(scope))
  }
}
