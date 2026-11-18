import * as SecureStore from "expo-secure-store";

import type { ConsentStore, ReminderConsent } from "../application/ports";

/** Its own key per account; the value is a flag, never a token. */
export const reminderConsentKey = (userId: string) =>
  `savanhi-clientes-reminders.${userId}`;

/** An unreadable keystore reads as «off»: nothing is registered on a guess. */
export function createConsentStore(): ConsentStore {
  return {
    async read(userId) {
      try {
        const value = await SecureStore.getItemAsync(reminderConsentKey(userId));
        return value === "on" || value === "removing" ? value : "off";
      } catch {
        return "off";
      }
    },
    async write(userId, value: ReminderConsent) {
      try {
        if (value === "off") {
          await SecureStore.deleteItemAsync(reminderConsentKey(userId));
        } else {
          await SecureStore.setItemAsync(reminderConsentKey(userId), value);
        }
      } catch {
        // Best effort: the server registration is the authority.
      }
    },
  };
}
