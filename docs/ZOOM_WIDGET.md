# Zoom Queue Widget — Documentation

## Overview

The **Zoom Queue** widget gives NOC managers and technicians a live view of the team's
call-queue availability directly inside the NOC Operations Dashboard. It connects to
**Zoom Phone** (not Zoom Contact Center) using a **Server-to-Server OAuth** app and
surfaces the following information without anyone having to open the Zoom desktop client:

| Information shown | Where it comes from |
|---|---|
| Who is ready to receive queue calls | `receive_call` flag on each queue member |
| Who is opted out / on break / DND | `receive_call: false` on each queue member |
| Which queue(s) each agent belongs to | Queue membership from the call-queue API |
| Live elapsed time for active calls | `engagement_started_at` timestamp (requires presence scope) |
| Agent channel (voice / video / chat) | `engagement_channel` field (requires presence scope) |
| Queue name displayed in the header | Resolved from Zoom's queue list |

When Zoom credentials are not configured the widget automatically falls back to a
**realistic snapshot** of the NOC team so the dashboard is never blank.

---

## Widget Modes

| Mode | Badge colour | When it activates |
|---|---|---|
| **Live** | 🟢 Green | `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, and `ZOOM_CLIENT_SECRET` are all set and the Zoom API returns a valid token |
| **Snapshot** | 🟡 Yellow | Any credential is missing, or the Zoom API returns an error |

Snapshot mode shows a hardcoded representation of the team so the widget always renders
something useful. Switching from snapshot to live requires no UI changes — only adding
the three env vars and restarting the server.

---

## Architecture

```
Browser (React widget)
  │
  │  GET /api/zoom/queue  (same-origin, no CORS, no token in browser)
  ▼
Server proxy (Vite dev plugin  OR  api/zoom/queue.ts on Vercel)
  │
  │  POST zoom.us/oauth/token         ← Server-to-Server OAuth token
  │  GET  api.zoom.us/v2/phone/...   ← Zoom Phone API calls
  ▼
Zoom Phone API
```

**Why a server proxy?**

- The `ZOOM_CLIENT_SECRET` never reaches the browser.
- Zoom's Server-to-Server OAuth tokens are cached in-process (one token shared across
  all requests, refreshed automatically 60 seconds before expiry).
- The browser calls a single predictable endpoint (`/api/zoom/queue`) that returns
  a normalised JSON shape regardless of whether the data is live or snapshot.

---

## Authentication — Server-to-Server OAuth

Zoom's **Server-to-Server OAuth** flow (formerly "JWT app") lets a backend service
authenticate as the Zoom account without any user interaction. The flow is:

1. The server POSTs to `https://zoom.us/oauth/token` with:
   - `grant_type=account_credentials`
   - `account_id=<ZOOM_ACCOUNT_ID>`
   - Basic Auth header: `base64(ZOOM_CLIENT_ID:ZOOM_CLIENT_SECRET)`
2. Zoom returns a bearer token valid for **1 hour**.
3. The server caches the token in memory and reuses it until 60 s before expiry.
4. All subsequent Zoom API calls include `Authorization: Bearer <token>`.

No user login, no redirect, no callback URL needed.

---

## OAuth Scopes

All scopes are configured in **Zoom Marketplace → your app → Scopes**.

> **Current status:** The five Phone scopes below are confirmed active in the Zoom app.
> The one remaining recommended scope (`user:read:presence_status:admin`) is a **Core** scope —
> it lives under the **User** category in Zoom Marketplace, not the Phone category,
> which is why it isn't shown in the Phone section. See the setup note below.

---

### ✅ Active — Phone scopes (all confirmed added)

| Scope | Zoom label | Purpose |
|---|---|---|
| `phone:read:list_call_queues:admin` | View call queues | Lists all call queues in the account. Used to discover queue IDs and names so the widget can display the correct queue and resolve `ZOOM_QUEUE_ID` by name. Without this scope the widget cannot identify any queue and falls back to snapshot mode. |
| `phone:read:list_call_queue_members:admin` | View call queue members | Fetches the full agent roster for each queue. Returns each agent's name, user ID, and the `receive_call` flag — the primary ready/not-ready signal the widget uses to show who is opted in or out of the queue. |
| `phone:read:user:admin` | View a phone user | Reads an individual Zoom Phone user's profile and current phone settings (assigned numbers, caller ID, etc.). Used for per-user status lookups and to resolve display names when a user ID is returned without a name. |
| `phone:read:list_users:admin` | View phone users | Lists every user who holds a Zoom Phone licence in the account. Lets the widget enumerate agents who are licensed for Zoom Phone but not yet assigned to a queue — useful for headcount visibility and future on-call scheduling features. |
| `phone:read:list_call_logs:admin` | View call logs | Reads historical inbound and outbound call logs for the account or individual users. Enables future features: average handle time, calls per hour, missed call rate, and daily call volume charts. Currently reserved for forward compatibility. |

