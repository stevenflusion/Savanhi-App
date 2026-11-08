import { AppState } from "react-native";
import * as Location from "expo-location";

import type { ForegroundLocationPort } from "../application/ports";
import {
  isCoordinates,
  roundCoordinates,
  type LocationPermission,
} from "../domain/location";

/**
 * `granted` covers a precise AND an approximate Android grant: the answer is
 * used as the OS gives it and precision is never asked for. A denial, with or
 * without `canAskAgain`, is just `denied`; nothing here decides to ask again.
 */
function toPermission(status: string): LocationPermission {
  if (status === "granted") return "granted";
  if (status === "undetermined") return "undetermined";
  return "denied";
}

/**
 * The device's foreground location. Importing this module prompts nothing;
 * only `requestPermission` can show the system dialog. There is no watch, no
 * background mode and no settings dialog: `getPosition` is one reading.
 */
export function createDeviceLocation(): ForegroundLocationPort {
  return {
    async getPermission() {
      const response = await Location.getForegroundPermissionsAsync();
      return toPermission(response.status);
    },

    async requestPermission() {
      const response = await Location.requestForegroundPermissionsAsync();
      return toPermission(response.status);
    },

    async getPosition() {
      const reading = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
        // Location services being off is an error the screen words; a second
        // OS dialog would be a location prompt nobody approved (C10).
        mayShowUserSettingsDialog: false,
      });
      const { latitude, longitude } = reading?.coords ?? {};
      const position = { latitude, longitude };
      if (!isCoordinates(position)) {
        throw new Error("The device returned no usable position.");
      }
      return roundCoordinates(position);
    },

    onForeground(listener) {
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") listener();
      });
      return () => subscription.remove();
    },
  };
}
