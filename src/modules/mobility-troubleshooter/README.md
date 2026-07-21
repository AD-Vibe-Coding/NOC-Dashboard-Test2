# Mobility Troubleshooter module

This module extracts the Mobility Troubleshooter into a reusable app module.

## Public exports

- `MobilityTroubleshooterModule`
- `MobilityTroubleshooterTile`
- `useMobilityGuides`
- `TroubleshootWizard`

## Still required from the host app

### Data / logic
- `src/data/troubleshooting/**`
- `src/lib/troubleshooting/**`
- `src/lib/mobility-confluence.ts`
- `src/lib/mobility-guides.ts`
- `src/lib/ota-guide.ts`
- `src/lib/fetch-resilient.ts`

### UI shell
- `src/widgets/WidgetFrame.tsx`
- `src/widgets/WidgetTile.tsx`

### Backend
- `api/confluence/mobility.ts`
- `api/_lib/mobility-guides.ts`

## Current coupling

`MobilityTroubleshooterModule.tsx` currently imports:
- `../../widgets/WidgetFrame`
- `../../widgets/MobilityTroubleshooter/data`
- `../../widgets/MobilityTroubleshooter/TroubleshootWizard`

That means the module is extracted behind a stable public API first. For a fully portable package, the next step would be to move `data.ts`, `TroubleshootWizard.tsx`, and a generic shell adapter into this module too.

## Minimal usage

```tsx
import { MobilityTroubleshooterModule } from "@/modules/mobility-troubleshooter";

export default function Page() {
  return <MobilityTroubleshooterModule />;
}
```
