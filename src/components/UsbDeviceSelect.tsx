import { useEffect } from "react";
import { UsbDevice } from "../core/transport/usb";
import { Select } from "./Select";

export interface UsbDeviceSelectProps {
  devices: readonly UsbDevice[];
  /** Selected vendor ID. */
  value?: number;
  /** Calls when the user selects a device. */
  onChange: (device: UsbDevice) => void;
  className?: string;
}

/** USB device picker: selects by vendor ID and reports the full device. */
export function UsbDeviceSelect({
  devices,
  value,
  onChange,
  className,
}: UsbDeviceSelectProps) {
  useEffect(() => {
    if (devices.length && value === undefined) {
      onChange(devices[0]);
    }
  }, [devices, value, onChange]);

  const handleChange = (vendorId: string) => {
    const device = devices.find(
      (device) => device.vendorId.toString() === vendorId
    );
    if (device) onChange(device);
  };

  return (
    <Select
      value={value?.toString() ?? ""}
      options={devices.map((device) => ({
        value: device.vendorId.toString(),
        label: device.description,
      }))}
      onChange={handleChange}
      ariaLabel="USB device"
      className={className}
    />
  );
}