import { Group, Select, Text } from "@mantine/core";
import { getAgentOptions, getAgentLabel } from "../lib/devs-ai/agents";

type Props = {
  value: string;
  onChange: (value: string) => void;
  label?: string;
};

export function AiAgentSelector({ value, onChange, label = "AI agent" }: Props) {
  const options = getAgentOptions();

  return (
    <Group gap="xs" align="end" wrap="wrap">
      <Select
        label={label}
        value={value}
        data={options}
        allowDeselect={false}
        onChange={(next) => {
          if (next) onChange(next);
        }}
        w={260}
        comboboxProps={{ withinPortal: true }}
      />
      <Text size="xs" c="dimmed" mb={6}>Using: {getAgentLabel(value)}</Text>
    </Group>
  );
}
