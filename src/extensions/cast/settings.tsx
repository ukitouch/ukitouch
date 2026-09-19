import { useSyncExternalStore } from "react";
import { Button, SettingRow, type HostPlatform } from "../../api";
import { castStore, setCursor, type CastSettings as Settings } from "./api";

/** One switchable option, and the hosts that expose it. */
interface Option {
  key: keyof Settings;
  label: string;
  hint: string;
  onChange: (on: boolean) => void;
  /** Absent means every host. */
  platform?: HostPlatform;
}

const OPTIONS: Option[] = [
  {
    key: "cursor",
    label: "Show pointer",
    hint: "Ask the peer to include its mouse cursor in the stream.",
    onChange: setCursor,
  },
];

/**
 * The switches Cast exposes, filtered to what this host can do.
 */
export function CastSettings() {
  const { settings, platform } = useSyncExternalStore(
    castStore.subscribe,
    castStore.get
  );
  const shown = OPTIONS.filter((o) => !o.platform || o.platform === platform);
  return (
    <div className="flex flex-col gap-4">
      {shown.map((o) => (
        <SettingRow
          key={o.key}
          label={o.label}
          hint={o.hint}
          action={
            <Button variant="ghost" onClick={() => o.onChange(!settings[o.key])}>
              {settings[o.key] ? "On" : "Off"}
            </Button>
          }
        />
      ))}
    </div>
  );
}
