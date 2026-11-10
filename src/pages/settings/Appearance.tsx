import { useSyncExternalStore } from "react";
import { Select } from "../../components/Select";
import { SettingRow } from "../../components/SettingRow";
import { themeStore, type ThemeMode } from "../../core/theme";

const MODES: { value: ThemeMode; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export default function Appearance() {
  const mode = useSyncExternalStore(themeStore.subscribe, themeStore.get);

  return (
    <SettingRow label="Appearance">
      <Select
        value={mode}
        options={MODES}
        onChange={(next) => themeStore.set(next)}
        ariaLabel="Theme"
      />
    </SettingRow>
  );
}
