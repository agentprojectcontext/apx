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

final class DaemonClient {
    interface PairCallback {
        void onSuccess(String token);
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
}
