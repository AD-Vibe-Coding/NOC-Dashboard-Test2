import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Divider,
  Drawer,
  Group,
  ScrollArea,
  Stack,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconBug, IconTrash, IconAlertTriangle } from "@tabler/icons-react";
import {
  clearRuntimeAuditEvents,
  readRuntimeAuditEvents,
  type RuntimeAuditEvent,
} from "../lib/runtime-audit";

function useRuntimeAuditEvents() {
  const [events, setEvents] = useState<RuntimeAuditEvent[]>([]);

  useEffect(() => {
    const sync = () => setEvents(readRuntimeAuditEvents());
    sync();
    window.addEventListener("runtime-audit:updated", sync as EventListener);
    window.addEventListener("runtime-audit:cleared", sync as EventListener);
    return () => {
      window.removeEventListener("runtime-audit:updated", sync as EventListener);
      window.removeEventListener("runtime-audit:cleared", sync as EventListener);
    };
  }, []);

  return events;
}

export function RuntimeAuditPanel() {
  const [opened, setOpened] = useState(false);
  const events = useRuntimeAuditEvents();
  const errorCount = useMemo(() => events.filter((event) => event.level === "error").length, [events]);

  return (
    <>
      <Tooltip label="Runtime audit" withArrow>
        <Box pos="relative">
          <ActionIcon variant="default" size="lg" radius="md" onClick={() => setOpened(true)} aria-label="Open runtime audit">
            <IconBug size={18} />
          </ActionIcon>
          {errorCount > 0 && (
            <Badge
              size="xs"
              color="red"
              variant="filled"
              radius="xl"
              style={{ position: "absolute", top: -6, right: -6, pointerEvents: "none" }}
            >
              {errorCount > 9 ? "9+" : errorCount}
            </Badge>
          )}
        </Box>
      </Tooltip>

      <Drawer
        opened={opened}
        onClose={() => setOpened(false)}
        title="Runtime audit"
        position="right"
        size="lg"
      >
        <Stack gap="md" h="100%">
          <Group justify="space-between" align="center">
            <Box>
              <Text fw={600}>Captured widget and browser runtime errors</Text>
              <Text size="sm" c="dimmed">
                This panel keeps the latest in-browser render crashes, unhandled promise rejections, and boundary captures for this session.
              </Text>
            </Box>
            <Button
              size="xs"
              variant="light"
              color="red"
              leftSection={<IconTrash size={14} />}
              onClick={() => clearRuntimeAuditEvents()}
            >
              Clear log
            </Button>
          </Group>

          <Divider />

          {events.length === 0 ? (
            <Group gap="sm">
              <IconAlertTriangle size={16} />
              <Text size="sm" c="dimmed">No runtime errors captured in this session.</Text>
            </Group>
          ) : (
            <ScrollArea h="calc(100vh - 220px)" offsetScrollbars>
              <Table withTableBorder withColumnBorders striped highlightOnHover fz="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Time</Table.Th>
                    <Table.Th>Source</Table.Th>
                    <Table.Th>Label</Table.Th>
                    <Table.Th>Message</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {events.map((event) => (
                    <Table.Tr key={event.id}>
                      <Table.Td>
                        <Text size="xs">{new Date(event.timestamp).toLocaleTimeString()}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge size="xs" color={event.level === "error" ? "red" : "yellow"} variant="light">
                          {event.source}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Stack gap={2}>
                          <Text size="xs" fw={600}>{event.label}</Text>
                          {event.url && <Text size="xs" c="dimmed">{event.url}</Text>}
                        </Stack>
                      </Table.Td>
                      <Table.Td>
                        <Stack gap={2}>
                          <Text size="xs">{event.message}</Text>
                          {event.details && <Text size="xs" c="dimmed">{event.details}</Text>}
                          {event.stack && (
                            <Text size="xs" c="dimmed" ff="monospace" lineClamp={4}>
                              {event.stack}
                            </Text>
                          )}
                        </Stack>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          )}
        </Stack>
      </Drawer>
    </>
  );
}
