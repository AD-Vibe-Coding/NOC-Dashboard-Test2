# Zoom API setup (Zoom Queue widget)

The Zoom Queue widget supports two modes:

- **Live**: reads real Zoom Phone queue/user/call status via server-side API calls
- **Snapshot**: fallback demo data if Zoom credentials are not configured

## 1) Create a Server-to-Server OAuth app in Zoom

In Zoom Marketplace, create a **Server-to-Server OAuth** app and grant these scopes:

- `phone:read:list_users:admin`
- `phone:read:user:admin`
- `phone:read:list_call_queues:admin`
- `phone:read:list_call_queue_members:admin`
- `phone:read:list_call_logs:admin` (search for "call_logs" in the scope picker)

For presence enrichment (optional but recommended):

- `user:read:status:admin`

## 2) Add env vars

Set these in `.env`:

```env
ZOOM_ACCOUNT_ID=...
ZOOM_CLIENT_ID=...
ZOOM_CLIENT_SECRET=...
# Optional: queue id or queue name fragment
ZOOM_QUEUE_ID=...
```

## 3) Restart dev server

```bash
npm run dev
```

Then open **Zoom Queue** widget:
- `Zoom: live` = connected to Zoom API
- `Zoom: snapshot` = credentials/scopes missing or API fallback

## API endpoint

- Dev: `GET /api/zoom/queue` via Vite plugin (`vite-plugins/zoom-proxy.ts`)
- Server route: `api/zoom/queue.ts` for production/serverless runtimes
