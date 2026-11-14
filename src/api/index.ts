import { getHostInfo } from "../core/hostinfo";
import { setFullscreen } from "../core/utils/ui";
import { createStore } from "../core/utils/store";
import { refreshUsbDevices, usbStore } from "../core/transport/usb";
import { showToast } from "../components/Toast";
import { nativeCall } from "./extensions";
import { toDisposable } from "../core/types";

export * from "./components";
export { defineExtension } from "../extensions/registry";
export type { ExtensionDefinition } from "../extensions/registry";

export {
  getHostInfo,
  setFullscreen,
  refreshUsbDevices,
  usbStore,
  createStore,
  showToast,
  nativeCall,
  toDisposable,
};

export type {
  NetContext,
  Platform,
  Layout,
  Disposable,
  HostInfo,
} from "../core/types";

export type { DeviceRecord, CoreProtocol } from "../core/db/types";
export type { Channel, ChannelReadyState, OpenSpec, WebRtcOpenSpec, UsbOpenSpec, BleOpenSpec } from "../core/transport";

export type { SelectOption, SelectProps } from "../components/Select";
export type { UsbDevice } from "../core/transport/usb";
export type { Store } from "../core/utils/store";
export type { ToastKind, ToastApi } from "../components/Toast";
export type { ConfirmOptions, ConfirmFn } from "../components/Confirm";
export type { EditableFieldProps } from "../components/EditableField";
export type { PinchTransform, PinchAreaProps } from "../components/PinchArea";
export type { ButtonProps, ButtonVariant } from "../components/Button";
export type { ModalProps } from "../components/Modal";
export type { PageHeaderProps } from "../components/PageHeader";
export type { PeerDeviceSearchProps } from "../components/PeerDeviceSearch";
export type { SectionHeaderProps } from "../components/SectionHeader";
export type { SettingRowProps } from "../components/SettingRow";
export type { ToggleProps } from "../components/Toggle";
export type { UsbDeviceSelectProps } from "../components/UsbDeviceSelect";