---

### ⚡ Recommended — Core scope (not yet added)

| Scope | Category | Zoom label | Purpose | Impact if missing |
|---|---|---|---|---|
| `user:read:presence_status:admin` | User (Core Zoom — not Phone) | Read presence statuses of users | Reads each agent's real-time Zoom presence: Available, In a meeting, On the phone, Do Not Disturb, Away, etc. | Without this scope the widget **cannot detect who is actively on a call**. Every opted-in agent shows as "Ready" even while talking. Active-call elapsed timers and the `on_call` / `wrap_up` statuses are unavailable. |

**How to add it:**

1. In your Zoom app → **Scopes** tab → **Add Scopes**
2. Search for `user:read:presence_status:admin` — it appears under the **User** category (not Phone)
3. Add it, then click **Activate your app** to apply
4. No credential rotation needed — the server picks it up automatically on the next token refresh

---

### Complete scope reference

| Scope | Status | Widget feature unlocked |
|---|---|---|
| `phone:read:list_call_queues:admin` | ✅ Active | Queue discovery, queue name in header |
| `phone:read:list_call_queue_members:admin` | ✅ Active | Agent roster, ready / not-ready status |
| `phone:read:user:admin` | ✅ Active | Per-user profile lookup, display name resolution |
| `phone:read:list_users:admin` | ✅ Active | Full phone-user enumeration, headcount visibility |
| `phone:read:list_call_logs:admin` | ✅ Active | Historical call data (reserved for future analytics) |
| `user:read:presence_status:admin` | ⚡ Recommended — not yet added | Live `on_call` detection, elapsed call timers, wrap-up state |

---

## Status Field Mapping

The widget normalises Zoom data into five statuses:

| Widget status | Display | Colour | How it's derived |
|---|---|---|---|
| `on_call` | On Call | 🔴 Red | Presence status = `Phone` (requires `user:read:presence_status:admin`) |
| `ready` | Ready | 🟢 Green | `receive_call: true` on the queue member record |
| `wrap_up` | Wrap-up | 🟠 Orange | Presence status = `Do_Not_Disturb` immediately after a call |
| `not_ready` | Not Ready | 🟡 Yellow | `receive_call: false` — agent opted out of the queue |
| `offline` | Offline | ⚫ Grey | Agent not signed in to Zoom Phone |

**Without `user:read:presence_status:admin`:** The widget can only show `ready` or
`not_ready`. It cannot detect who is actively on a call. Everyone opted in appears
as "Ready" even while talking.

**With `user:read:presence_status:admin`:** Active calls surface as `on_call` with an
elapsed timer and the channel type (voice / video / chat).

---

## Environment Variables

Add these to your `.env` file (never commit `.env` to git):

```env
# Required — Server-to-Server OAuth credentials from Zoom Marketplace
ZOOM_ACCOUNT_ID=your_account_id_here
ZOOM_CLIENT_ID=your_client_id_here
ZOOM_CLIENT_SECRET=your_client_secret_here

# Optional — restrict the widget to a single queue
# Accepts either the queue UUID or a partial name match (case-insensitive)
# If omitted, all queues in the account are merged into one view
ZOOM_QUEUE_ID=
```

---

## Setup Steps

### 1. Create the Zoom App

