package dev.homeneeds.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public final class MainActivity extends Activity {
    private static final String[] COLOR_NAMES = {"Red", "Orange", "Yellow", "Green", "Teal", "Blue", "Purple", "Pink"};
    private static final String[] COLOR_VALUES = {"#ef4444", "#f97316", "#facc15", "#22c55e", "#14b8a6", "#3b82f6", "#a855f7", "#ec4899"};
    private static final long SYNC_INTERVAL_MS = 15000L;

    private final ExecutorService io = Executors.newFixedThreadPool(3);
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicBoolean syncRunning = new AtomicBoolean(false);
    private final AtomicBoolean syncAgain = new AtomicBoolean(false);
    private final Runnable periodicSync = new Runnable() {
        @Override public void run() {
            syncNow("Checking for changes...");
            main.postDelayed(this, SYNC_INTERVAL_MS);
        }
    };

    private LocalStore store;
    private SharedPreferences prefs;
    private HomeNeedsApi api;
    private Models.Profile profile;

    private LinearLayout favoritesList;
    private LinearLayout todoList;
    private LinearLayout doneList;
    private TextView status;
    private EditText nameInput;
    private EditText quantityInput;
    private EditText notesInput;
    private EditText displayNameInput;
    private Button colorSwatchButton;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        store = new LocalStore(this);
        prefs = getSharedPreferences("homeneeds", MODE_PRIVATE);
        String clientId = prefs.getString("clientId", null);
        if (clientId == null) {
            clientId = "android:" + UUID.randomUUID();
            prefs.edit().putString("clientId", clientId).apply();
        }
        String baseUrl = prefs.getString("baseUrl", Models.DEFAULT_BASE_URL);
        profile = new Models.Profile(
                clientId,
                prefs.getString("displayName", ""),
                prefs.getString("highlightColor", Models.DEFAULT_COLOR)
        );
        api = new HomeNeedsApi(baseUrl, clientId);
        buildUi(baseUrl);
        render();
        syncNow("Syncing...");
        startStream();
        main.postDelayed(periodicSync, SYNC_INTERVAL_MS);
    }

    @Override
    protected void onResume() {
        super.onResume();
        syncNow("Syncing...");
    }

    @Override
    protected void onDestroy() {
        main.removeCallbacks(periodicSync);
        api.closeStream();
        io.shutdownNow();
        super.onDestroy();
    }

    private void buildUi(String baseUrl) {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#0f172a"));

        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.VERTICAL);
        top.setPadding(dp(14), dp(30), dp(14), dp(10));
        TextView title = label("HomeNeeds", 20, "#e8eefc");
        title.setGravity(Gravity.CENTER_VERTICAL);
        top.addView(title, full(dp(34)));

        LinearLayout profileRow = row();
        profileRow.setGravity(Gravity.CENTER_VERTICAL);
        profileRow.setPadding(0, dp(6), 0, 0);

        TextView nameLabel = label("Display name", 13, "#94a3c4");
        nameLabel.setGravity(Gravity.CENTER_VERTICAL);
        profileRow.addView(nameLabel, new LinearLayout.LayoutParams(dp(92), dp(44)));

        displayNameInput = input("name");
        displayNameInput.setText(profile.displayName);
        displayNameInput.setSingleLine(true);
        displayNameInput.setOnFocusChangeListener((view, hasFocus) -> {
            if (!hasFocus) saveProfile();
        });
        profileRow.addView(displayNameInput, new LinearLayout.LayoutParams(0, dp(44), 1));

        colorSwatchButton = button("", profile.highlightColor, "#ffffff");
        colorSwatchButton.setText(" ");
        colorSwatchButton.setContentDescription("Highlight color");
        colorSwatchButton.setOnClickListener(v -> showColorPicker());
        LinearLayout.LayoutParams swatchParams = new LinearLayout.LayoutParams(dp(48), dp(44));
        swatchParams.leftMargin = dp(10);
        profileRow.addView(colorSwatchButton, swatchParams);
        top.addView(profileRow);
        root.addView(top);

        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(14), dp(8), dp(14), dp(10));
        nameInput = input("Add an item");
        quantityInput = input("qty");
        notesInput = input("notes");
        Button add = button("Add", "#60a5fa", "#0b1220");
        add.setOnClickListener(v -> addItem());
        form.addView(nameInput, full(dp(44)));
        LinearLayout sub = row();
        sub.addView(quantityInput, new LinearLayout.LayoutParams(0, dp(44), 1));
        sub.addView(notesInput, new LinearLayout.LayoutParams(0, dp(44), 2));
        sub.addView(add, new LinearLayout.LayoutParams(dp(78), dp(44)));
        form.addView(sub);
        root.addView(form);

        ScrollView scroll = new ScrollView(this);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(14), 0, dp(14), dp(24));
        content.addView(section("Favorites"));
        favoritesList = new LinearLayout(this);
        favoritesList.setOrientation(LinearLayout.VERTICAL);
        content.addView(favoritesList);
        content.addView(section("To buy"));
        todoList = new LinearLayout(this);
        todoList.setOrientation(LinearLayout.VERTICAL);
        content.addView(todoList);
        content.addView(section("In the cart"));
        doneList = new LinearLayout(this);
        doneList.setOrientation(LinearLayout.VERTICAL);
        content.addView(doneList);
        Button clear = button("Done shopping - clear cart", "#22c55e", "#06210e");
        clear.setOnClickListener(v -> clearChecked());
        content.addView(clear, full(dp(50)));
        scroll.addView(content);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));

        status = label("", 13, "#94a3c4");
        status.setGravity(Gravity.CENTER);
        status.setPadding(dp(10), dp(7), dp(10), dp(7));
        root.addView(status, full(dp(32)));
        setContentView(root);
    }

    private void render() {
        List<Models.Item> items = store.items();
        Collections.sort(items, (a, b) -> {
            if (a.checked != b.checked) return a.checked ? 1 : -1;
            return Long.compare(a.createdAt, b.createdAt);
        });
        todoList.removeAllViews();
        doneList.removeAllViews();
        favoritesList.removeAllViews();
        for (Models.Favorite favorite : store.favorites()) {
            favoritesList.addView(favoriteRow(favorite));
        }
        for (Models.Item item : items) {
            (item.checked ? doneList : todoList).addView(itemRow(item));
        }
    }

    private View favoriteRow(Models.Favorite favorite) {
        Button button = button(favorite.name + (favorite.quantity.isEmpty() ? "" : "  " + favorite.quantity), "#162243", "#e8eefc");
        button.setGravity(Gravity.CENTER_VERTICAL);
        button.setOnClickListener(v -> {
            nameInput.setText(favorite.name);
            quantityInput.setText(favorite.quantity);
            notesInput.setText(favorite.notes);
            addItem();
        });
        return button;
    }

    private View itemRow(Models.Item item) {
        LinearLayout outer = row();
        outer.setGravity(Gravity.CENTER_VERTICAL);
        outer.setPadding(0, dp(4), 0, dp(4));

        View stripe = new View(this);
        stripe.setBackgroundColor(parseColor(item.addedByColor, Models.DEFAULT_COLOR));
        outer.addView(stripe, new LinearLayout.LayoutParams(dp(5), dp(72)));

        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(10), dp(8), dp(6), dp(8));
        body.setBackgroundColor(Color.parseColor("#111c34"));
        TextView name = label(item.name + (item.quantity.isEmpty() ? "" : "  " + item.quantity), 17, item.checked ? "#94a3c4" : "#e8eefc");
        TextView meta = label(metaText(item), 13, "#94a3c4");
        body.addView(name);
        body.addView(meta);
        body.setOnClickListener(v -> patchChecked(item, !item.checked));
        body.setOnLongClickListener(v -> {
            editItem(item);
            return true;
        });
        outer.addView(body, new LinearLayout.LayoutParams(0, dp(72), 1));

        Button edit = button("Edit", "#162243", "#e8eefc");
        edit.setOnClickListener(v -> editItem(item));
        outer.addView(edit, new LinearLayout.LayoutParams(dp(62), dp(72)));
        Button del = button("X", "#ef4444", "#ffffff");
        del.setOnClickListener(v -> deleteItem(item));
        outer.addView(del, new LinearLayout.LayoutParams(dp(46), dp(72)));
        return outer;
    }

    private String metaText(Models.Item item) {
        ArrayList<String> parts = new ArrayList<>();
        if (!item.notes.isEmpty()) parts.add(item.notes);
        if (!item.addedBy.isEmpty()) parts.add(item.addedBy);
        if (item.pendingSync) parts.add("pending sync");
        return join(parts);
    }

    private void addItem() {
        String name = nameInput.getText().toString().trim();
        if (name.isEmpty()) return;
        profile.displayName = displayNameInput.getText().toString().trim();
        long now = System.currentTimeMillis();
        Models.Item item = new Models.Item();
        item.id = -now;
        item.name = name;
        item.quantity = quantityInput.getText().toString().trim();
        item.notes = notesInput.getText().toString().trim();
        item.addedBy = profile.displayName;
        item.addedByColor = profile.highlightColor;
        item.createdAt = now;
        item.updatedAt = now;
        item.pendingSync = true;
        store.putItem(item);
        try {
            JSONObject body = new JSONObject();
            body.put("name", item.name);
            body.put("quantity", item.quantity);
            body.put("notes", item.notes);
            body.put("addedBy", item.addedBy);
            body.put("addedByColor", item.addedByColor);
            store.addOp("item:add", item.id, body);
        } catch (Exception ignored) {
        }
        nameInput.setText("");
        quantityInput.setText("");
        notesInput.setText("");
        render();
        syncNow("Saving...");
    }

    private void queueItemPatch(Models.Item item, JSONObject body) {
        LocalStore.PendingOp pendingAdd = store.pendingAddForTarget(item.id);
        if (pendingAdd != null) {
            JSONObject merged = pendingAdd.body;
            if (body.has("name")) merged.remove("name");
            if (body.has("quantity")) merged.remove("quantity");
            if (body.has("notes")) merged.remove("notes");
            if (body.has("checked")) {
                // New items are always created unchecked server-side, so checked
                // changes still need a follow-up patch after the add succeeds.
                store.addOp("item:patch", item.id, body);
            } else {
                try {
                    if (body.has("name")) merged.put("name", body.optString("name"));
                    if (body.has("quantity")) merged.put("quantity", body.optString("quantity"));
                    if (body.has("notes")) merged.put("notes", body.optString("notes"));
                    store.updateOpBody(pendingAdd.id, merged);
                } catch (Exception ignored) {
                }
            }
        } else {
            store.deleteOpsForTarget(item.id);
            store.addOp("item:patch", item.id, body);
        }
    }

    private void patchChecked(Models.Item item, boolean checked) {
        item.checked = checked;
        item.pendingSync = true;
        item.updatedAt = System.currentTimeMillis();
        store.putItem(item);
        try {
            JSONObject body = new JSONObject();
            body.put("checked", checked);
            queueItemPatch(item, body);
        } catch (Exception ignored) {
        }
        render();
        syncNow("Saving...");
    }

    private void editItem(Models.Item item) {
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        EditText name = input("name");
        EditText qty = input("qty");
        EditText notes = input("notes");
        name.setText(item.name);
        qty.setText(item.quantity);
        notes.setText(item.notes);
        form.addView(name);
        form.addView(qty);
        form.addView(notes);
        new AlertDialog.Builder(this)
                .setTitle("Edit item")
                .setView(form)
                .setPositiveButton("Save", (dialog, which) -> {
                    item.name = name.getText().toString().trim();
                    if (item.name.isEmpty()) return;
                    item.quantity = qty.getText().toString().trim();
                    item.notes = notes.getText().toString().trim();
                    item.pendingSync = true;
                    item.updatedAt = System.currentTimeMillis();
                    store.putItem(item);
                    try {
                        JSONObject body = new JSONObject();
                        body.put("name", item.name);
                        body.put("quantity", item.quantity);
                        body.put("notes", item.notes);
                        queueItemPatch(item, body);
                    } catch (Exception ignored) {
                    }
                    render();
                    syncNow("Saving...");
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void deleteItem(Models.Item item) {
        store.deleteItem(item.id);
        if (item.id > 0) {
            store.deleteOpsForTarget(item.id);
            store.addOp("item:delete", item.id, new JSONObject());
        } else {
            store.deleteOpsForTarget(item.id);
        }
        render();
        syncNow("Saving...");
    }

    private void clearChecked() {
        for (Models.Item item : store.items()) {
            if (item.checked) store.deleteOpsForTarget(item.id);
        }
        store.clearCheckedItems();
        store.addOp("item:clearChecked", 0, new JSONObject());
        render();
        syncNow("Saving...");
    }

    private void saveProfile() {
        profile.displayName = displayNameInput.getText().toString().trim();
        prefs.edit()
                .putString("displayName", profile.displayName)
                .putString("highlightColor", profile.highlightColor)
                .apply();
        io.execute(() -> {
            try {
                api.saveProfile(profile);
                postStatus("Profile synced");
            } catch (Exception ignored) {
                postStatus("Profile saved on phone");
            }
        });
    }

    private void syncNow(String message) {
        postStatus(message);
        if (!syncRunning.compareAndSet(false, true)) {
            syncAgain.set(true);
            return;
        }

        io.execute(() -> {
            boolean runAgain;
            do {
                syncAgain.set(false);
                try {
                    flushPendingOpsInline();
                    refreshFromServerInline();
                    postStatus("Synced");
                } catch (Exception ignored) {
                    postStatus("Changes pending sync");
                }
                runAgain = syncAgain.get();
            } while (runAgain);
            syncRunning.set(false);
            if (syncAgain.getAndSet(false)) syncNow("Syncing...");
        });
    }

    private void refreshFromServerInline() throws Exception {
        store.replaceItems(api.fetchItems());
        store.replaceFavorites(api.fetchFavorites());
        try {
            Models.Profile fresh = api.fetchProfile();
            profile = fresh;
            prefs.edit()
                    .putString("displayName", fresh.displayName)
                    .putString("highlightColor", fresh.highlightColor)
                    .apply();
        } catch (Exception ignored) {
            // Older HomeNeeds servers do not expose /api/profile yet. Keep the
            // device-local profile and still allow list sync to succeed.
        }
        main.post(() -> {
            displayNameInput.setText(profile.displayName);
            updateColorSwatch();
            render();
        });
    }

    private void flushPendingOpsInline() throws Exception {
        java.util.HashMap<Long, Long> createdIds = new java.util.HashMap<>();
        for (LocalStore.PendingOp op : store.pendingOps()) {
            if ("item:add".equals(op.type)) {
                Models.Item created = api.addItem(op.body);
                createdIds.put(op.targetId, created.id);
                store.deleteItem(op.targetId);
                store.putItem(created);
            } else if ("item:patch".equals(op.type)) {
                Long createdId = createdIds.get(op.targetId);
                long targetId = createdId == null ? op.targetId : createdId;
                if (targetId > 0) {
                    store.putItem(api.patchItem(targetId, op.body));
                }
            } else if ("item:delete".equals(op.type)) {
                api.deleteItem(op.targetId);
            } else if ("item:clearChecked".equals(op.type)) {
                try {
                    api.clearChecked();
                } catch (HomeNeedsApi.ApiException e) {
                    if (e.status != 404) throw e;
                    api.clearCheckedFallback();
                }
            }
            store.deleteOp(op.id);
            main.post(this::render);
        }
    }

    private void startStream() {
        io.execute(() -> api.stream(new HomeNeedsApi.StreamListener() {
            @Override public void onEvent(String event, JSONObject payload) {
                if (event.startsWith("item:") || event.equals("items:cleared-checked")) syncNow("Syncing...");
            }
            @Override public void onDisconnected() {
                postStatus("Reconnecting...");
            }
        }));
    }

    private TextView section(String text) {
        TextView view = label(text, 13, "#94a3c4");
        view.setPadding(0, dp(18), 0, dp(8));
        view.setAllCaps(true);
        return view;
    }

    private LinearLayout row() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        return row;
    }

    private EditText input(String hint) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setTextColor(Color.parseColor("#e8eefc"));
        input.setHintTextColor(Color.parseColor("#94a3c4"));
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT);
        input.setPadding(dp(10), 0, dp(10), 0);
        input.setBackgroundColor(Color.parseColor("#162243"));
        return input;
    }

    private Button button(String text, String bg, String fg) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextColor(Color.parseColor(fg));
        button.setBackgroundColor(Color.parseColor(bg));
        button.setAllCaps(false);
        return button;
    }

    private void showColorPicker() {
        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setPadding(dp(8), dp(6), dp(8), dp(6));
        list.setBackgroundColor(Color.parseColor("#111c34"));

        for (int i = 0; i < COLOR_VALUES.length; i++) {
            LinearLayout option = row();
            option.setGravity(Gravity.CENTER_VERTICAL);
            option.setPadding(dp(8), dp(6), dp(8), dp(6));
            option.setBackgroundColor(Color.parseColor("#111c34"));

            View swatch = new View(this);
            swatch.setBackgroundColor(Color.parseColor(COLOR_VALUES[i]));
            option.addView(swatch, new LinearLayout.LayoutParams(dp(34), dp(34)));

            TextView name = label(COLOR_NAMES[i], 16, "#e8eefc");
            name.setGravity(Gravity.CENTER_VERTICAL);
            LinearLayout.LayoutParams nameParams = new LinearLayout.LayoutParams(0, dp(42), 1);
            nameParams.leftMargin = dp(12);
            option.addView(name, nameParams);

            list.addView(option, full(dp(48)));
        }

        TextView title = label("Highlight color", 20, "#e8eefc");
        title.setPadding(dp(24), dp(20), dp(24), dp(8));

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setCustomTitle(title)
                .setView(list)
                .setNegativeButton("Cancel", null)
                .create();

        dialog.setOnShowListener(d -> {
            if (dialog.getWindow() != null) {
                dialog.getWindow().setBackgroundDrawable(new ColorDrawable(Color.parseColor("#111c34")));
            }
        });

        for (int i = 0; i < list.getChildCount(); i++) {
            list.getChildAt(i).setOnClickListener(v -> {
                LinearLayout option = (LinearLayout) v;
                int index = list.indexOfChild(option);
                profile.highlightColor = COLOR_VALUES[index];
                prefs.edit().putString("highlightColor", profile.highlightColor).apply();
                updateColorSwatch();
                saveProfile();
                dialog.dismiss();
            });
        }
        dialog.show();
    }

    private void updateColorSwatch() {
        if (colorSwatchButton != null) {
            colorSwatchButton.setBackgroundColor(parseColor(profile.highlightColor, Models.DEFAULT_COLOR));
        }
    }

    private TextView label(String text, int sp, String color) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(sp);
        view.setTextColor(Color.parseColor(color));
        return view;
    }

    private LinearLayout.LayoutParams full(int height) {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, height);
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }

    private int colorIndex(String color) {
        for (int i = 0; i < COLOR_VALUES.length; i++) {
            if (COLOR_VALUES[i].equalsIgnoreCase(color)) return i;
        }
        return 5;
    }

    private int parseColor(String value, String fallback) {
        try {
            return Color.parseColor(value == null || value.isEmpty() ? fallback : value);
        } catch (Exception ignored) {
            return Color.parseColor(fallback);
        }
    }

    private void postStatus(String text) {
        main.post(() -> status.setText(text));
    }

    private String join(List<String> parts) {
        StringBuilder text = new StringBuilder();
        for (String part : parts) {
            if (text.length() > 0) text.append("  |  ");
            text.append(part);
        }
        return text.toString();
    }
}
