/* 
 * Settings page.
 *
 * Device Data is persisted in IndexedDB via the DeviceStore (src/core/devices.ts).
 */

import { PageHeader } from "../../components/PageHeader";
import DeviceManagement from "./DeviceManagement";
import ServerConfig from "./ServerConfig";

function SettingsPage() {

  return (
    <div className="p-6 max-w-2xl">
      <PageHeader title="Settings" />

      <div className="mt-4 space-y-1">
        <ServerConfig />
        <DeviceManagement />
      </div>
    </div>
  );
}

export default SettingsPage;
