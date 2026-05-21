import { IconActivityHeartbeat } from "@tabler/icons-react";
import { WidgetTile } from "../WidgetTile";
import { TroubleshooterTilePreview } from "../Troubleshooter/TroubleshooterChat";

interface Props {
  onExpand: () => void;
}

export function NocTroubleshooterTile({ onExpand }: Props) {
  return (
    <WidgetTile
      title="NOC Troubleshooter"
      description="AI agent for network + circuit issues"
      icon={IconActivityHeartbeat}
      iconColor="cyan"
      onExpand={onExpand}
    >
      <TroubleshooterTilePreview
        storageKey="noc-troubleshooter:history:v1"
        accentColor="cyan"
      />
    </WidgetTile>
  );
}
