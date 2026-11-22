import { useMantineColorScheme } from "@mantine/core";
import { Badge, Group, Stack, Text } from "@mantine/core";
import { IconChartBar } from "@tabler/icons-react";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import { WidgetTile } from "../WidgetTile";
import type { TileProps } from "../types";
import { AppShell } from "./components/AppShell";
import Overview from "./pages/Overview";
import Trends from "./pages/Trends";
import Individual from "./pages/Individual";
import Insights from "./pages/Insights";
import Generate from "./pages/Generate";
import Upload from "./pages/Upload";
import { hasLiveData } from "./lib/live-data";
import { useSnapshotUploads } from "./lib/snapshot-store";
import "./styles.css";

export function TeamPerformanceMetricsTile({ onExpand }: TileProps) {
  const { uploads } = useSnapshotUploads();
  const loaded = hasLiveData(uploads);

  return (
    <WidgetTile
      title="Team Performance Metrics"
      description="NOC trends, individual metrics, and AI insights"
      icon={IconChartBar}
      iconColor="appdirect"
      featured
      onExpand={onExpand}
    >
      <Stack gap="xs">
        <Group justify="space-between" align="center" wrap="nowrap">
          <Text size="sm" fw={600}>
            {loaded ? "Workbook data is ready" : "Ready for an Excel upload"}
          </Text>
          <Badge color={loaded ? "green" : "gray"} variant="light" size="sm">
            {uploads.length} {uploads.length === 1 ? "file" : "files"}
          </Badge>
        </Group>
        <Text size="xs" c="dimmed">
          {loaded
            ? "Open to explore volumes, trends, and individual metrics."
            : "Open the widget to load a NOC performance workbook."}
        </Text>
      </Stack>
    </WidgetTile>
  );
}

export function TeamPerformanceMetricsWidget() {
  const { colorScheme } = useMantineColorScheme();
  const themeClass = colorScheme === "dark" ? " dark" : "";

  return (
    <div className={`team-performance-metrics${themeClass} h-full min-h-[70vh] max-h-[82vh] overflow-y-auto`}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<Overview />} />
            <Route path="/trends" element={<Trends />} />
            <Route path="/individual" element={<Individual />} />
            <Route path="/insights" element={<Insights />} />
            <Route path="/generate" element={<Generate />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </div>
  );
}
