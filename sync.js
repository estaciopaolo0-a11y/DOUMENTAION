/* ============================================================
   DocTrack — Cloud accounts + real-time per-user sync
   ------------------------------------------------------------
   - `dt_users` is synced GLOBALLY so accounts created on one
     device can sign in on another device.
   - `dt_docs`, `dt_logs`, `dt_notifs` are synced PER-USER
     (scoped to the signed-in user's id). New users start empty.
   - Device-local keys (NOT synced): dt_session, dt_theme, dt_seeded.

   This file does NOT modify any existing app logic. It only
   mirrors localStorage writes to Supabase and applies remote
   changes back into localStorage, then asks the app to re-render.
   ============================================================ */
(function () {
  const GLOBAL_KEYS = ["dt_users"];
  const USER_KEYS   = ["dt_docs", "dt_logs", "dt_notifs"];
  const ALL_KEYS    = GLOBAL_KEYS.concat(USER_KEYS);
  const TABLE = "app_state";

  const nativeSetItem    = Storage.prototype.setItem.bind(localStorage);
  const nativeRemoveItem = Storage.prototype.removeItem.bind(localStorage);

  const lastRemote = new Map(); // cloudKey -> serialized value (echo guard)
  let client = null;
  let ready = false;
  let queue = [];
  let currentUserId = null;
  let channel = null;

  function getClient() {
    if (client) return client;
    if (!window.supabase || !window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return null;
    client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    return client;
  }

  function readSessionUserId() {
    try {
      const s = JSON.parse(localStorage.getItem("dt_session") || "null");
      return s && s.id ? String(s.id) : null;
    } catch { return null; }
  }

  // cloud key naming: global keys keep their name; user keys get "::<userId>".
  function cloudKeyFor(localKey, userId) {
    if (GLOBAL_KEYS.includes(localKey)) return localKey;
    if (!userId) return null;
    return `${localKey}::${userId}`;
  }
  function localKeyFor(cloudKey) {
    const i = cloudKey.indexOf("::");
    return i === -1 ? cloudKey : cloudKey.slice(0, i);
  }
  function userIdOfCloudKey(cloudKey) {
    const i = cloudKey.indexOf("::");
    return i === -1 ? null : cloudKey.slice(i + 2);
  }

  function safeRerender() {
    try {
      const appEl = document.getElementById("app");
      if (!appEl || appEl.classList.contains("hidden")) return;
      if (typeof window.renderPage === "function") window.renderPage();
      if (typeof window.renderNotifBell === "function") window.renderNotifBell();
      const panel = document.getElementById("notifPanel");
      if (panel && !panel.classList.contains("hidden") && typeof window.renderNotifPanel === "function") {
        window.renderNotifPanel();
      }
    } catch (e) { /* ignore */ }
  }

  function applyRemote(localKey, value) {
    const serialized = JSON.stringify(value);
    const ck = cloudKeyFor(localKey, currentUserId);
    if (ck) lastRemote.set(ck, serialized);
    else    lastRemote.set(localKey, serialized);
    nativeSetItem(localKey, serialized);
    safeRerender();
  }

  async function pushCloud(cloudKey, rawValue) {
    const c = getClient();
    if (!c) return;
    let parsed;
    try { parsed = JSON.parse(rawValue); } catch { parsed = rawValue; }
    const { error } = await c.from(TABLE).upsert(
      { key: cloudKey, value: parsed, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
    if (error) console.warn("[sync] push failed", cloudKey, error.message);
  }

  // Pull all rows for the given user (and global keys), apply to localStorage.
  async function loadForUser(userId) {
    const c = getClient();
    if (!c) return;
    const keys = GLOBAL_KEYS.concat(userId ? USER_KEYS.map(k => `${k}::${userId}`) : []);
    const { data, error } = await c.from(TABLE).select("key,value").in("key", keys);
    if (error) { console.warn("[sync] fetch failed", error.message); return; }
    const cloud = new Map((data || []).map(r => [r.key, r.value]));

    // Globals
    for (const k of GLOBAL_KEYS) {
      if (cloud.has(k)) applyRemote(k, cloud.get(k));
    }
    // Per-user: empty by default for new users
    if (userId) {
      for (const k of USER_KEYS) {
        const ck = `${k}::${userId}`;
        if (cloud.has(ck)) {
          applyRemote(k, cloud.get(ck));
        } else {
          // Ensure local is clean for fresh accounts
          applyRemote(k, []);
        }
      }
    }
  }

  function resubscribe() {
    const c = getClient(); if (!c) return;
    if (channel) { try { c.removeChannel(channel); } catch {} channel = null; }
    channel = c.channel("app_state_" + (currentUserId || "anon"))
      .on("postgres_changes",
          { event: "*", schema: "public", table: TABLE },
          (payload) => {
            if (payload.eventType === "DELETE") return;
            const row = payload.new; if (!row || !row.key) return;
            const lk = localKeyFor(row.key);
            const owner = userIdOfCloudKey(row.key);
            if (GLOBAL_KEYS.includes(lk)) {
              applyRemote(lk, row.value);
            } else if (USER_KEYS.includes(lk) && owner && owner === currentUserId) {
              applyRemote(lk, row.value);
            }
          })
      .subscribe();
  }

  // Called when login/logout changes the active user.
  async function onSessionChanged(newUserId) {
    if (newUserId === currentUserId) return;
    currentUserId = newUserId;
    if (newUserId) {
      await loadForUser(newUserId);
    }
    resubscribe();
    safeRerender();
  }

  // ---- Hook localStorage ----
  Storage.prototype.setItem = function (key, value) {
    nativeSetItem(key, value);
    if (this !== localStorage) return;

    if (key === "dt_session") {
      // session changed (login or user-switch)
      const uid = readSessionUserId();
      onSessionChanged(uid);
      return;
    }

    if (!ALL_KEYS.includes(key)) return;
    const ck = cloudKeyFor(key, currentUserId);
    if (!ck) return; // per-user write with no session — skip
    if (lastRemote.get(ck) === value) { lastRemote.delete(ck); return; }
    if (!ready) { queue.push([ck, value]); return; }
    pushCloud(ck, value);
  };

  Storage.prototype.removeItem = function (key) {
    nativeRemoveItem(key);
    if (this === localStorage && key === "dt_session") {
      onSessionChanged(null);
    }
  };

  async function bootstrap() {
    const c = getClient();
    if (!c) { console.warn("[sync] Supabase not configured — running offline."); return; }

    currentUserId = readSessionUserId();

    // Pull globals + current user's data
    await loadForUser(currentUserId);

    ready = true;
    const pending = queue.splice(0);
    for (const [ck, v] of pending) pushCloud(ck, v);

    resubscribe();
    safeRerender();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();
