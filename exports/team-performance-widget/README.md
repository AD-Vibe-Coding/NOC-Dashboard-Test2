# Team Performance widget — portable source bundle

This bundle contains the Team Performance widget’s active React/TypeScript source, a focused database client/schema, its required Vercel-style API routes, and migration notes. It is a source bundle, not a turnkey deployment: identity, authorization, database credentials, and app-shell integration must be connected to the destination app.

## What’s included

- `src/widgets/PerformanceTracker/` — overview, trends, workbook import/normalization, raw-data drill-down, KPI configuration/glossary, disputes, team roster aliases, tile, and debug helpers.
- `src/widgets/WidgetFrame.tsx` and `src/widgets/WidgetTile.tsx` — the source app’s shared presentation wrappers.
- `src/lib/` — same-origin API client, download helper, identity context, and source-app role mapping.
- `src/db/schema.ts` and `src/db/index.ts` — only the three widget tables plus a focused per-table API client.
- `api/` — import, metrics, and dispute routes with shared CRUD/Supabase/auth helpers.
- `vite-plugins/appbuilder-api-dev-server.ts` — local Vite adapter for the API routes.
- `.env.example` — names of server-only variables; it contains no credentials.

## Move it into another Vite/React app

1. Copy the `src/widgets/PerformanceTracker/` directory into the target app. It imports `../WidgetFrame`, `../WidgetTile`, `../../lib/identity`, `../../lib/download`, and `../../db`; keep or adapt those shared modules.
2. Add the widget to the target dashboard. The exports are named:

   ```tsx
   import { PerformanceTrackerTile } from "@/widgets/PerformanceTracker/Tile";
   import { PerformanceTrackerWidget } from "@/widgets/PerformanceTracker";
   ```

   `PerformanceTrackerTile` takes `{ onExpand: () => void }`; render `PerformanceTrackerWidget` in the target app’s expanded-widget surface when it opens.
3. Merge the declarations in `src/db/schema.ts` into the target app’s existing schema. The required tables are `performance_imports`, `performance_metrics`, and `metric_disputes`. Do not overwrite the target app’s schema or database client. `src/db/index.ts` is a minimal example implementing the exact `db`, `dbReady`, and `schema` interface this widget expects; adapt it if the target app uses a different persistence layer.
4. Copy the relevant collection/item handlers from `api/` and ensure the target backend provides `/api/performance_imports`, `/api/performance_metrics`, and `/api/metric_disputes` plus the item/review paths. Merge shared server helpers deliberately. The handlers use Vercel-style ESM imports with explicit `.js` extensions.
5. For local Vite API requests, merge/register `appbuilderApiDevServer()` from `vite-plugins/appbuilder-api-dev-server.ts` in the target `vite.config.ts`; keep the target app’s other config and plugins.
6. Wrap the UI in Mantine’s `<MantineProvider>`. Supply a `useIdentity()` compatible identity with at least `identity.name` and `identity.role`, or replace those imports with the target app’s auth context. The included names, aliases, emails, and role rules are source-app-specific; update them before using the widget in the destination.
7. Provision the three tables through the target database’s supported schema workflow. The API helper uses Supabase server-side with a service-role key; never expose that key to browser code. Review and enforce destination-app authorization for metric reads, imports/deletes, dispute creation, and manager review before deployment.

## Dependencies

The widget UI uses React/React DOM, `@mantine/core` v7, `@tabler/icons-react`, `xlsx`, and `drizzle-orm` for schema typing. The included server-side routes additionally use `@supabase/supabase-js`, `@vercel/node`, and `dotenv` in the source-app development environment. Keep the target app’s React version and install compatible versions of missing packages; do not copy the source app’s entire `package.json`.

## Important migration notes

- `.env.example` intentionally has blank values. Register secrets using the target platform’s secret manager; keep `SUPABASE_SERVICE_ROLE_KEY` and `SESSION_SECRET` server-only.
- Auth/session helpers and role checks are specific to the source app. Keep the destination app’s current auth system or adapt these references rather than blindly replacing it.
- `team.ts` includes the source app’s locked performance roster and aliases. Update it for the destination team.
- `PerformanceTrackerWidget` includes the source app’s snapshot-demo member and a debug console helper; review whether to keep these.
- This bundle does not include the target app’s `package.json`, `vite.config.ts`, `index.html`, or Supabase project configuration. Merge those pieces deliberately.
