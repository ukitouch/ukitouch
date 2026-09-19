import { useSyncExternalStore } from "react";
import {
  Button,
  Select,
  SettingRow,
  type HostPlatform,
  type ScreenSize,
  type SelectOption,
} from "../../api";
import { castStore, setCursor, setScale, type CastSettings as Settings } from "./api";

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

const TIERS = [
  2160, 1440, 1080, 960, 900, 720, 600, 576, 540, 480, 432, 360, 320, 288, 240, 216, 180,
  144,
];

function resolutions(source?: ScreenSize): SelectOption<string>[] {
  if (!source) return [{ value: "1", label: "Source" }];
  return [
    { value: "1", label: `${source.width}×${source.height}` },
    ...TIERS.filter((h) => h < source.height).map((h) => ({
      value: `${h / source.height}`,
      label: `${Math.round((source.width * h) / source.height)}×${h}`,
    })),
  ];
}

/**
 * The switches Cast exposes, filtered to what this host can do.
 */
export function CastSettings() {
  const { settings, platform, connection } = useSyncExternalStore(
    castStore.subscribe,
    castStore.get
  );
  const shown = OPTIONS.filter((o) => !o.platform || o.platform === platform);
  const source =
    connection.status === "connected" ? connection.info?.source : undefined;
  const options = resolutions(source);
  const current =
    options.find((o) => Math.abs(Number(o.value) - settings.scale) < 0.001) ??
    options[0];

  return (
    <div className="flex flex-col gap-4">
      <SettingRow
        label="Resolution"
        hint="How much of the peer's screen to receive."
        action={
          <Select
            value={current.value}
            options={options}
            ariaLabel="Resolution"
            onChange={(value) => setScale(Number(value))}
          />
        }
      />
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
