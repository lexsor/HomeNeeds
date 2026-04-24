package dev.homeneeds.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

final class LocalStore extends SQLiteOpenHelper {
    LocalStore(Context context) {
        super(context, "homeneeds.db", null, 1);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE items (id INTEGER PRIMARY KEY, json TEXT NOT NULL)");
        db.execSQL("CREATE TABLE favorites (id INTEGER PRIMARY KEY, json TEXT NOT NULL)");
        db.execSQL("CREATE TABLE pending_ops (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, target_id INTEGER, body TEXT NOT NULL)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        db.execSQL("DROP TABLE IF EXISTS items");
        db.execSQL("DROP TABLE IF EXISTS favorites");
        db.execSQL("DROP TABLE IF EXISTS pending_ops");
        onCreate(db);
    }

    synchronized List<Models.Item> items() {
        ArrayList<Models.Item> items = new ArrayList<>();
        try (Cursor cursor = getReadableDatabase().rawQuery("SELECT json FROM items", null)) {
            while (cursor.moveToNext()) {
                items.add(Models.Item.fromJson(new JSONObject(cursor.getString(0))));
            }
        } catch (JSONException ignored) {
        }
        return items;
    }

    synchronized void replaceItems(List<Models.Item> items) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.delete("items", null, null);
            for (Models.Item item : items) putItem(db, item);
            db.setTransactionSuccessful();
        } catch (JSONException ignored) {
        } finally {
            db.endTransaction();
        }
    }

    synchronized void putItem(Models.Item item) {
        try {
            putItem(getWritableDatabase(), item);
        } catch (JSONException ignored) {
        }
    }

    private void putItem(SQLiteDatabase db, Models.Item item) throws JSONException {
        ContentValues values = new ContentValues();
        values.put("id", item.id);
        values.put("json", item.toJson().toString());
        db.replace("items", null, values);
    }

    synchronized void deleteItem(long id) {
        getWritableDatabase().delete("items", "id = ?", new String[]{String.valueOf(id)});
    }

    synchronized void clearCheckedItems() {
        for (Models.Item item : items()) {
            if (item.checked) deleteItem(item.id);
        }
    }

    synchronized List<Models.Favorite> favorites() {
        ArrayList<Models.Favorite> favorites = new ArrayList<>();
        try (Cursor cursor = getReadableDatabase().rawQuery("SELECT json FROM favorites", null)) {
            while (cursor.moveToNext()) {
                favorites.add(Models.Favorite.fromJson(new JSONObject(cursor.getString(0))));
            }
        } catch (JSONException ignored) {
        }
        return favorites;
    }

    synchronized void replaceFavorites(List<Models.Favorite> favorites) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.delete("favorites", null, null);
            for (Models.Favorite favorite : favorites) {
                JSONObject json = new JSONObject();
                json.put("id", favorite.id);
                json.put("name", favorite.name);
                json.put("quantity", favorite.quantity == null ? "" : favorite.quantity);
                json.put("notes", favorite.notes == null ? "" : favorite.notes);
                json.put("createdAt", favorite.createdAt);
                json.put("pendingSync", favorite.pendingSync);
                ContentValues values = new ContentValues();
                values.put("id", favorite.id);
                values.put("json", json.toString());
                db.replace("favorites", null, values);
            }
            db.setTransactionSuccessful();
        } catch (JSONException ignored) {
        } finally {
            db.endTransaction();
        }
    }

    synchronized void addOp(String type, long targetId, JSONObject body) {
        ContentValues values = new ContentValues();
        values.put("type", type);
        values.put("target_id", targetId);
        values.put("body", body == null ? "{}" : body.toString());
        getWritableDatabase().insert("pending_ops", null, values);
    }

    synchronized PendingOp pendingAddForTarget(long targetId) {
        try (Cursor cursor = getReadableDatabase().rawQuery(
                "SELECT id, type, target_id, body FROM pending_ops WHERE type = ? AND target_id = ? ORDER BY id LIMIT 1",
                new String[]{"item:add", String.valueOf(targetId)}
        )) {
            if (cursor.moveToNext()) {
                return new PendingOp(cursor.getLong(0), cursor.getString(1), cursor.getLong(2), new JSONObject(cursor.getString(3)));
            }
        } catch (JSONException ignored) {
        }
        return null;
    }

    synchronized void updateOpBody(long id, JSONObject body) {
        ContentValues values = new ContentValues();
        values.put("body", body == null ? "{}" : body.toString());
        getWritableDatabase().update("pending_ops", values, "id = ?", new String[]{String.valueOf(id)});
    }

    synchronized void deleteOpsForTarget(long targetId) {
        getWritableDatabase().delete("pending_ops", "target_id = ?", new String[]{String.valueOf(targetId)});
    }

    synchronized List<PendingOp> pendingOps() {
        ArrayList<PendingOp> ops = new ArrayList<>();
        try (Cursor cursor = getReadableDatabase().rawQuery("SELECT id, type, target_id, body FROM pending_ops ORDER BY id", null)) {
            while (cursor.moveToNext()) {
                ops.add(new PendingOp(cursor.getLong(0), cursor.getString(1), cursor.getLong(2), new JSONObject(cursor.getString(3))));
            }
        } catch (JSONException ignored) {
        }
        return ops;
    }

    synchronized void deleteOp(long id) {
        getWritableDatabase().delete("pending_ops", "id = ?", new String[]{String.valueOf(id)});
    }

    static final class PendingOp {
        final long id;
        final String type;
        final long targetId;
        final JSONObject body;

        PendingOp(long id, String type, long targetId, JSONObject body) {
            this.id = id;
            this.type = type;
            this.targetId = targetId;
            this.body = body;
        }
    }
}
