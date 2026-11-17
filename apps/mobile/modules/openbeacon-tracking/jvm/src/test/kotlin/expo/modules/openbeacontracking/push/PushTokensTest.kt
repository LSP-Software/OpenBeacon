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
    assertEquals(PushTokens.Forgotten(clearOnServer = true, deleteToken = true), tokens.forget(scope))
    assertNull(tokens.pending(scope))
    assertEquals(PushTokenState(), store.state)
    assertEquals(PushTokens.Forgotten(clearOnServer = false, deleteToken = false), tokens.forget(scope))
  }

  @Test
  fun signingOutBeforeTheTokenReachedTheServerOnlyDeletesIt() {
    registered()
    assertEquals(PushTokens.Forgotten(clearOnServer = false, deleteToken = true), tokens.forget(scope))
  }

  @Test
  fun aPhoneThatNeverUsedPushLeavesFirebaseAlone() {
    tokens.confirm(scope, null, pushAvailable = false)
    assertEquals(PushTokens.Forgotten(clearOnServer = false, deleteToken = false), tokens.forget(scope))
  }

  @Test
  fun aTokenArrivingAfterSigningOutIsIgnored() {
    val requested = assertNotNull(tokens.confirm(scope, null, pushAvailable = true))
    tokens.forget(scope)
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
    tokens.forget(scope)
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
}
