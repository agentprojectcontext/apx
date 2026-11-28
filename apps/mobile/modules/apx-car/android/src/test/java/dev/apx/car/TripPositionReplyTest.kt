package dev.apx.car

import org.junit.Assert.assertEquals
import org.junit.Test

class TripPositionReplyTest {
  private fun reply(active: Boolean = true, tripActive: Boolean = true, trip: String = "trip",
    revision: String = "consent", accepted: Boolean = false): List<String> {
    val effects = mutableListOf<String>()
    TripPositionReply.handle(active, tripActive, trip, revision, "trip", "consent", accepted,
      revoke = { effects.add("revoke") }, deliver = { effects.add("deliver") })
    return effects
  }

  @Test fun aQueuedFailureAfterNormalTripEndDoesNotRevokeConsent() {
    assertEquals(emptyList<String>(), reply(tripActive = false))
    assertEquals(emptyList<String>(), reply(trip = ""))
  }

  @Test fun aReplyFromThePreviousTripCannotStopOrNotifyANewTrip() {
    for (accepted in listOf(false, true)) {
      assertEquals(emptyList<String>(), reply(trip = "new-trip", accepted = accepted))
      assertEquals(emptyList<String>(), reply(revision = "new-consent", accepted = accepted))
      assertEquals(emptyList<String>(), reply(active = false, accepted = accepted))
    }
  }

  @Test fun currentTripFailureStillRevokesAndSuccessStillDelivers() {
    assertEquals(listOf("revoke"), reply())
    assertEquals(listOf("deliver"), reply(accepted = true))
  }
}
