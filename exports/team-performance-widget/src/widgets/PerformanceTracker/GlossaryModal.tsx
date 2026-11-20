import { Badge, Group, List, Modal, Stack, Table, Text, ThemeIcon, Title } from "@mantine/core";
import { IconBook2, IconTargetArrow } from "@tabler/icons-react";
import { KPI_DEFS, meetsTarget } from "./kpiConfig";

export function GlossaryModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  return (
    <Modal opened={opened} onClose={onClose} size="xl" title={<Group gap="xs"><IconBook2 size={18} /><Text fw={600}>Performance metric glossary</Text></Group>} withinPortal>
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Every KPI below uses the same active queue, maintenance, day-type, shift, and month filters shown on screen.
        </Text>
        {KPI_DEFS.map((def) => (
          <Stack key={def.key} gap="xs">
            <Group gap="xs" wrap="wrap">
              <Title order={6}>{def.label}</Title>
              <Badge variant="light" color={def.group === "tickets" ? "blue" : def.group === "calls" ? "green" : "orange"}>
                {def.group}
              </Badge>
              {def.target && (
                <Badge variant="outline" color={meetsTarget(def.target, def.target.kind === "max" ? def.target.value : def.target.value) !== null ? "teal" : "gray"}>
                  Target: {def.target.label}
                </Badge>
              )}
            </Group>
            <Table withTableBorder withColumnBorders striped>
              <Table.Tbody>
                <Table.Tr>
                  <Table.Th w={180}>What it measures</Table.Th>
                  <Table.Td>{def.description}</Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Th>Calculation</Table.Th>
                  <Table.Td>{def.formula}</Table.Td>
                </Table.Tr>
                {def.target && (
                  <Table.Tr>
                    <Table.Th>Target</Table.Th>
                    <Table.Td>
                      <Group gap="xs">
                        <ThemeIcon size="sm" radius="xl" variant="light" color="teal">
                          <IconTargetArrow size={12} />
                        </ThemeIcon>
                        <Text size="sm">{def.target.label}</Text>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                )}
                <Table.Tr>
                  <Table.Th>Included</Table.Th>
                  <Table.Td>
                    <List size="sm" spacing={2}>
                      {def.inclusions.map((item) => <List.Item key={item}>{item}</List.Item>)}
                    </List>
                  </Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Th>Excluded</Table.Th>
                  <Table.Td>
                    <List size="sm" spacing={2}>
                      {def.exclusions.map((item) => <List.Item key={item}>{item}</List.Item>)}
                    </List>
                  </Table.Td>
                </Table.Tr>
              </Table.Tbody>
            </Table>
          </Stack>
        ))}
      </Stack>
    </Modal>
  );
}
