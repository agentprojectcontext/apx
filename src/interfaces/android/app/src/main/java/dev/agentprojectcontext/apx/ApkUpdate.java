package dev.agentprojectcontext.apx;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import android.util.Log;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * The app updating itself.
 *
 * APX is not on Play, so nothing else is going to tell this phone it is out of
 * date or hand it a new version. Without this the only way to update was to
 * open a browser, find the release, download an APK and tap it — for an app
 * that is already on screen, already talking to the daemon that knows the
 * answer.
 *
 * THE DAEMON IS ASKED, NOT GITHUB. It is the only thing this app ever talks to,
 * it caches the answer for every phone paired to it, and the comparison
 * ("is 0.10.0 newer than 0.9.0") lives there in one implementation instead of a
 * second one written in Java. See src/host/daemon/api/android.js.
 *
 * NOTHING IS INSTALLED SILENTLY. The APK is downloaded, checksummed, and handed
 * to Android's own installer, which shows its own screen and — the first time —
 * makes the owner allow this source by hand. That prompt cannot be skipped
 * outside Play, and it is the right prompt: an app that can replace itself
 * without being asked is an app that can replace itself with anything.
 */
final class ApkUpdate {
    private static final String TAG = "APXUpdate";

    /** Where the download lands. Must match res/xml/file_paths.xml. */
    private static final String CACHE_DIR = "updates";
    private static final String FILE_NAME = "apx.apk";

    /** What the daemon says is published, and whether it beats what is here. */
    record Available(String version, int versionCode, String url, String sha256, long size,
                     boolean updateAvailable) {}

    interface CheckCallback {
        void onChecked(Available available);
        /** Could not find out. NEVER rendered as "you are up to date". */
        void onCheckFailed(String message);
    }

    interface DownloadCallback {
        /** -1 when the server did not say how big it is. */
        void onProgress(int percent);
        void onDownloaded(File apk);
        void onDownloadFailed(String message);
    }

    private ApkUpdate() {}

    /**
     * Ask the daemon what is published.
     *
     * `installed` goes along so the daemon answers the actual question rather
     * than two numbers to compare here.
     *
     * `force` ONLY when the owner pressed the row. It makes the daemon skip its
     * cache and go to GitHub, which is right when somebody is standing there
     * waiting and wrong on every other call: the silent check runs on every
     * foregrounding, and forcing it there turned an hour-cached answer into a
     * GitHub round trip several times a day, per phone. That is slow enough to
     * lose the race against the menu opening — the row still said "Buscar
     * actualizaciones" twelve seconds in — and it spends an anonymous rate
     * limit of 60/hour that every paired phone shares.
     */
    static void check(String daemonUrl, String token, boolean force, CheckCallback callback) {
        if (daemonUrl == null || daemonUrl.isBlank() || token == null || token.isBlank()) {
            callback.onCheckFailed("Este teléfono todavía no está vinculado.");
            return;
        }
        HttpUrlBuilder url = new HttpUrlBuilder(daemonUrl + "/api/android/latest")
            .param("installed", BuildConfig.VERSION_NAME);
        if (force) url.param("force", "1");
        Request request = new Request.Builder()
            .url(url.toString())
            .header("Authorization", "Bearer " + token)
            .get()
            .build();
        DaemonClient.HTTP.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException error) {
                callback.onCheckFailed("No pude hablar con el daemon: " + error.getMessage());
            }

