package dev.apx.car

/** A queued response can only change the trip and consent that produced it. */
internal object TripPositionReply {
  /** What a position send got back: kept by the core, refused by it, or no answer at all. */
  enum class Outcome { ACCEPTED, REFUSED, UNREACHABLE }

  /** Core errors that say nothing about consent: the phone keeps the trip and its next point tries again. */
  private val TRANSIENT = setOf("offline", "unavailable", "timeout", "internal")

  /** No answer, as opposed to the core saying no: the owner's choice stands until they change it. */
  fun unreachable(errorCode: String?): Boolean = errorCode != null && errorCode in TRANSIENT

  fun outcome(result: Boolean?, errorCode: String?): Outcome = when {
    result == true -> Outcome.ACCEPTED
    result == false -> Outcome.REFUSED
    unreachable(errorCode) -> Outcome.UNREACHABLE
    else -> Outcome.REFUSED
  }

  fun handle(active: Boolean, tripActive: Boolean, currentTrip: String, currentRevision: String,
    sentTrip: String, sentRevision: String, outcome: Outcome, revoke: () -> Unit, deliver: () -> Unit) {
    if (!active || !tripActive || sentTrip.isEmpty() || currentTrip != sentTrip || currentRevision != sentRevision) return
    when (outcome) {
      Outcome.ACCEPTED -> deliver()
      Outcome.REFUSED -> revoke()
      Outcome.UNREACHABLE -> Unit
    }
  }
}
