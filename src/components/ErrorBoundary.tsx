import { Component, type ReactNode } from "react";
import { Alert, Button, Stack, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";

interface Props {
  children: ReactNode;
  label?: string;
  compact?: boolean;
}

interface State {
  error: Error | null;
}

/**
 * Widget-level error boundary.
 * Catches render/effect errors inside a single widget so the rest of the
 * dashboard keeps working. Shows a compact error card with a "Try again" button.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary: ${this.props.label ?? "widget"}]`, error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <Stack p="md" gap="sm" align="center" justify="center" style={{ height: "100%", minHeight: 120 }}>
          <Alert
            icon={<IconAlertTriangle size={16} />}
            color="red"
            variant="light"
            radius="md"
            w="100%"
          >
            <Stack gap={6}>
              <Text size="sm" fw={600}>
                {this.props.label ?? "Widget"} failed to render
              </Text>
              {!this.props.compact && (
                <Text size="xs" c="dimmed" ff="monospace">
                  {this.state.error.message}
                </Text>
              )}
              <Button
                size="xs"
                variant="light"
                color="red"
                mt={4}
                onClick={() => this.setState({ error: null })}
              >
                Try again
              </Button>
            </Stack>
          </Alert>
        </Stack>
      );
    }

    return this.props.children;
  }
}
