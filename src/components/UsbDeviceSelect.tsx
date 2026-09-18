import type { UsbDevice } from "../core/usb";
import { Select } from "./Select";

export interface UsbDeviceSelectProps {
  devices: readonly UsbDevice[];
  /** Selected serial. */
  value: string;
  onChange: (serial: string) => void;
  className?: string;
}

/** USB device picker: serial with connection state. */
export function UsbDeviceSelect({
  devices,
  value,
  onChange,
  className,
}: UsbDeviceSelectProps) {
  return (
    <Select
      value={value}
      options={devices.map((d) => ({
        value: d.serial,
        label: `${d.serial}  (${d.state})`,
      }))}
      onChange={onChange}
      ariaLabel="USB device"
      className={className}
    />
  );
}
