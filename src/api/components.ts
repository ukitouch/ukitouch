import { Select } from "../components/Select";
import { PeerDeviceSearch } from "../components/PeerDeviceSearch";
import { UsbDeviceSelect } from "../components/UsbDeviceSelect";
import { ToastProvider, useToast } from "../components/Toast";
import { Button } from "../components/Button";
import { SettingRow } from "../components/SettingRow";
import { PageHeader } from "../components/PageHeader";
import { SectionHeader } from "../components/SectionHeader";
import { PinchArea } from "../components/PinchArea";
import EditableField from "../components/EditableField";
import { Modal } from "../components/Modal";

/** UI components reusable by extensions, also exposed as `yatouch.components`. */
export const components = {
  Select,
  PeerDeviceSearch,
  UsbDeviceSelect,
  ToastProvider,
  useToast,
  Button,
  SettingRow,
  PageHeader,
  SectionHeader,
  PinchArea,
  EditableField,
  Modal,
};

export {
  Select,
  PeerDeviceSearch,
  UsbDeviceSelect,
  ToastProvider,
  useToast,
  Button,
  SettingRow,
  PageHeader,
  SectionHeader,
  PinchArea,
  EditableField,
  Modal,
};
