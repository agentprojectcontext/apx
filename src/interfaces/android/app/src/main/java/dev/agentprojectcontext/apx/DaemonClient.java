package dev.agentprojectcontext.apx;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import android.util.Log;

final class DaemonClient {
    private static final String TAG = "APXTravel";
    interface PairCallback {
        void onSuccess(String token);
        void onError(String message);
    }

    /** One row of "what APX is watching for on this trip". */
    /**
     * One errand on the current trip. `options` is how many shops could still
     * satisfy it — "buy bread" is a choice between supermarkets until the owner
     * settles it, and a list that hid that would be claiming a decision APX has
     * not made.
     */
    record TripPlace(
        String taskId,
        String place,
        String task,
        int distanceM,
        String mapsUrl,
        String addStopUrl,
        int options,
        boolean locked,
        String answer
    ) {}

    interface TripCallback {
        void onTrip(java.util.List<TripPlace> places);
        void onError(String message);
    }

    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");
    static final OkHttpClient HTTP = new OkHttpClient.Builder().retryOnConnectionFailure(true).build();

    private DaemonClient() {}

    static void pair(String daemonUrl, String pairingId, String label, PairCallback callback) {
        JSONObject payload = new JSONObject();
        try {
            payload.put("pairing_id", pairingId);
            payload.put("label", label);
            payload.put("kind", "android");
        } catch (JSONException error) {
            callback.onError("No pude preparar pairing.");
            return;
        }

        Request request = new Request.Builder()
            .url(daemonUrl + "/api/pair/confirm")
            .post(RequestBody.create(payload.toString(), JSON))
            .build();
        HTTP.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException error) {
                callback.onError("Daemon inaccesible: " + error.getMessage());
            }

