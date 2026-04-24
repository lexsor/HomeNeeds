package dev.homeneeds.app;

import org.json.JSONException;
import org.json.JSONObject;

final class Models {
    static final String DEFAULT_BASE_URL = "http://10.10.0.6:3000";
    static final String DEFAULT_COLOR = "#3b82f6";

    private Models() {}

    static final class Profile {
        String clientId;
        String displayName;
        String highlightColor;

        Profile(String clientId, String displayName, String highlightColor) {
            this.clientId = clientId;
            this.displayName = displayName == null ? "" : displayName;
            this.highlightColor = highlightColor == null || highlightColor.isEmpty() ? DEFAULT_COLOR : highlightColor;
        }

        JSONObject toJson() throws JSONException {
            JSONObject json = new JSONObject();
            json.put("clientId", clientId);
            json.put("displayName", displayName);
            json.put("highlightColor", highlightColor);
            return json;
        }
    }

    static final class Item {
        long id;
        String name;
        String quantity;
        String notes;
        boolean checked;
        String addedBy;
        String addedByColor;
        long createdAt;
        long updatedAt;
        boolean pendingSync;

        static Item fromJson(JSONObject json) {
            Item item = new Item();
            item.id = json.optLong("id");
            item.name = json.optString("name");
            item.quantity = json.optString("quantity");
            item.notes = json.optString("notes");
            item.checked = json.optBoolean("checked");
            item.addedBy = json.optString("addedBy");
            item.addedByColor = json.optString("addedByColor", "");
            item.createdAt = json.optLong("createdAt");
            item.updatedAt = json.optLong("updatedAt");
            item.pendingSync = json.optBoolean("pendingSync", false);
            return item;
        }

        JSONObject toJson() throws JSONException {
            JSONObject json = new JSONObject();
            json.put("id", id);
            json.put("name", name);
            json.put("quantity", quantity == null ? "" : quantity);
            json.put("notes", notes == null ? "" : notes);
            json.put("checked", checked);
            json.put("addedBy", addedBy == null ? "" : addedBy);
            json.put("addedByColor", addedByColor == null ? "" : addedByColor);
            json.put("createdAt", createdAt);
            json.put("updatedAt", updatedAt);
            json.put("pendingSync", pendingSync);
            return json;
        }
    }

    static final class Favorite {
        long id;
        String name;
        String quantity;
        String notes;
        long createdAt;
        boolean pendingSync;

        static Favorite fromJson(JSONObject json) {
            Favorite favorite = new Favorite();
            favorite.id = json.optLong("id");
            favorite.name = json.optString("name");
            favorite.quantity = json.optString("quantity");
            favorite.notes = json.optString("notes");
            favorite.createdAt = json.optLong("createdAt");
            favorite.pendingSync = json.optBoolean("pendingSync", false);
            return favorite;
        }
    }
}
