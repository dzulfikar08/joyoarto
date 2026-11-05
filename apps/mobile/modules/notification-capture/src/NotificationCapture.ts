import { requireOptionalNativeModule, type EventSubscription } from "expo";

/** A notification from an allow-listed app, as the listener kept it. Never leaves the device as-is. */
export type InboxItem = {
  id: string;
  packageName: string;
  key: string;
  /** Epoch ms. */
  postedAt: number;
  title: string;
  text: string;
  simulated: boolean;
  /** Notification.when (epoch ms): the same for updates and re-alerts of one notification. 0 or missing = unknown. */
  shownAt?: number;
};

type NativeModule = {
  isPermissionGranted(): boolean;
  openPermissionSettings(): boolean;
  openAppDetails(): boolean;
  getConfig(): { enabled: boolean; packages: string[] };
  setConfig(enabled: boolean, packages: string[]): void;
  isInstalled(packageName: string): boolean;
  readInbox(): InboxItem[];
  ackInbox(ids: string[]): void;
  isDebugBuild(): boolean;
  simulateNotification(packageName: string, title: string, text: string): boolean;
  addListener(event: "onCapture", listener: (e: { id: string }) => void): EventSubscription;
};

/** Android only; null on iOS, web and Expo Go. */
const native = requireOptionalNativeModule<NativeModule>("NotificationCapture");

export const isCaptureSupported = native !== null;

export const NotificationCapture = {
  isPermissionGranted: () => native?.isPermissionGranted() ?? false,
  openPermissionSettings: () => native?.openPermissionSettings() ?? false,
  openAppDetails: () => native?.openAppDetails() ?? false,
  getConfig: () => native?.getConfig() ?? { enabled: false, packages: [] },
  setConfig: (enabled: boolean, packages: string[]) => native?.setConfig(enabled, packages),
  isInstalled: (packageName: string) => native?.isInstalled(packageName) ?? false,
  readInbox: (): InboxItem[] => native?.readInbox() ?? [],
  ackInbox: (ids: string[]) => {
    if (ids.length) native?.ackInbox(ids);
  },
  isDebugBuild: () => native?.isDebugBuild() ?? false,
  simulateNotification: (packageName: string, title: string, text: string) =>
    native?.simulateNotification(packageName, title, text) ?? false,
  addCaptureListener: (listener: (e: { id: string }) => void): EventSubscription | null =>
    native?.addListener("onCapture", listener) ?? null,
};
