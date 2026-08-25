package dev.agentprojectcontext.apx;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class MapsShareIntentParser {
    private static final int MAX_TEXT_LENGTH = 2_000;
    private static final Pattern URL = Pattern.compile("https?://[^\\s]+", Pattern.CASE_INSENSITIVE);
    private static final Pattern LABELED_DESTINATION = Pattern.compile(
        "(?i)\\b(?:destino|destination|hacia|to)\\b\\s*[:：-]?\\s*([^\\n]+)"
    );

    private MapsShareIntentParser() {}

    static String destinationFrom(CharSequence value) {
        String text = normalize(value);
        if (text.isBlank()) return "";

        Matcher urls = URL.matcher(text);
        String firstMapsUrl = "";
        while (urls.find()) {
            String candidate = trimUrlPunctuation(urls.group());
            if (!isGoogleMapsUrl(candidate)) continue;
            if (firstMapsUrl.isBlank()) firstMapsUrl = candidate;
            String destination = queryParameter(candidate, "destination");
            if (!destination.isBlank()) return destination;
            destination = queryParameter(candidate, "query");
            if (!destination.isBlank()) return destination;
        }
        if (firstMapsUrl.isBlank()) return "";

        String withoutUrls = URL.matcher(text).replaceAll("").trim();
        Matcher labeled = LABELED_DESTINATION.matcher(withoutUrls);
        if (labeled.find()) {
            String destination = labeled.group(1).trim();
            if (!destination.isBlank()) return destination;
        }
        return firstMapsUrl;
    }

    static boolean isGoogleMapsShare(CharSequence value) {
        String text = normalize(value);
        Matcher urls = URL.matcher(text);
        while (urls.find()) {
            if (isGoogleMapsUrl(trimUrlPunctuation(urls.group()))) return true;
        }
        return false;
    }

    private static String normalize(CharSequence value) {
        if (value == null) return "";
        String text = value.toString().trim();
        return text.length() <= MAX_TEXT_LENGTH ? text : text.substring(0, MAX_TEXT_LENGTH);
    }

    private static boolean isGoogleMapsUrl(String value) {
        try {
            String host = URI.create(value).getHost();
            if (host == null) return false;
            host = host.toLowerCase(Locale.ROOT);
            return host.equals("maps.app.goo.gl")
                || host.equals("maps.google.com")
                || host.equals("www.google.com")
                || host.equals("google.com")
                || host.equals("goo.gl");
        } catch (IllegalArgumentException ignored) {
            return false;
        }
    }

    private static String queryParameter(String value, String wanted) {
        try {
            String query = URI.create(value).getRawQuery();
            if (query == null) return "";
            for (String part : query.split("&")) {
                String[] pair = part.split("=", 2);
                if (pair.length != 2 || !wanted.equals(pair[0])) continue;
                return URLDecoder.decode(pair[1], StandardCharsets.UTF_8).trim();
            }
        } catch (IllegalArgumentException ignored) {}
        return "";
    }

    private static String trimUrlPunctuation(String value) {
        int end = value.length();
        while (end > 0 && ".,;!)]}".indexOf(value.charAt(end - 1)) >= 0) end--;
        return value.substring(0, end);
    }
}
