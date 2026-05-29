import { ActionIcon, Menu, Stack, Text, Tooltip } from "@mantine/core";
import { IconCheck, IconLayoutGrid } from "@tabler/icons-react";
import {
  DASHBOARD_TEMPLATES,
  useDashboardPreferences,
} from "../lib/dashboard-preferences";

export function DashboardTemplatePicker() {
  const { template, setTemplate } = useDashboardPreferences();
  const active = DASHBOARD_TEMPLATES.find((item) => item.value === template);

  return (
    <Menu shadow="md" width={320} position="bottom-end">
      <Menu.Target>
        <Tooltip label={`Dashboard template: ${active?.label ?? "Classic"}`} withArrow>
          <ActionIcon variant="default" size="lg" radius="md" aria-label="Choose dashboard template">
            <IconLayoutGrid size={18} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>

      <Menu.Dropdown>
        <Menu.Label>My dashboard template</Menu.Label>
        {DASHBOARD_TEMPLATES.map((item) => (
          <Menu.Item
            key={item.value}
            onClick={() => setTemplate(item.value)}
            leftSection={template === item.value ? <IconCheck size={14} /> : <IconLayoutGrid size={14} />}
          >
            <Stack gap={2}>
              <Text size="sm" fw={600}>{item.label}</Text>
              <Text size="xs" c="dimmed">{item.description}</Text>
            </Stack>
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
