import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

import type { NotificationsPort, PermissionState } from "../application/ports";
import { COUPON_REMINDER_TYPE, type ReminderTap } from "../domain/reminder";

/** The channel Expo uses when a push names none, so the backend sends no channel. */
const CHANNEL_ID = "default";

const toPermission = (answer: Notifications.NotificationPermissionsStatus) =>
  (answer.granted
    ? "granted"
    : answer.status === "denied"
      ? "denied"
      : "undetermined") satisfies PermissionState;

const toTap = (response: Notifications.NotificationResponse): ReminderTap => ({
  id: response.notification.request.identifier,
  isDefaultAction:
    response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER,
  data: response.notification.request.content.data,
});

let handlerSet = false;

/**
 * The only file that imports `expo-notifications`. Every call is made by an
 * explicit opt-in or by a build that is configured and on Android; the notification
 * handler is installed only when the intake subscribes.
 */
export function createExpoNotificationsPort(): NotificationsPort {
  return {
    isSupported: () => Platform.OS === "android",

    getPermission: async () =>
      toPermission(await Notifications.getPermissionsAsync()),

    requestPermission: async () =>
      toPermission(await Notifications.requestPermissionsAsync()),

    async prepareChannel() {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: "Recordatorios de cupones",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    },

    async getExpoToken(projectId) {
      const token = await Notifications.getExpoPushTokenAsync({ projectId });
      return token.data;
    },

    subscribe(onTap) {
      if (!handlerSet) {
        handlerSet = true;
        // Show only the coupon reminder while the app is open; stay silent for
        // anything else.
        Notifications.setNotificationHandler({
          handleNotification: async (notification) => {
            const show =
              notification.request.content.data?.type === COUPON_REMINDER_TYPE;
            return {
              shouldShowBanner: show,
              shouldShowList: show,
              shouldPlaySound: false,
              shouldSetBadge: false,
            };
          },
        });
      }
      const subscription = Notifications.addNotificationResponseReceivedListener(
        (response) => onTap(toTap(response)),
      );
      return () => subscription.remove();
    },

    readLaunchTap() {
      const response = Notifications.getLastNotificationResponse();
      return response ? toTap(response) : null;
    },

    clearLaunchTap: () => Notifications.clearLastNotificationResponse(),
  };
}
