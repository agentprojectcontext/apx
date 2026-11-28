package dev.apx.car

internal object TripPrivacyLease {
  fun privacyAllows(shareTrips: Boolean, revision: String, previous: String): Boolean =
    shareTrips && revision.isNotEmpty() && previous.isNotEmpty() && previous == revision

  fun accepts(shareTrips: Boolean, errands: Boolean, revision: String, previous: String, trip: String?, expected: String): Boolean =
    privacyAllows(shareTrips, revision, previous) && errands && expected.isNotEmpty() && trip == expected
}

/** A deadline expires an attempt, not the authority of a negative answer for the same trip session. */
internal class TripPrivacyChecks {
  private var session = 0L
  private var attempt = 0L
  private var pending = false
  data class Check(val session: Long, val attempt: Long)

  fun begin(): Check? {
    if (pending) return null
    pending = true
    return Check(session, ++attempt)
  }

  fun current(check: Check): Boolean = check.session == session
  fun finish(check: Check): Boolean {
    if (!current(check) || !pending || check.attempt != attempt) return false
    pending = false
    return true
  }

  fun cancel() {
    session++
    pending = false
  }
}
