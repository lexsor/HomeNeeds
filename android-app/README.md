# HomeNeeds Android

Native Android client for the HomeNeeds shopping list.

## What it does

- Stores a local SQLite copy of the shopping list
- Queues add, edit, check, delete, and clear-cart actions while offline
- Syncs with the web app API at `http://10.10.0.6:3000`
- Listens to `/api/stream` for live updates
- Saves a per-install open profile with display name and highlight color

## Build

Open this folder in Android Studio, or run:

```bash
./gradlew assembleDebug
```

The debug APK is written to `app/build/outputs/apk/debug/app-debug.apk`.
