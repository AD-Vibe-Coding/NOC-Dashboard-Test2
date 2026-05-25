import { Badge, Box, Group, Stack, Text, Title } from "@mantine/core";
import { IconGavel, IconStarFilled } from "@tabler/icons-react";
import { WidgetTile } from "../WidgetTile";
import { gradeColor, scoreColor, useTicketAudits } from "./data";

interface Props {
  onExpand: () => void;
}

export function TicketAuditTile({ onExpand }: Props) {
  const { audits, loading } = useTicketAudits();

  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthAudits = audits.filter((a) => a.audit_month === thisMonth);
  const avgScore =
    monthAudits.length > 0
      ? Math.round(
          monthAudits.reduce((s, a) => s + (a.overall_score ?? 0), 0) /
            monthAudits.length,
        )
      : null;
  const latest = audits[0];

  return (
    <WidgetTile
      title="Ticket Audit"
      description="AI quality audits from MHTML ticket files"
      icon={IconGavel}
      iconColor="violet"
      status={{ label: "AI", color: "violet", tooltip: "Powered by Devs.ai audit agent" }}
      onExpand={onExpand}
    >
      <Stack gap="sm" style={{ height: "100%" }}>
        <Group align="flex-end" justify="space-between" wrap="nowrap">
          <Box>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              This Month
            </Text>
            <Title order={1} c="violet" style={{ lineHeight: 1 }} mt={2}>
              {loading ? "…" : monthAudits.length}
            </Title>
            <Text size="xs" c="dimmed" mt={2}>
              audits · {audits.length} total
            </Text>
          </Box>
          {avgScore !== null ? (
            <Badge
              variant="light"
              color={scoreColor(avgScore)}
              leftSection={<IconStarFilled size={10} />}
              size="sm"
            >
              Avg {avgScore}
            </Badge>
          ) : (
            <Badge variant="light" color="gray" size="sm">
              No audits yet
            </Badge>
          )}
        </Group>

        {latest ? (
          <Box
            p="xs"
            style={{
              border: "1px dashed var(--mantine-color-dark-4)",
              borderRadius: 6,
              minWidth: 0,
            }}
          >
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Last audit</Text>
            <Text size="sm" fw={500} truncate>
              {latest.agent_name ?? latest.ticket_number ?? latest.file_name}
            </Text>
            <Group gap={6} mt={2}>
              {latest.overall_score !== null && (
                <Badge size="xs" color={scoreColor(latest.overall_score)} variant="light">
                  {latest.overall_score}
                </Badge>
              )}
              {latest.grade && (
                <Badge size="xs" color={gradeColor(latest.grade)} variant="light">
                  {latest.grade}
                </Badge>
              )}
            </Group>
          </Box>
        ) : (
          <Text size="xs" c="dimmed" ta="center" mt="md">
            No audits yet — click to upload your first .mhtml
          </Text>
        )}
      </Stack>
    </WidgetTile>
  );
}