1. Go to [marketplace.zoom.us](https://marketplace.zoom.us) and sign in as an admin.
2. Click **Develop → Build App**.
3. Choose **Server-to-Server OAuth** and click **Create**.
4. Give it a name (e.g. `NOC Dashboard`) and click **Create**.

### 2. Add Scopes

The five Phone scopes are already active. The only remaining scope to add is:

1. Inside the app, go to the **Scopes** tab → **Add Scopes**
2. Search for `user:read:presence_status:admin` (it's under the **User** category, not Phone)
3. Add it and click **Activate your app**

**Already added ✅**
- `phone:read:list_call_queues:admin`
- `phone:read:list_call_queue_members:admin`
- `phone:read:user:admin`
- `phone:read:list_users:admin`
- `phone:read:list_call_logs:admin`

**Still needed ⚡**
- `user:read:presence_status:admin` — required for live on-call detection and elapsed timers

### 3. Copy Credentials

On the **App Credentials** tab, copy:
- **Account ID**
- **Client ID**
- **Client Secret**

### 4. Add to `.env`

```env
ZOOM_ACCOUNT_ID=tGbJRVBKRwiv9znKDUj3LQ
ZOOM_CLIENT_ID=w7go3rzTMS9_N86Ubtg0w
ZOOM_CLIENT_SECRET=your_secret_here
```

### 5. Restart the Dev Server

```bash
npm run dev
```

Open the **Zoom Queue** widget. The status badge in the top-right corner of the widget
should change from 🟡 **snapshot** to 🟢 **live**.

### 6. (Optional) Pin to a Specific Queue

If your Zoom account has multiple call queues and you only want to show the NOC queue:

```env
ZOOM_QUEUE_ID=NOC          # partial name match, case-insensitive
# or
ZOOM_QUEUE_ID=abc123def456  # exact queue UUID from Zoom API
```

---

## How the Widget Refreshes

| Trigger | Behaviour |
|---|---|
| **Widget mount** | Fetches immediately |
| **Auto-poll** | Every **30 seconds** in the background |
| **Refresh button** | Manual fetch on demand (↺ icon in widget header) |
| **Elapsed timers** | Update every second in the browser via `tick` — no extra API calls |

---

## API Endpoint Reference

### `GET /api/zoom/queue`

Returns the current queue state. No request body or query parameters needed.

**Response (live mode):**
```json
{
  "source": "live",
  "fetched_at": "2026-05-22T14:30:00.000Z",
  "queue_name": "NOC Support",
  "agents": [
    {
      "agent_id": "abc123",
      "display_name": "Sriram Parisa",
      "status": "on_call",
      "sub_status": null,
      "status_changed_at": 1716384000000,
      "engagement_started_at": 1716383880000,
      "engagement_channel": "voice",
      "queues": ["NOC Support"]
    }
  ],
  "totals": {
    "on_call": 3,
    "ready": 5,
    "wrap_up": 1,
    "not_ready": 2,
    "offline": 4
  },
  "warning": null
}
```

**Response (snapshot mode):**

Same shape but `"source": "snapshot"` and `"warning"` contains an explanation
(e.g. missing credentials, or Zoom API error with the error message appended).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Widget stuck on 🟡 snapshot | Credentials missing or wrong | Double-check `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` in `.env` and restart the server |
| Warning: "No Zoom Phone call queues found" | App not activated, or account doesn't have Zoom Phone | Activate the app in Zoom Marketplace; confirm the account has Zoom Phone licensed |
| Everyone shows as "Ready" — no "On Call" | `user:read:presence_status:admin` not yet added | Add the scope under the **User** category in Zoom Marketplace (not Phone), then reactivate the app |
| 403 errors in server console for presence calls | Scope added but app not reactivated | Click **Activate your app** again in Zoom Marketplace after adding scopes |
| Wrong queue shown | Multiple queues match `ZOOM_QUEUE_ID` | Use the exact queue UUID instead of a name fragment |
| Token refresh errors | Client Secret rotated in Zoom | Update `ZOOM_CLIENT_SECRET` in `.env` and restart |

---

## Files Reference

| File | Purpose |
|---|---|
| `api/zoom/queue.ts` | Vercel serverless function — production API handler |
| `vite-plugins/zoom-proxy.ts` | Vite dev-server plugin — same logic, used during `npm run dev` |
| `src/widgets/ZoomQueue/index.tsx` | Full widget UI (table of agents, status tabs, elapsed timers) |
| `src/widgets/ZoomQueue/Tile.tsx` | Compact tile shown on the manager dashboard home |
| `src/widgets/ZoomQueue/data.ts` | React hook — polls `/api/zoom/queue`, manages loading state |
| `src/lib/zoom.ts` | Shared type definitions and status label/colour maps |
| `.env` | Zoom credentials (never commit this file) |
