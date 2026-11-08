import type {
  CustomerCouponFeedItem,
  CustomerStore,
  NearbyStore,
} from "@repo/api-contracts";

import type { AuthRemoteResult } from "@/src/features/auth";

import type { Coordinates, LocationPermission } from "../domain/location";

/** What the server confirmed about one store (`following` is the end state). */
export type FollowState = { storeId: string; following: boolean };

export type DiscoveryRemoteRepository = {
  /**
   * The one feed. With no coordinates it is sent with no query at all; with a
   * position it carries exactly the `lat`/`lng` pair and nothing else.
   */
  getFeed: (
    accessToken: string,
    coordinates?: Coordinates,
  ) => Promise<AuthRemoteResult<CustomerCouponFeedItem[]>>;
  /** The stores within the API's radius of a position (both coordinates required). */
  getNearbyStores: (
    accessToken: string,
    coordinates: Coordinates,
  ) => Promise<AuthRemoteResult<NearbyStore[]>>;
  getFollowedStores: (
    accessToken: string,
  ) => Promise<AuthRemoteResult<CustomerStore[]>>;
  /** PUT follows and DELETE unfollows; both are idempotent. */
  setFollow: (
    accessToken: string,
    storeId: string,
    following: boolean,
  ) => Promise<AuthRemoteResult<FollowState>>;
};

/**
 * The device's foreground location, reduced to what Mapa needs. Reading the
 * permission never prompts; only `requestPermission` can, and the caller
 * decides when. `getPosition` is a single reading, never a subscription.
 */
export type ForegroundLocationPort = {
  getPermission: () => Promise<LocationPermission>;
  requestPermission: () => Promise<LocationPermission>;
  getPosition: () => Promise<Coordinates>;
  /** Calls back each time the app returns to the foreground; returns the unsubscribe. */
  onForeground: (listener: () => void) => () => void;
};