            @Override
            public void onResponse(Call call, Response response) {
                try (response) {
                    String body = response.body() == null ? "" : response.body().string();
                    JSONObject json = body.isBlank() ? new JSONObject() : new JSONObject(body);
                    if (!response.isSuccessful()) {
                        callback.onError(json.optString("error", "HTTP " + response.code()));
                        return;
                    }
                    String token = json.optString("token", "");
                    if (token.isBlank()) {
                        callback.onError("Daemon no devolvió token.");
                        return;
                    }
                    callback.onSuccess(token);
                } catch (Exception error) {
                    callback.onError("Respuesta inválida: " + error.getMessage());
                }
            }
        });
    }

    /**
     * The errands APX is watching on the active trip, for the banner's list.
     * Read-only: asking never fires a reminder — see host/daemon/api/mobility.js.
     */
    static void fetchTripPlaces(String daemonUrl, String token, TripCallback callback) {
        if (daemonUrl == null || daemonUrl.isBlank() || token == null || token.isBlank()) {
            callback.onError("Este teléfono todavía no está vinculado.");
            return;
        }
        Request request = new Request.Builder()
            .url(daemonUrl + "/api/mobility/trip")
            .header("Authorization", "Bearer " + token)
            .get()
            .build();
        HTTP.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException error) {
                callback.onError("No pude hablar con el daemon: " + error.getMessage());
            }

            @Override
            public void onResponse(Call call, Response response) {
                try (response) {
                    String body = response.body() == null ? "" : response.body().string();
                    if (!response.isSuccessful()) {
                        callback.onError("El daemon respondió HTTP " + response.code());
                        return;
                    }
                    JSONObject json = new JSONObject(body);
                    org.json.JSONArray rows = json.optJSONArray("places");
                    java.util.List<TripPlace> places = new java.util.ArrayList<>();
                    for (int i = 0; rows != null && i < rows.length(); i++) {
                        JSONObject row = rows.optJSONObject(i);
                        if (row == null) continue;
                        places.add(new TripPlace(
                            row.optString("task_id", ""),
                            row.optString("place", ""),
                            row.optString("task", ""),
                            row.optInt("distance_m", -1),
                            row.optString("maps_url", ""),
                            row.optString("add_stop_url", ""),
                            row.optInt("options", 1),
                            row.optBoolean("locked", false),
                            row.isNull("answer") ? "" : row.optString("answer", "")
                        ));
                    }
                    callback.onTrip(places);
                } catch (Exception error) {
                    callback.onError("Respuesta inválida: " + error.getMessage());
                }
            }
        });
    }

    /**
     * Answer one errand from the phone's own list — the same "voy" / "hoy no"
     * the Telegram card asks, reaching the same record on the daemon. Silent
     * on success: the list has already redrawn optimistically, and a toast per
     * tap while driving is noise.
     */
    static void answerErrand(String daemonUrl, String token, String taskId, String answer, AnswerCallback callback) {
        if (daemonUrl == null || daemonUrl.isBlank() || token == null || token.isBlank()) {
            callback.onAnswerFailed("Este teléfono todavía no está vinculado.");
            return;
        }
        JSONObject payload = new JSONObject();
        try {
            payload.put("task_id", taskId);
            payload.put("answer", answer);
        } catch (JSONException error) {
            callback.onAnswerFailed("No pude preparar la respuesta.");
            return;
        }
        Request request = new Request.Builder()
            .url(daemonUrl + "/api/mobility/errands/answer")
            .header("Authorization", "Bearer " + token)
            .post(RequestBody.create(payload.toString(), JSON))
            .build();
        HTTP.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException error) {
                callback.onAnswerFailed("No pude hablar con el daemon: " + error.getMessage());
            }

            @Override
            public void onResponse(Call call, Response response) {
                try (response) {
                    if (response.isSuccessful()) callback.onAnswered();
                    else callback.onAnswerFailed("El daemon respondió HTTP " + response.code());
                }
            }
        });
    }

    interface AnswerCallback {
        void onAnswered();
        void onAnswerFailed(String message);
    }

    static void notifyTripStarted(String daemonUrl, String token, String tripId, String destination, DeviceLocation.Snapshot origin) {
        notifyTripEvent(daemonUrl, token, tripId, "trip.started", destination, origin, true);
    }

    static void notifyTripContext(String daemonUrl, String token, String tripId, String destination, DeviceLocation.Snapshot origin) {
        notifyTripEvent(daemonUrl, token, tripId, "trip.started", destination, origin, false);
    }

    static void notifyTripEnded(String daemonUrl, String token, String tripId) {
        notifyTripEvent(daemonUrl, token, tripId, "trip.ended", "", null, false);
    }

    /**
     * One GPS sample for a running trip. Fire-and-forget by design: the phone
     * is on mobile data in a moving car and a sample that fails to upload is
     * replaced by the next one 30 seconds later, so a retry queue would only
     * deliver stale positions. The daemon answers 202 before it evaluates
     * anything (host/daemon/api/mobility.js), so this call never waits on a
     * place search or a Telegram send.
     */
    static void reportPosition(String daemonUrl, String token, String tripId, android.location.Location location) {
        if (daemonUrl == null || daemonUrl.isBlank() || token == null || token.isBlank()) return;
        if (tripId == null || tripId.isBlank() || location == null) return;
        JSONObject payload = new JSONObject();
        try {
            payload.put("trip_id", tripId);
            payload.put("latitude", location.getLatitude());
            payload.put("longitude", location.getLongitude());
            if (location.hasAccuracy()) payload.put("accuracy_m", location.getAccuracy());
            if (location.hasSpeed()) payload.put("speed_mps", location.getSpeed());
            if (location.hasBearing()) payload.put("heading_deg", location.getBearing());
            payload.put("occurred_at", java.time.Instant.now().toString());
            payload.put("source", "android");
        } catch (JSONException error) {
            Log.w(TAG, "Could not prepare position", error);
            return;
        }

        Request request = new Request.Builder()
            .url(daemonUrl + "/api/mobility/positions")
            .header("Authorization", "Bearer " + token)
            .post(RequestBody.create(payload.toString(), JSON))
            .build();
        HTTP.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException error) {
                Log.w(TAG, "Could not send trip position: " + error.getMessage());
            }

            @Override
            public void onResponse(Call call, Response response) {
                try (response) {
                    if (!response.isSuccessful()) Log.w(TAG, "Position rejected: HTTP " + response.code());
                }
            }
        });
    }

    private static void notifyTripEvent(String daemonUrl, String token, String tripId, String type, String destination, DeviceLocation.Snapshot origin, boolean evaluate) {
        if (daemonUrl == null || daemonUrl.isBlank() || token == null || token.isBlank()) return;
        JSONObject payload = new JSONObject();
        try {
            payload.put("event_id", java.util.UUID.randomUUID().toString());
            payload.put("trip_id", tripId == null ? "" : tripId);
            payload.put("type", type);
            payload.put("occurred_at", java.time.Instant.now().toString());
            payload.put("destination", destination == null ? "" : destination);
            payload.put("evaluate", evaluate);
            if (origin != null) {
                JSONObject position = new JSONObject();
                position.put("latitude", origin.latitude());
                position.put("longitude", origin.longitude());
                position.put("accuracy_m", origin.accuracyMeters());
                position.put("age_ms", origin.ageMs());
                payload.put("origin", position);
            }
        } catch (JSONException error) {
            Log.w(TAG, "Could not prepare mobility event", error);
            return;
        }

        Request request = new Request.Builder()
            .url(daemonUrl + "/api/mobility/events")
            .header("Authorization", "Bearer " + token)
            .post(RequestBody.create(payload.toString(), JSON))
            .build();
        HTTP.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException error) {
                Log.w(TAG, "Could not send trip notification", error);
            }

            @Override
            public void onResponse(Call call, Response response) {
                try (response) {
                    if (response.isSuccessful()) Log.i(TAG, "Mobility event accepted by daemon: " + type);
                    else Log.w(TAG, "Mobility event rejected: HTTP " + response.code());
                }
            }
        });
    }
}
