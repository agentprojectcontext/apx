package dev.apx.car

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TripPrivacyTest {
  @Test fun privacyDenialDoesNotNeedASettingsAnswer() {
    assertFalse(TripPrivacyLease.privacyAllows(false, "current", "current"))
    assertFalse(TripPrivacyLease.privacyAllows(true, "revoked", "old"))
    assertTrue(TripPrivacyLease.privacyAllows(true, "current", "current"))
  }

  @Test fun aLateDenialStillRevokesAfterDeadlineAndANewerAttempt() {
    val checks = TripPrivacyChecks()
    val first = requireNotNull(checks.begin())
    assertTrue(checks.finish(first)) // Deadline: keep the trip and permit the next check.
    val second = requireNotNull(checks.begin())
    assertTrue(checks.finish(second))
    assertTrue(checks.current(first)) // A late explicit denial still belongs to this trip.
    assertFalse(checks.finish(first)) // A late success must not authorize a location read.
    checks.cancel()
    assertFalse(checks.current(first))
    assertFalse(checks.current(second))
  }

  @Test fun aReplacedTripRejectsOldDenialsAndCompletions() {
    val checks = TripPrivacyChecks()
    val old = requireNotNull(checks.begin())
    checks.cancel()
    val current = requireNotNull(checks.begin())
    assertFalse(checks.current(old))
    assertFalse(checks.finish(old))
    assertTrue(checks.finish(current))
  }

  @Test fun currentConsentForTheCurrentTripIsRequired() {
    assertTrue(TripPrivacyLease.accepts(true, true, "current", "current", "trip", "trip"))
    assertFalse(TripPrivacyLease.accepts(false, true, "current", "current", "trip", "trip"))
    assertFalse(TripPrivacyLease.accepts(true, false, "current", "current", "trip", "trip"))
    assertFalse(TripPrivacyLease.accepts(true, true, "current", "current", null, "trip"))
    assertFalse(TripPrivacyLease.accepts(true, true, "current", "current", "old-trip", "trip"))
    assertFalse(TripPrivacyLease.accepts(true, true, "", "", "trip", "trip"))
  }

  @Test fun aRemoteOffThenOnCannotRearmAnOfflinePhoneEvenForANewTrip() {
    assertFalse(TripPrivacyLease.accepts(true, true, "revoked", "old", "new-trip", "new-trip"))
    assertTrue(TripPrivacyLease.accepts(true, true, "revoked", "revoked", "new-trip", "new-trip"))
  }

  @Test fun existingPhonesRequireExplicitLocalConsentBeforeAdoptingAChangedLease() {
    assertFalse(TripPrivacyLease.accepts(true, true, "current", "", "trip", "trip"))
    assertFalse(TripPrivacyLease.accepts(false, true, "current", "", "trip", "trip"))
  }
}
