import { Component, type ErrorInfo, type ReactNode } from "react";
import { Alert, Button, Group, Stack, Text } from "@mantine/core";
import { IconAlertCircle, IconRefresh } from "@tabler/icons-react";

type Props = {
  title?: string;
  children: ReactNode;
};

type State = {
  hasError: boolean;
};

export class WidgetErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[WidgetErrorBoundary]", this.props.title ?? "Widget", error, info);
  }

  private handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <Alert icon={<IconAlertCircle size={16} />} color="red" radius="md" variant="light">
          <Stack gap="sm">
            <Text fw={600}>{this.props.title ?? "This widget"} failed to open.</Text>
            <Group>
              <Button size="xs" variant="light" leftSection={<IconRefresh size={14} />} onClick={this.handleRetry}>
                Try again
              </Button>
            </Group>
          </Stack>
        </Alert>
      );
    }

    return this.props.children;
  }
}
