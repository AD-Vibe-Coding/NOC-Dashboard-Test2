# Zoom Phone — Live Queue Widget Setup

This document lists everything required to switch the dashboard's **Zoom queue
widget** from snapshot mode to **live mode**, pulling real-time agent statuses
from Zoom Phone with the Customer Engagement Pack (CEP).

## 1. Create a Server-to-Server OAuth app

The proxy uses the **`account_credentials`** grant — no user interaction, just
account-level credentials. That requires the **Server-to-Server OAuth** app
type (not "OAuth", not "JWT" — JWT was retired in 2023).

1. Go to **https://marketplace.zoom.us/develop/create**
2. Pick app type: **Server-to-Server OAuth**
3. Give it a name (e.g. `NOC Dashboard Phone Reader`)
4. On the **App Credentials** screen, copy:
   - **Account ID** → `.env` as `ZOOM_ACCOUNT_ID`
   - **Client ID** → `.env` as `ZOOM_CLIENT_ID`
   - **Client Secret** → `.env` as `ZOOM_CLIENT_SECRET`
5. Fill in the required **Information** tab (name, short description, company)
   — Zoom won't let you activate without it, but the values don't matter for
   an internal app.

## 2. Required OAuth scopes

These are the **granular scopes** (Zoom migrated from classic to granular in
2024). Add them under the **Scopes** tab → **Add Scopes**.

### Zoom Phone — call queue + roster

These give us the NOC queue, its members, and basic phone-user metadata.

| Scope | Purpose | API endpoint(s) used |
|---|---|---|
| `phone:read:list_call_queues:admin` | Discover the NOC queue by name when `ZOOM_QUEUE_ID` is a name fragment | `GET /phone/call_queues` |
| `phone:read:call_queue:admin` | Resolve queue name when `ZOOM_QUEUE_ID` is a literal ID | `GET /phone/call_queues/{queueId}` |
| `phone:read:list_call_queue_members:admin` | Fetch the roster of agents assigned to the queue | `GET /phone/call_queues/{queueId}/members` |
| `phone:read:list_users:admin` | Fallback roster when `ZOOM_QUEUE_ID` is not set — lists every Zoom Phone user on the account | `GET /phone/users` |
| `phone:read:user:admin` | (Optional, future) read individual phone-user metadata | `GET /phone/users/{userId}` |

### Zoom Phone — real-time call state

This is the signal that tells the dashboard which agents are **on a call right
now**, and for how long.

| Scope | Purpose | API endpoint(s) used |
|---|---|---|
| `phone:read:list_calls:admin` | Pull every active call (`call_status=in_progress`) so we can mark agents as "on call" with a live duration counter | `GET /phone/calls?call_status=in_progress` |

> ⚠️ If your Zoom Phone plan does **not** include this scope, the widget still
> works — agents just won't show an "on call" status from this signal. The
> proxy logs a one-line warning and falls back to presence-only data.

### Zoom (core) — presence

Tells us whether each agent is *available*, *in a meeting*, *away*, or in *do
not disturb* / *out of office*. This drives the `ready` vs `not_ready` split
for agents who aren't on a phone call.

| Scope | Purpose | API endpoint(s) used |
|---|---|---|
| `user:read:presence_status:admin` | Read each roster member's chat/meeting presence | `GET /users/{userId}/presence_status` |

### Summary — full scope list to paste into the app

```
phone:read:list_call_queues:admin
phone:read:call_queue:admin
phone:read:list_call_queue_members:admin
phone:read:list_users:admin
phone:read:user:admin
phone:read:list_calls:admin
user:read:presence_status:admin
```

That's **7 scopes**, all admin-level reads, no writes. Nothing here lets the
app send messages, place calls, change settings, or modify users.

## 3. Activate the app

Once scopes are added:

1. Go to **Activation** tab → click **Activate your app**
2. Zoom validates that the scopes exist on your account's plan. If you see a
   "scope not allowed" error, your Zoom plan doesn't include Phone or CEP —
   you'll need to either upgrade or remove the unsupported scope.

## 4. Add credentials to `.env`

```bash
ZOOM_ACCOUNT_ID=<from app credentials>
ZOOM_CLIENT_ID=<from app credentials>
ZOOM_CLIENT_SECRET=<from app credentials>

# Optional but recommended — restrict to a single queue.
# Accepts either a queue ID (~22 chars) or a name fragment ("NOC", "Support").
ZOOM_QUEUE_ID=NOC

# Optional — display name if no queue is matched
ZOOM_QUEUE_NAME=NOC Support
```

Vite hot-reloads `.env` automatically — no server restart needed.

## 5. Verify it's live

Open the dashboard. The Zoom queue widget should show:

- **Header badge: `Zoom: live`** (green) instead of `Zoom: snapshot` (yellow)
- Real names from your Zoom Phone account
- Live "on call" durations that increment as calls progress
- "In meeting" / "Away" sub-statuses pulled from each agent's presence

If you see `Zoom: snapshot` (yellow) and a warning toast, hit the endpoint
directly to see the exact failure:

```bash
curl -s http://localhost:5173/api/zoom/queue | jq .warning
```

Common warnings and fixes:

| Warning | Fix |
|---|---|
| `Zoom OAuth failed (401)` | Wrong `ZOOM_CLIENT_SECRET`, or the app isn't activated yet |
| `Zoom OAuth failed (400) invalid account_id` | `ZOOM_ACCOUNT_ID` mismatch — it's the **account** ID, not the user's email |
| `Zoom /phone/call_queues (403)` | Missing `phone:read:list_call_queues:admin` scope, OR the account doesn't have Zoom Phone |
| `Queue "X" not found among Y call queues` | `ZOOM_QUEUE_ID` doesn't match — the error message lists the first 5 queues to choose from |
| `/phone/calls unavailable` (log warning, NOT a hard error) | Missing `phone:read:list_calls:admin` — widget still works, just without live on-call duration |

## 6. (Optional) lock the app to your account only

On the **Information** tab, leave **Distribution** set to "Account-level only".
That way the app can never be installed by another Zoom workspace, even if
someone else got hold of the client secret.

## 7. Rotating credentials

If `ZOOM_CLIENT_SECRET` ever leaks:

1. Marketplace app → **App Credentials** → **Regenerate** client secret
2. Update `.env` with the new value
3. Vite picks it up on the next request — no server restart

---

## Reference — API endpoints the proxy calls

For reviewers / future maintainers, here's the exact set of HTTP calls
`vite-plugins/zoom-proxy.ts` makes per dashboard load:

```
POST https://zoom.us/oauth/token  (cached for 1 hour)
GET  https://api.zoom.us/v2/phone/call_queues                      (only if ZOOM_QUEUE_ID is a name fragment)
GET  https://api.zoom.us/v2/phone/call_queues/{id}                 (resolves queue name)
GET  https://api.zoom.us/v2/phone/call_queues/{id}/members         (or /phone/users if no queue set)
GET  https://api.zoom.us/v2/phone/calls?call_status=in_progress    (best-effort, optional scope)
GET  https://api.zoom.us/v2/users/{userId}/presence_status         (per agent, parallelized, capped at 30/load)
```

All requests use `Authorization: Bearer <access_token>`. The token is cached
in-memory for 1 hour minus 60 seconds and refreshed on the next call.
