package expo.modules.openbeacontracking.capture

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class CaptureRefreshStateTest {
  @Test
  fun retainsARequestUntilTheFixHasBeenQueued() {
    val state = CaptureRefreshState()
    state.request()
    val attempt = state.pending()
    assertEquals(1L, attempt)
    assertEquals(attempt, state.pending())
    state.complete(requireNotNull(attempt))
    assertNull(state.pending())
  }

  @Test
  fun retainsARefreshRequestedDuringAnEarlierCapture() {
    val state = CaptureRefreshState()
    state.request()
    val first = requireNotNull(state.pending())
    state.request()
    state.complete(first)
    assertEquals(2L, state.pending())
    state.complete(requireNotNull(state.pending()))
    assertNull(state.pending())
    state.request()
    val stale = requireNotNull(state.pending())
    state.clear()
    assertNull(state.pending())
    state.request()
    state.complete(stale)
    assertEquals(4L, state.pending())
  }
}
