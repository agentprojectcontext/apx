package dev.agentprojectcontext.apx;

import java.net.URI;

final class DaemonAddress {
    private DaemonAddress() {}

    static String normalize(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) throw new IllegalArgumentException("Ingresá URL del daemon.");
        if (!value.contains("://")) value = "http://" + value;
        URI uri;
        try {
            uri = URI.create(value);
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException("URL inválida.");
        }
        String scheme = uri.getScheme();
        if (!("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))) {
            throw new IllegalArgumentException("Usá URL http:// o https://.");
        }
        if (uri.getHost() == null || uri.getHost().isBlank()) {
            throw new IllegalArgumentException("URL sin host.");
        }
        int port = uri.getPort();
        String authority = uri.getHost() + (port >= 0 ? ":" + port : "");
        return scheme.toLowerCase() + "://" + authority;
    }

    static String webSocketUrl(String baseUrl, String token) {
        String scheme = baseUrl.startsWith("https://") ? "wss://" : "ws://";
        String host = baseUrl.replaceFirst("^https?://", "");
        return scheme + host + "/api/events/ws?token=" + android.net.Uri.encode(token);
    }
}
