import { IconDeviceMobileMessage } from "@tabler/icons-react";
import { WidgetTile } from "../WidgetTile";
import { TroubleshooterTilePreview } from "../Troubleshooter/TroubleshooterChat";

interface Props {
  onExpand: () => void;
}

export function MobilityTroubleshooterTile({ onExpand }: Props) {
  return (
    <WidgetTile
      title="Mobility Troubleshooter"
      description="AI agent for wireless + device issues"
      icon={IconDeviceMobileMessage}
      iconColor="violet"
      onExpand={onExpand}
    >
      <TroubleshooterTilePreview
        storageKey="mobility-troubleshooter:history:v1"
        accentColor="violet"
      />
    </WidgetTile>
  );
}