            @Override
            public void onResponse(Call call, Response response) {
                try (response) {
                    String body = response.body() == null ? "" : response.body().string();
                    if (response.code() == 503) {
                        callback.onCheckFailed("El daemon no pudo consultar la release.");
                        return;
                    }
                    if (!response.isSuccessful()) {
                        callback.onCheckFailed("El daemon respondió HTTP " + response.code());
                        return;
                    }
                    JSONObject json = new JSONObject(body);
                    callback.onChecked(new Available(
                        json.optString("version", ""),
                        json.optInt("version_code", 0),
                        json.optString("url", ""),
                        json.isNull("sha256") ? "" : json.optString("sha256", ""),
                        json.optLong("size", 0),
                        json.optBoolean("update_available", false)
                    ));
                } catch (Exception error) {
                    callback.onCheckFailed("Respuesta inválida: " + error.getMessage());
                }
            }
        });
    }

    /**
     * Fetch the APK into the app's cache, checking it against the published
     * digest.
     *
     * The digest is not decoration. This file is about to be handed to the
     * system installer as a replacement for APX itself; a truncated download
     * fails the signature check with a message nobody can act on, and anything
     * worse should never get that far. A release with no published sha256 (the
     * ones built before the workflow emitted one) is downloaded unverified —
     * Android's own signature check is still the thing that actually protects
     * the install.
     */
    static void download(Context context, Available available, DownloadCallback callback) {
        File dir = new File(context.getCacheDir(), CACHE_DIR);
        if (!dir.exists() && !dir.mkdirs()) {
            callback.onDownloadFailed("No pude crear la carpeta de descarga.");
            return;
        }
        File apk = new File(dir, FILE_NAME);

        Request request = new Request.Builder().url(available.url()).get().build();
        DaemonClient.HTTP.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException error) {
                callback.onDownloadFailed("No pude bajar el APK: " + error.getMessage());
            }

            @Override
            public void onResponse(Call call, Response response) {
                try (response) {
                    if (!response.isSuccessful()) {
                        callback.onDownloadFailed("La descarga respondió HTTP " + response.code());
                        return;
                    }
                    ResponseBody body = response.body();
                    if (body == null) {
                        callback.onDownloadFailed("La descarga vino vacía.");
                        return;
                    }
                    long total = body.contentLength() > 0 ? body.contentLength() : available.size();
                    MessageDigest sha = MessageDigest.getInstance("SHA-256");
                    long read = 0;
                    int lastPercent = -1;
                    try (InputStream in = body.byteStream();
                         FileOutputStream out = new FileOutputStream(apk)) {
                        byte[] buffer = new byte[64 * 1024];
                        int n;
                        while ((n = in.read(buffer)) != -1) {
                            out.write(buffer, 0, n);
                            sha.update(buffer, 0, n);
                            read += n;
                            if (total > 0) {
                                int percent = (int) (read * 100 / total);
                                // Only on change: a callback per 64 KB is a
                                // hundred UI posts a second for one number.
                                if (percent != lastPercent) {
                                    lastPercent = percent;
                                    callback.onProgress(percent);
                                }
                            } else if (lastPercent != -1) {
                                lastPercent = -1;
                                callback.onProgress(-1);
                            }
                        }
                    }

                    String expected = available.sha256();
                    if (expected != null && !expected.isBlank()) {
                        String actual = hex(sha.digest());
                        if (!actual.equalsIgnoreCase(expected)) {
                            //noinspection ResultOfMethodCallIgnored
                            apk.delete();
                            Log.w(TAG, "sha256 mismatch: " + actual + " != " + expected);
                            callback.onDownloadFailed("El APK bajado no coincide con el publicado.");
                            return;
                        }
                    }
                    callback.onDownloaded(apk);
                } catch (Exception error) {
                    callback.onDownloadFailed("Falló la descarga: " + error.getMessage());
                }
            }
        });
    }

    /**
     * Has the owner allowed APX to be a source of installs?
     *
     * A per-app switch since Android 8, and there is no way to install without
     * it. Asked before the download rather than after, so nobody waits for five
     * megabytes to land on a screen they are about to be bounced off.
     */
    static boolean canInstall(Context context) {
        return context.getPackageManager().canRequestPackageInstalls();
    }

    /** The system screen where that permission is granted, for THIS app. */
    static Intent unknownSourcesSettings(Context context) {
        return new Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:" + context.getPackageName())
        );
    }

    /**
     * Hand the file to Android's installer.
     *
     * A content:// URI through the FileProvider, not a path: sharing a file://
     * across app boundaries has thrown FileUriExposedException since Android 7.
     * The read grant rides on the intent and dies with it.
     */
    static Intent installIntent(Context context, File apk) {
        Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", apk);
        return new Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    }

    private static String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) out.append(String.format("%02x", b));
        return out.toString();
    }

    /** Tiny query-string builder — OkHttp's is fine but this keeps the call readable. */
    private static final class HttpUrlBuilder {
        private final StringBuilder url;
        private boolean first = true;

        HttpUrlBuilder(String base) {
            this.url = new StringBuilder(base);
        }

        HttpUrlBuilder param(String key, String value) {
            url.append(first ? '?' : '&').append(key).append('=').append(Uri.encode(value));
            first = false;
            return this;
        }

        @Override
        public String toString() {
            return url.toString();
        }
    }
}
