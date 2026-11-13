import { useEffect, useState } from "react";
import { Alert, Badge, Button, Card, Group, Loader, Stack, Table, Text } from "@mantine/core";
import { IconAlertCircle, IconCheck, IconRefresh } from "@tabler/icons-react";
import type { ZoomQueueData } from "../../lib/zoom";

type RingCentralStatus = {
  provider: string;
  authType?: string;
  configured: boolean;
  connected: boolean;
  serverUrl?: string | null;
  redirectUri?: string | null;
  oauthSessionPresent?: boolean;
  tokenCached?: boolean;
  tokenOwnerId?: string | null;
  tokenExpiresAt?: string | null;
  warning?: string | null;
  extension?: {
    id?: string | null;
    name?: string | null;
    email?: string | null;
  } | null;
};

export function RingCentralTestPanel() {
  const [status, setStatus] = useState<RingCentralStatus | null>(null);
  const [queue, setQueue] = useState<ZoomQueueData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [statusRes, queueRes] = await Promise.all([
        fetch("/api/ringcentral/me", { cache: "no-store" }),
        fetch("/api/ringcentral/queue", { cache: "no-store" }),
      ]);

      if (!statusRes.ok) throw new Error(`RingCentral status failed (${statusRes.status})`);
      if (!queueRes.ok) throw new Error(`RingCentral queue failed (${queueRes.status})`);

      const [statusJson, queueJson] = await Promise.all([statusRes.json(), queueRes.json()]);
      setStatus(statusJson as RingCentralStatus);
      setQueue(queueJson as ZoomQueueData);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function disconnect() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ringcentral/disconnect", { method: "POST" });
      if (!res.ok) throw new Error(`RingCentral disconnect failed (${res.status})`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center" wrap="wrap">
        <Stack gap={2}>
          <Text fw={600}>RingCentral diagnostics</Text>
          <Text size="sm" c="dimmed">
            This tab now uses server-side OAuth authorization code flow for RingCentral testing and stores the connected session in secure cookies.
          </Text>
        </Stack>
        <Group gap="xs">
          <Button component="a" href="/api/ringcentral/auth-start" size="xs" color="blue" variant={status?.connected ? "default" : "filled"}>
            {status?.connected ? "Reconnect RingCentral" : "Connect RingCentral"}
          </Button>
          <Button size="xs" variant="light" onClick={() => void refresh()} leftSection={<IconRefresh size={14} />}>
            Refresh RC
          </Button>
          <Button size="xs" variant="subtle" color="red" onClick={() => void disconnect()} disabled={!status?.oauthSessionPresent && !status?.connected}>
            Disconnect
          </Button>
        </Group>
      </Group>

      {error && (
        <Alert color="red" icon={<IconAlertCircle size={16} />} radius="md" variant="light">
          {error}
        </Alert>
      )}

      <Group gap="sm" wrap="wrap">
        <Badge color={status?.configured ? "blue" : "gray"} variant="light">
          Configured: {status?.configured ? "Yes" : "No"}
        </Badge>
        <Badge color={status?.oauthSessionPresent ? "blue" : "gray"} variant="light">
          OAuth session: {status?.oauthSessionPresent ? "Present" : "Missing"}
        </Badge>
        <Badge color={status?.connected ? "green" : "yellow"} variant="light">
          Connected: {status?.connected ? "Yes" : "No"}
        </Badge>
        <Badge color={queue?.source === "live" ? "green" : "yellow"} variant="light">
          Queue source: {queue?.source ?? "unknown"}
        </Badge>
        {loading && <Loader size="sm" />}
      </Group>

      {status?.warning && (
        <Alert color="yellow" icon={<IconAlertCircle size={16} />} radius="md" variant="light">
          {status.warning}
        </Alert>
      )}

      <Card withBorder radius="md" padding="md">
        <Stack gap="xs">
          <Text fw={600}>OAuth details</Text>
          <Text size="sm"><strong>Auth type:</strong> {status?.authType ?? "oauth"}</Text>
          <Text size="sm"><strong>Server URL:</strong> {status?.serverUrl ?? "—"}</Text>
          <Text size="sm"><strong>Redirect URI:</strong> {status?.redirectUri ?? "—"}</Text>
          <Text size="sm"><strong>Session cookie:</strong> {status?.oauthSessionPresent ? "Present" : "Missing"}</Text>
          <Text size="sm"><strong>Token cached:</strong> {status?.tokenCached ? "Yes" : "No"}</Text>
          <Text size="sm"><strong>Token owner:</strong> {status?.tokenOwnerId ?? "—"}</Text>
          <Text size="sm"><strong>Token expires:</strong> {status?.tokenExpiresAt ?? "—"}</Text>
          {status?.extension?.name && (
            <Text size="sm">
              <strong>Connected account:</strong> {status.extension.name}
              {status.extension.email ? ` (${status.extension.email})` : ""}
            </Text>
          )}
        </Stack>
      </Card>

      <Card withBorder radius="md" padding="md">
        <Stack gap="sm">
          <Text fw={600}>RingCentral queue snapshot</Text>
          <Text size="sm" c="dimmed">
            This is isolated diagnostic output from <code>/api/ringcentral/queue</code>. The main Team Availability board now reads from the same RingCentral queue source.
          </Text>
          <Table striped highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Agent</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Queues</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(queue?.agents ?? []).map((agent) => (
                <Table.Tr key={agent.agent_id}>
                  <Table.Td>{agent.display_name}</Table.Td>
                  <Table.Td>
                    <Badge
                      color={agent.status === "in_queue" ? "green" : "gray"}
                      leftSection={agent.status === "in_queue" ? <IconCheck size={12} /> : undefined}
                      variant="light"
                    >
                      {agent.status === "in_queue" ? "In queue" : "Not in queue"}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{agent.queues.join(", ") || "—"}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Stack>
      </Card>
    </Stack>
  );
}
