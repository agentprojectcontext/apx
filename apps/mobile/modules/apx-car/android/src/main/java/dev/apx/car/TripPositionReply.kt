package dev.apx.car

/** A queued response can only change the trip and consent that produced it. */
internal object TripPositionReply {
  fun handle(active: Boolean, tripActive: Boolean, currentTrip: String, currentRevision: String,
    sentTrip: String, sentRevision: String, accepted: Boolean, revoke: () -> Unit, deliver: () -> Unit) {
    if (!active || !tripActive || sentTrip.isEmpty() || currentTrip != sentTrip || currentRevision != sentRevision) return
    if (accepted) deliver() else revoke()
  }
}
