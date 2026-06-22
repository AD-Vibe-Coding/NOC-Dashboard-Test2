import { useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Checkbox, Grid, Group, Progress, Select, Stack, Table, Text, TextInput } from "@mantine/core";
import { IconAlertCircle, IconSearch, IconWorldPin } from "@tabler/icons-react";
import { fetchVelocloudEdge, type VcEdgeResponse, type VcRange } from "../../lib/velocloud";
import { WidgetFrame } from "../WidgetFrame";
import { useVelocloud } from "./data";

export { VelocloudApiTile } from "./Tile";

function stateColor(state: "up" | "degraded" | "down") {
  if (state === "up") return "green";
  if (state === "degraded") return "yellow";
  return "red";
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 520;
  const h = 90;
  if (values.length < 2) return <Text size="xs" c="dimmed">Not enough points</Text>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: 90 }}>
      <polyline fill="none" stroke={color} strokeWidth="2.5" points={points} />
    </svg>
  );
}

export function VelocloudApiWidget() {
  const { data, loading, error, refresh } = useVelocloud();
  const [serial, setSerial] = useState("");
  const [edgeLoading, setEdgeLoading] = useState(false);
  const [edgeError, setEdgeError] = useState<string | null>(null);
  const [edgeData, setEdgeData] = useState<VcEdgeResponse | null>(null);
  const [range, setRange] = useState<VcRange>("24h");
  const [includePast, setIncludePast] = useState(false);

  async function handleSearchEdge() {
    const query = serial.trim();
    if (!query) return;
    setEdgeLoading(true);
    setEdgeError(null);
    try {
      const res = await fetchVelocloudEdge(query, { range, includePast });
      setEdgeData(res);
    } catch (err) {
      setEdgeError(err instanceof Error ? err.message : String(err));
      setEdgeData(null);
    } finally {
      setEdgeLoading(false);
    }
  }

  const latencySeries = useMemo(() => edgeData?.timeseries.map((p) => p.latency_ms) ?? [], [edgeData]);
  const jitterSeries = useMemo(() => edgeData?.timeseries.map((p) => p.jitter_ms) ?? [], [edgeData]);
  const lossSeries = useMemo(() => edgeData?.timeseries.map((p) => p.loss_pct) ?? [], [edgeData]);
  const rangeLabel = range === "1h" ? "Last 1 hour" : range === "7d" ? "Last 7 days" : "Last 24 hours";

  return (
    <WidgetFrame
      title="VeloCloud API"
      subtitle="Monitor SD-WAN alerts and link status"
      icon={IconWorldPin}
      iconColor="cyan"
      loading={loading}
      onRefresh={refresh}
      status={data ? { label: data.source === "live" ? "Live API" : "Snapshot", color: data.source === "live" ? "green" : "yellow", tooltip: data.warning ?? undefined } : undefined}
    >
      <Stack gap="md">
        {error && (
          <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
            {error}
          </Alert>
        )}

        {data?.warning && (
          <Alert color="yellow" variant="light" icon={<IconAlertCircle size={16} />}>
            {data.warning}
          </Alert>
        )}

        <Card withBorder radius="lg" p="md">
          <Group justify="space-between" mb="xs">
            <Text fw={700}>Link Health Summary</Text>
            <Badge variant="light" color="cyan">{data?.links.length ?? 0} links</Badge>
          </Group>
          <Progress
            value={data?.summary ? (data.summary.links_up / Math.max(1, data.links.length)) * 100 : 0}
            color="green"
          />
          <Group gap="xs" mt="sm">
            <Badge color="green" variant="light">{data?.summary.links_up ?? 0} up</Badge>
            <Badge color="yellow" variant="light">{data?.summary.links_degraded ?? 0} degraded</Badge>
            <Badge color="red" variant="light">{data?.summary.links_down ?? 0} down</Badge>
          </Group>
        </Card>

        <Card withBorder radius="lg" p="md">
          <Text fw={700} mb="sm">Active Alerts</Text>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Severity</Table.Th>
                <Table.Th>Edge</Table.Th>
                <Table.Th>Link</Table.Th>
                <Table.Th>Alert</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(data?.alerts ?? []).map((a) => (
                <Table.Tr key={a.id}>
                  <Table.Td><Badge color={a.severity === "critical" ? "red" : a.severity === "major" ? "orange" : a.severity === "minor" ? "yellow" : "blue"}>{a.severity}</Badge></Table.Td>
                  <Table.Td>{a.edge_name}</Table.Td>
                  <Table.Td>{a.link_name}</Table.Td>
                  <Table.Td>{a.title}</Table.Td>
                </Table.Tr>
              ))}
              {(data?.alerts.length ?? 0) === 0 && (
                <Table.Tr><Table.Td colSpan={4}><Text size="sm" c="dimmed">No active alerts</Text></Table.Td></Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Card>

        <Card withBorder radius="lg" p="md">
          <Text fw={700} mb="sm">Link Status</Text>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Edge</Table.Th>
                <Table.Th>Link</Table.Th>
                <Table.Th>State</Table.Th>
                <Table.Th>Latency</Table.Th>
                <Table.Th>Jitter</Table.Th>
                <Table.Th>Loss</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(data?.links ?? []).map((l) => (
                <Table.Tr key={`${l.edge_name}-${l.link_name}`}>
                  <Table.Td>{l.edge_name}</Table.Td>
                  <Table.Td>{l.link_name}</Table.Td>
                  <Table.Td><Badge color={stateColor(l.state)} variant="light">{l.state}</Badge></Table.Td>
                  <Table.Td>{l.latency_ms} ms</Table.Td>
                  <Table.Td>{l.jitter_ms} ms</Table.Td>
                  <Table.Td>{l.loss_pct}%</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>

        <Card withBorder radius="lg" p="md">
          <Group justify="space-between" align="end" mb="sm">
            <div>
              <Text fw={700}>Edge Lookup (Serial or Edge ID)</Text>
              <Text size="xs" c="dimmed">Examples: JDNBV43 or edge id like 12345</Text>
            </div>
            {edgeData ? <Badge variant="light" color={edgeData.source === "live" ? "green" : "yellow"}>{edgeData.source}</Badge> : null}
          </Group>

          <Group align="end" wrap="nowrap">
            <TextInput
              style={{ flex: 1 }}
              label="Edge Serial / Edge ID"
              placeholder="Enter serial or edge id (e.g. JDNBV43 or 12345)"
              value={serial}
              onChange={(e) => setSerial(e.currentTarget.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleSearchEdge();
                }
              }}
            />
            <Select
              label="Time range"
              value={range}
              onChange={(v) => setRange((v as VcRange) ?? "24h")}
              data={[
                { value: "1h", label: "Last 1 hour" },
                { value: "24h", label: "Last 24 hours" },
                { value: "7d", label: "Last 7 days" },
              ]}
              w={170}
            />
            <Button leftSection={<IconSearch size={14} />} loading={edgeLoading} onClick={() => void handleSearchEdge()}>
              Search
            </Button>
          </Group>

          <Checkbox
            mt="sm"
            label="Include past (cleared) edge/link alerts"
            checked={includePast}
            onChange={(e) => setIncludePast(e.currentTarget.checked)}
          />

          {edgeError ? (
            <Alert color="red" variant="light" mt="md" icon={<IconAlertCircle size={16} />}>
              {edgeError}
            </Alert>
          ) : null}

          {edgeData?.warning ? (
            <Alert color="yellow" variant="light" mt="md" icon={<IconAlertCircle size={16} />}>
              {edgeData.warning}
            </Alert>
          ) : null}

          {edgeData?.candidate_edges && edgeData.candidate_edges.length > 0 ? (
            <Card withBorder radius="md" p="sm" mt="sm">
              <Text size="xs" c="dimmed" mb={6}>Possible edge matches</Text>
              <Group gap="xs">
                {edgeData.candidate_edges.slice(0, 8).map((c) => (
                  <Badge
                    key={c.value}
                    variant="outline"
                    color="cyan"
                    style={{ cursor: "pointer" }}
                    onClick={() => {
                      setSerial(c.value.toUpperCase());
                    }}
                  >
                    {c.label}
                  </Badge>
                ))}
              </Group>
            </Card>
          ) : null}

          {edgeData ? (
            <Stack gap="sm" mt="md">
              <Group gap="xs">
                <Badge variant="light" color="cyan">{edgeData.serial}</Badge>
                <Badge variant="outline" color="blue">{edgeData.edge_name}</Badge>
                <Badge color="red" variant="light">{edgeData.summary.total_alerts} alerts</Badge>
                <Badge color="teal" variant="light">{edgeData.timeseries_source}</Badge>
              </Group>

              <Grid>
                <Grid.Col span={{ base: 12, md: 4 }}>
                  <Card withBorder radius="md" p="xs">
                    <Text size="xs" c="dimmed">Latency (ms)</Text>
                    <Text fw={700}>Now {edgeData.metrics_summary.current_latency_ms.toFixed(1)}</Text>
                    <Text size="xs" c="dimmed">Avg {edgeData.metrics_summary.avg_latency_ms.toFixed(1)} · Max {edgeData.metrics_summary.max_latency_ms.toFixed(1)}</Text>
                  </Card>
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 4 }}>
                  <Card withBorder radius="md" p="xs">
                    <Text size="xs" c="dimmed">Jitter (ms)</Text>
                    <Text fw={700}>Now {edgeData.metrics_summary.current_jitter_ms.toFixed(1)}</Text>
                    <Text size="xs" c="dimmed">Avg {edgeData.metrics_summary.avg_jitter_ms.toFixed(1)} · Max {edgeData.metrics_summary.max_jitter_ms.toFixed(1)}</Text>
                  </Card>
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 4 }}>
                  <Card withBorder radius="md" p="xs">
                    <Text size="xs" c="dimmed">Loss (%)</Text>
                    <Text fw={700}>Now {edgeData.metrics_summary.current_loss_pct.toFixed(2)}</Text>
                    <Text size="xs" c="dimmed">Avg {edgeData.metrics_summary.avg_loss_pct.toFixed(2)} · Max {edgeData.metrics_summary.max_loss_pct.toFixed(2)}</Text>
                  </Card>
                </Grid.Col>
              </Grid>

              <Text fw={600} size="sm">Edge Links (Current)</Text>
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Link</Table.Th>
                    <Table.Th>State</Table.Th>
                    <Table.Th>Latency</Table.Th>
                    <Table.Th>Jitter</Table.Th>
                    <Table.Th>Loss</Table.Th>
                    <Table.Th>Updated</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {edgeData.links.map((l) => (
                    <Table.Tr key={`${l.edge_name}-${l.link_name}`}>
                      <Table.Td>{l.link_name}</Table.Td>
                      <Table.Td><Badge color={stateColor(l.state)} variant="light">{l.state}</Badge></Table.Td>
                      <Table.Td>{l.latency_ms} ms</Table.Td>
                      <Table.Td>{l.jitter_ms} ms</Table.Td>
                      <Table.Td>{l.loss_pct}%</Table.Td>
                      <Table.Td>{new Date(l.updated_at).toLocaleString()}</Table.Td>
                    </Table.Tr>
                  ))}
                  {edgeData.links.length === 0 ? <Table.Tr><Table.Td colSpan={6}><Text size="sm" c="dimmed">No link rows for this edge</Text></Table.Td></Table.Tr> : null}
                </Table.Tbody>
              </Table>

              <Text fw={600} size="sm">Active Edge Alerts</Text>
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Severity</Table.Th>
                    <Table.Th>Link</Table.Th>
                    <Table.Th>Alert</Table.Th>
                    <Table.Th>Started</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {(edgeData.active_alerts ?? edgeData.alerts).map((a) => (
                    <Table.Tr key={a.id}>
                      <Table.Td><Badge color={a.severity === "critical" ? "red" : a.severity === "major" ? "orange" : a.severity === "minor" ? "yellow" : "blue"}>{a.severity}</Badge></Table.Td>
                      <Table.Td>{a.link_name}</Table.Td>
                      <Table.Td>{a.title}</Table.Td>
                      <Table.Td>{new Date(a.started_at).toLocaleString()}</Table.Td>
                    </Table.Tr>
                  ))}
                  {(edgeData.active_alerts ?? edgeData.alerts).length === 0 ? <Table.Tr><Table.Td colSpan={4}><Text size="sm" c="dimmed">No active alerts for this edge</Text></Table.Td></Table.Tr> : null}
                </Table.Tbody>
              </Table>

              {includePast ? (
                <>
                  <Text fw={600} size="sm">Past Edge/Link Alerts</Text>
                  <Table striped highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Severity</Table.Th>
                        <Table.Th>Link</Table.Th>
                        <Table.Th>Alert</Table.Th>
                        <Table.Th>Started</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {(edgeData.historical_alerts ?? []).map((a) => (
                        <Table.Tr key={`past-${a.id}`}>
                          <Table.Td><Badge variant="light" color={a.severity === "critical" ? "red" : a.severity === "major" ? "orange" : a.severity === "minor" ? "yellow" : "blue"}>{a.severity}</Badge></Table.Td>
                          <Table.Td>{a.link_name}</Table.Td>
                          <Table.Td>{a.title}</Table.Td>
                          <Table.Td>{new Date(a.started_at).toLocaleString()}</Table.Td>
                        </Table.Tr>
                      ))}
                      {(edgeData.historical_alerts ?? []).length === 0 ? <Table.Tr><Table.Td colSpan={4}><Text size="sm" c="dimmed">No past alerts found for selected range</Text></Table.Td></Table.Tr> : null}
                    </Table.Tbody>
                  </Table>
                </>
              ) : null}

              <Text fw={600} size="sm">Edge Graphs ({rangeLabel}) · {edgeData.metrics_summary.sample_count} points</Text>
              <Card withBorder radius="md" p="sm">
                <Text size="xs" c="dimmed" mb={4}>Latency (ms)</Text>
                <Sparkline values={latencySeries} color="var(--mantine-color-cyan-5)" />
              </Card>
              <Card withBorder radius="md" p="sm">
                <Text size="xs" c="dimmed" mb={4}>Jitter (ms)</Text>
                <Sparkline values={jitterSeries} color="var(--mantine-color-yellow-5)" />
              </Card>
              <Card withBorder radius="md" p="sm">
                <Text size="xs" c="dimmed" mb={4}>Loss (%)</Text>
                <Sparkline values={lossSeries} color="var(--mantine-color-red-5)" />
              </Card>
            </Stack>
          ) : null}
        </Card>
      </Stack>
    </WidgetFrame>
  );
}
