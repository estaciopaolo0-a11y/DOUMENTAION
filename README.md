# DocTrack — Cloud Accounts + Real-Time Sync

A document/SLA monitoring app with **cloud-stored accounts** and **real-time cross-device sync**.

## Files
- `index.html` — main UI
- `style.css` — styles
- `script.js` — app logic (unchanged)
- `sync.js` — cloud + realtime layer (mirrors localStorage to Supabase)
- `supabase-config.js` — pre-configured Lovable Cloud project keys
- `supabase-setup.sql` — one-time DB setup (already applied for this project)

## How it works
- **Accounts (`dt_users`)** are stored globally in the cloud — sign up on one
  device and sign in from any other device using the same email/password.
- **Per-user data (`dt_docs`, `dt_logs`, `dt_notifs`)** is scoped to the
  signed-in user. Each device logged into the same account sees the same
  documents, logs, and notifications in real time.
- New accounts start with an **empty Dashboard and Documents** — content
  appears only after the user creates or uploads it.
- Device-only keys (`dt_session`, `dt_theme`) are never uploaded.

## Run
Open `index.html` in a browser. Cloud is already wired up; no setup needed.

## (Optional) Re-apply DB setup
Run `supabase-setup.sql` in the Supabase SQL editor of your own project, then
update `supabase-config.js` with your URL + publishable key.

## Reset cloud data
In the Supabase SQL editor:
```sql
delete from public.app_state;
```
Then clear browser storage on each device.
