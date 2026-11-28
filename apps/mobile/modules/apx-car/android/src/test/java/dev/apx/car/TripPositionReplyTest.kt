package dev.apx.car

import org.junit.Assert.assertEquals
import org.junit.Test

class TripPositionReplyTest {
  private fun reply(active: Boolean = true, tripActive: Boolean = true, trip: String = "trip",
    revision: String = "consent", accepted: Boolean = false,
    outcome: TripPositionReply.Outcome = if (accepted) TripPositionReply.Outcome.ACCEPTED else TripPositionReply.Outcome.REFUSED,
  ): List<String> {
    val effects = mutableListOf<String>()
    TripPositionReply.handle(active, tripActive, trip, revision, "trip", "consent", outcome,
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

  @Test fun currentTripRefusalStillRevokesAndSuccessStillDelivers() {
    assertEquals(listOf("revoke"), reply())
    assertEquals(listOf("deliver"), reply(accepted = true))
  }

  @Test fun noAnswerKeepsTheTripForTheNextPoint() {
    for (code in listOf("offline", "unavailable", "timeout", "internal")) {
      val outcome = TripPositionReply.outcome(null, code)
      assertEquals(TripPositionReply.Outcome.UNREACHABLE, outcome)
      assertEquals(emptyList<String>(), reply(outcome = outcome))
    }
  }

  @Test fun theCoreRefusingTheTripOrTheKeyStillRevokes() {
    assertEquals(TripPositionReply.Outcome.REFUSED, TripPositionReply.outcome(false, null))
    assertEquals(TripPositionReply.Outcome.REFUSED, TripPositionReply.outcome(null, "unauthorized"))
    assertEquals(TripPositionReply.Outcome.REFUSED, TripPositionReply.outcome(null, "bad_request"))
    assertEquals(TripPositionReply.Outcome.ACCEPTED, TripPositionReply.outcome(true, null))
    assertEquals(listOf("revoke"), reply(outcome = TripPositionReply.outcome(null, "unauthorized")))
  }
}
