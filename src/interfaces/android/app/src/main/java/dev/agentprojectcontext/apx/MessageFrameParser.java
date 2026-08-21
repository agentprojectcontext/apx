package dev.agentprojectcontext.apx;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class MessageFrameParser {
    private MessageFrameParser() {}

    static List<String> notifications(String text) {
        List<String> messages = new ArrayList<>();
        try {
            JSONObject frame = new JSONObject(text);
            if (!"messages".equals(frame.optString("type"))) return messages;
            JSONArray events = frame.optJSONArray("events");
            if (events == null) return messages;
            Map<String, Integer> channels = new LinkedHashMap<>();
            for (int i = 0; i < events.length(); i++) {
                JSONObject event = events.optJSONObject(i);
                if (event == null || !"in".equals(event.optString("direction"))) continue;
                String channel = event.optString("channel", "APX");
                if ("desktop".equals(channel) || "voice".equals(channel)) continue;
                channels.put(channel, channels.getOrDefault(channel, 0) + 1);
            }
            for (Map.Entry<String, Integer> entry : channels.entrySet()) {
                int count = entry.getValue();
                String label = channelLabel(entry.getKey());
                messages.add(count > 1 ? count + " mensajes nuevos en " + label : "Nuevo mensaje en " + label);
            }
        } catch (Exception ignored) {
            // A malformed live frame has no notification value.
        }
        return messages;
    }

    private static String channelLabel(String channel) {
        if (channel == null || channel.isBlank()) return "APX";
        return switch (channel) {
            case "telegram" -> "Telegram";
            case "web", "web_sidebar", "web_code" -> "Web";
            case "cli" -> "Terminal";
            case "routine" -> "Rutinas";
            case "deck" -> "Deck";
            default -> channel.substring(0, 1).toUpperCase() + channel.substring(1);
        };
    }
}
