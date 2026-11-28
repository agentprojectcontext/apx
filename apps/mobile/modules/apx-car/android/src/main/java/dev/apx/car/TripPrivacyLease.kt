package dev.apx.car

internal object TripPrivacyLease {
  fun accepts(shareTrips: Boolean, errands: Boolean, revision: String, previous: String, trip: String?, expected: String): Boolean =
    shareTrips && errands && revision.isNotEmpty() && expected.isNotEmpty() && trip == expected &&
      previous.isNotEmpty() && previous == revision
}
