package dev.agentprojectcontext.apx;

import androidx.annotation.NonNull;
import androidx.car.app.CarAppService;
import androidx.car.app.Session;
import androidx.car.app.Screen;
import androidx.car.app.validation.HostValidator;

/**
 * APX on the head unit — the chip in Android Auto's launcher, beside Maps and
 * whatever is playing music.
 *
 * WHY A CAR APP AND NOT A NOTIFICATION. Android Auto renders a MessagingStyle
 * notification with exactly two controls: reply and mark-as-read. That is the
 * shape of a chat, and a proximity alert is not one — it is four answers, and
 * the two of them that matter most ("Navegar ahora", "Sumar a la ruta") are
 * navigation actions a messaging card has no way to offer. The template
 * library is the only surface on this platform that draws four.
 *
 * It shows the trip: where the car is going, and the errands APX is watching
 * for along the way. When something comes into range the alert goes to the top
 * of that same list, so the driver's glance lands in one place instead of
 * hunting a banner that has already gone.
 *
 * NOTHING HERE PAINTS ANYTHING ITSELF. Templates are described and the host
 * draws them, which is what keeps the app legal to use while driving — the
 * platform enforces the reading limits, not us.
 */
public final class ApxCarAppService extends CarAppService {

    @Override
    @NonNull
    public HostValidator createHostValidator() {
        // Debug builds talk to the Desktop Head Unit, which is not a signed
        // Google host — pinning the production allowlist here would make the
        // whole feature untestable without a car. Release builds keep the
        // real check: an unvalidated host can drive the screen.
        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            return HostValidator.ALLOW_ALL_HOSTS_VALIDATOR;
        }
        return new HostValidator.Builder(getApplicationContext())
            .addAllowedHosts(androidx.car.app.R.array.hosts_allowlist_sample)
            .build();
    }

    @Override
    @NonNull
    public Session onCreateSession() {
        return new Session() {
            @Override
            @NonNull
            public Screen onCreateScreen(@NonNull android.content.Intent intent) {
                return new TripScreen(getCarContext());
            }
        };
    }
}
