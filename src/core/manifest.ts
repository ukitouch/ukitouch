import type { HostPlatform } from "./types";

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  permissions?: string[];
  platforms?: HostPlatform[];
}
