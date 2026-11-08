import type {
  CustomerCouponFeedItem,
  CustomerStore,
} from "@repo/api-contracts";

import type { AuthRemoteResult } from "@/src/features/auth";

/** What the server confirmed about one store (`following` is the end state). */
export type FollowState = { storeId: string; following: boolean };

export type DiscoveryRemoteRepository = {
  /** The one feed. Sent with no query: no coordinates exist in this unit. */
  getFeed: (
    accessToken: string,
  ) => Promise<AuthRemoteResult<CustomerCouponFeedItem[]>>;
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
