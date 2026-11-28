package dev.apx.car

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TripPrivacyTest {
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
