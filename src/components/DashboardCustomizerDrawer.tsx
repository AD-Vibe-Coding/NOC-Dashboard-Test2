import { useState } from "react";
import {
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Drawer,
  Group,
  Stack,
  Switch,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { IconArrowsMove, IconEye, IconEyeOff, IconGripVertical, IconRotate } from "@tabler/icons-react";
import {
  DASHBOARD_TEMPLATES,
  type DashboardSectionKey,
  useDashboardPreferences,
} from "../lib/dashboard-preferences";

type LayoutItem = {
  id: string;
  label: string;
  color: string;
  icon: React.ComponentType<{ size?: number }>;
};

type LayoutSection = {
  key: DashboardSectionKey;
  title: string;
  hidden: boolean;
  items: LayoutItem[];
};

export function DashboardCustomizerDrawer({
  opened,
  onClose,
  sections,
}: {
  opened: boolean;
  onClose: () => void;
  sections: LayoutSection[];
}) {
  const {
    template,
    moveSection,
    moveWidget,
    toggleSectionVisibility,
    resetCurrentTemplateLayout,
  } = useDashboardPreferences();
  const activeTemplate = DASHBOARD_TEMPLATES.find((item) => item.value === template);
  const [dragSectionKey, setDragSectionKey] = useState<DashboardSectionKey | null>(null);
  const [dragWidget, setDragWidget] = useState<{ sectionKey: DashboardSectionKey; itemId: string } | null>(null);

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="md"
      title="Customize dashboard"
      padding="lg"
    >
      <Stack gap="lg">
        <Card withBorder radius="lg" p="md">
          <Group justify="space-between" align="flex-start">
            <Box>
              <Text fw={600}>Editing {activeTemplate?.label ?? "Classic"} template</Text>
              <Text size="sm" c="dimmed" mt={4}>
                Drag sections or widgets to rearrange your dashboard. Hide sections you do not want to see.
              </Text>
            </Box>
            <Button
              variant="light"
              color="gray"
              leftSection={<IconRotate size={14} />}
              onClick={resetCurrentTemplateLayout}
            >
              Reset
            </Button>
          </Group>
        </Card>

        {sections.map((section) => (
          <Card
            key={section.key}
            withBorder
            radius="lg"
            p="md"
            draggable
            onDragStart={() => setDragSectionKey(section.key)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (dragSectionKey && dragSectionKey !== section.key) {
                moveSection(dragSectionKey, section.key);
              }
              setDragSectionKey(null);
            }}
            style={{
              cursor: "grab",
              opacity: dragSectionKey === section.key ? 0.55 : 1,
            }}
          >
            <Stack gap="md">
              <Group justify="space-between" align="center">
                <Group gap="sm" align="center">
                  <ThemeIcon variant="light" color="gray" radius="md">
                    <IconGripVertical size={16} />
                  </ThemeIcon>
                  <Box>
                    <Text fw={600}>{section.title}</Text>
                    <Text size="xs" c="dimmed">
                      {section.items.length} widgets
                    </Text>
                  </Box>
                </Group>
                <Switch
                  checked={!section.hidden}
                  onChange={() => toggleSectionVisibility(section.key)}
                  onLabel={<IconEye size={12} />}
                  offLabel={<IconEyeOff size={12} />}
                  label={section.hidden ? "Hidden" : "Visible"}
                />
              </Group>

              <Divider />

              <Stack gap="xs">
                {section.items.map((item) => (
                  <Box
                    key={item.id}
                    draggable
                    onDragStart={(event) => {
                      event.stopPropagation();
                      setDragWidget({ sectionKey: section.key, itemId: item.id });
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (dragWidget) {
                        moveWidget(dragWidget.sectionKey, section.key, dragWidget.itemId, item.id);
                      }
                      setDragWidget(null);
                    }}
                    style={{
                      border: "1px solid var(--mantine-color-default-border)",
                      borderRadius: 12,
                      padding: 12,
                      opacity: dragWidget?.itemId === item.id ? 0.45 : 1,
                      cursor: "grab",
                    }}
                  >
                    <Group justify="space-between" align="center" wrap="nowrap">
                      <Group gap="sm" wrap="nowrap">
                        <ThemeIcon variant="light" color={item.color} radius="md">
                          <item.icon size={16} />
                        </ThemeIcon>
                        <Box>
                          <Text size="sm" fw={600}>{item.label}</Text>
                          <Text size="xs" c="dimmed">Drag to reorder or move to another section</Text>
                        </Box>
                      </Group>
                      <Badge variant="light" color="gray" leftSection={<IconArrowsMove size={10} />}>
                        Move
                      </Badge>
                    </Group>
                  </Box>
                ))}

                <Box
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragWidget) {
                      moveWidget(dragWidget.sectionKey, section.key, dragWidget.itemId);
                    }
                    setDragWidget(null);
                  }}
                  style={{
                    border: "1px dashed var(--mantine-color-default-border)",
                    borderRadius: 12,
                    padding: 10,
                    textAlign: "center",
                  }}
                >
                  <Text size="xs" c="dimmed">Drop here to move widget to the end of {section.title}</Text>
                </Box>
              </Stack>
            </Stack>
          </Card>
        ))}
      </Stack>
    </Drawer>
  );
}
