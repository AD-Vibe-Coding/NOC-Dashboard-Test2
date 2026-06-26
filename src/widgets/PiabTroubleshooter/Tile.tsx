import { IconBook } from "@tabler/icons-react";
import { WidgetTile } from "../WidgetTile";
import { TroubleshooterTilePreview } from "../Troubleshooter/TroubleshooterChat";

interface Props {
  onExpand: () => void;
}

export function PiabTroubleshooterTile({ onExpand }: Props) {
  return (
    <WidgetTile
      title="PIAB Troubleshooter"
      description="Ask the PIAB Knowledge Base agent for guided troubleshooting"
      icon={IconBook}
      iconColor="indigo"
      onExpand={onExpand}
    >
      <TroubleshooterTilePreview
        storageKey="piab-troubleshooter:history:v1"
        accentColor="indigo"
      />
    </WidgetTile>
  );
}
