import type { AuthRemoteResult } from "@/src/features/auth";

import type { ReminderTap } from "../domain/reminder";

export type PermissionState = "granted" | "denied" | "undetermined";

/** The device notification module, reduced to what the reminders use. */
export type NotificationsPort = {
  /** False off Android: the opt-in is hidden and nothing native is touched. */
  isSupported: () => boolean;
  getPermission: () => Promise<PermissionState>;
  /** The only call that can show the OS prompt; only an explicit opt-in makes it. */
  requestPermission: () => Promise<PermissionState>;
  prepareChannel: () => Promise<void>;
  getExpoToken: (projectId: string) => Promise<string>;
  /** Warm taps and foreground responses; returns the unsubscribe. */
  subscribe: (onTap: (tap: ReminderTap) => void) => () => void;
  /** The response that launched the app, if any. */
  readLaunchTap: () => ReminderTap | null;
  clearLaunchTap: () => void;
};

/** The device registration endpoints; both go through `runProtected`. */
export type PushDeviceRepository = {
  register: (
    accessToken: string,
    expoToken: string,
  ) => Promise<AuthRemoteResult<null>>;
  remove: (accessToken: string) => Promise<AuthRemoteResult<null>>;
};

/** `removing` means the server registration still has to be deleted. */
export type ReminderConsent = "on" | "removing" | "off";

/** One consent per customer account, so a login never inherits another's choice. */
export type ConsentStore = {
  read: (userId: string) => Promise<ReminderConsent>;
  write: (userId: string, value: ReminderConsent) => Promise<void>;
};
