package dev.homeneeds.app;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

final class HomeNeedsApi {
    interface StreamListener {
        void onEvent(String event, JSONObject payload);
        void onDisconnected();
    }

    private final String baseUrl;
    private final String clientId;
    private volatile boolean streamClosed;

    HomeNeedsApi(String baseUrl, String clientId) {
        this.baseUrl = trimSlash(baseUrl);
        this.clientId = clientId;
    }

    List<Models.Item> fetchItems() throws Exception {
        JSONObject payload = request("GET", "/api/items", null);
        JSONArray array = payload.optJSONArray("items");
        ArrayList<Models.Item> items = new ArrayList<>();
        if (array != null) {
            for (int i = 0; i < array.length(); i++) items.add(Models.Item.fromJson(array.getJSONObject(i)));
        }
        return items;
    }

    List<Models.Favorite> fetchFavorites() throws Exception {
        JSONObject payload = request("GET", "/api/favorites", null);
        JSONArray array = payload.optJSONArray("favorites");
        ArrayList<Models.Favorite> favorites = new ArrayList<>();
        if (array != null) {
            for (int i = 0; i < array.length(); i++) favorites.add(Models.Favorite.fromJson(array.getJSONObject(i)));
        }
        return favorites;
    }

    Models.Profile fetchProfile() throws Exception {
        JSONObject payload = request("GET", "/api/profile", null);
        return new Models.Profile(
                payload.optString("clientId", clientId),
                payload.optString("displayName", ""),
                payload.optString("highlightColor", Models.DEFAULT_COLOR)
        );
    }

    Models.Profile saveProfile(Models.Profile profile) throws Exception {
        JSONObject payload = request("PUT", "/api/profile", profile.toJson());
        return new Models.Profile(
                payload.optString("clientId", clientId),
                payload.optString("displayName", ""),
                payload.optString("highlightColor", Models.DEFAULT_COLOR)
        );
    }

    Models.Item addItem(JSONObject body) throws Exception {
        return Models.Item.fromJson(request("POST", "/api/items", body));
    }

    Models.Item patchItem(long id, JSONObject body) throws Exception {
        return Models.Item.fromJson(request("PATCH", "/api/items/" + id, body));
    }

    void deleteItem(long id) throws Exception {
        request("DELETE", "/api/items/" + id, null);
    }

    void clearChecked() throws Exception {
        request("POST", "/api/items/clear-checked", new JSONObject());
    }

    void closeStream() {
        streamClosed = true;
    }

    void stream(StreamListener listener) {
        streamClosed = false;
        while (!streamClosed) {
            HttpURLConnection connection = null;
            try {
                connection = open("GET", "/api/stream");
                connection.setReadTimeout(0);
                String event = "message";
                StringBuilder data = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while (!streamClosed && (line = reader.readLine()) != null) {
                        if (line.startsWith(":")) continue;
                        if (line.startsWith("event:")) event = line.substring(6).trim();
                        else if (line.startsWith("data:")) data.append(line.substring(5).trim());
                        else if (line.isEmpty() && data.length() > 0) {
                            listener.onEvent(event, new JSONObject(data.toString()));
                            event = "message";
                            data.setLength(0);
                        }
                    }
                }
            } catch (Exception ignored) {
                listener.onDisconnected();
                try {
                    Thread.sleep(3000);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    return;
                }
            } finally {
                if (connection != null) connection.disconnect();
            }
        }
    }

    private JSONObject request(String method, String path, JSONObject body) throws Exception {
        HttpURLConnection connection = open(method, path);
        if (body != null) {
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setDoOutput(true);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(bytes);
            }
        }

        int status = connection.getResponseCode();
        if (status == 204) return new JSONObject();
        if (status < 200 || status >= 300) {
            String error = "";
            if (connection.getErrorStream() != null) {
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getErrorStream(), StandardCharsets.UTF_8))) {
                    StringBuilder text = new StringBuilder();
                    String line;
                    while ((line = reader.readLine()) != null) text.append(line);
                    error = text.toString();
                }
            }
            throw new IllegalStateException(method + " " + path + " -> " + status + " " + error);
        }
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
            StringBuilder text = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) text.append(line);
            return text.length() == 0 ? new JSONObject() : new JSONObject(text.toString());
        } finally {
            connection.disconnect();
        }
    }

    private HttpURLConnection open(String method, String path) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(baseUrl + path).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(7000);
        connection.setReadTimeout(7000);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("X-Client-Id", clientId);
        return connection;
    }

    private static String trimSlash(String value) {
        String url = value == null || value.trim().isEmpty() ? Models.DEFAULT_BASE_URL : value.trim();
        while (url.endsWith("/")) url = url.substring(0, url.length() - 1);
        return url;
    }
}
