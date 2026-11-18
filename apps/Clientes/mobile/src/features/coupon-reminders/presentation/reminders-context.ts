import { createContext, useContext } from "react";

export type ReminderStatus =
  /** Reading the stored choice, or no eligible session yet: nothing is shown. */
  | "checking"
  /** Not Android or not configured: nothing is shown. */
  | "unavailable"
  | "off"
  | "working"
  | "on"
  /** The OS does not allow notifications; the customer changes it outside the app. */
  | "denied"
  | "error"
  | "remove-error";

export type CouponReminders = {
  status: ReminderStatus;
  /** The explicit opt-in: the only path that may show the OS prompt. */
  enable: () => Promise<void>;
  /** Removes the registration, even if the OS permission stays granted. */
  disable: () => Promise<void>;
  /**
   * The claim a tapped reminder points at, once the session is eligible and the
   * wallet is the screen to resolve it in. `null` otherwise.
   */
  walletTarget: string | null;
  /** The wallet resolved (or could not resolve) the target: forget it. */
  finishTarget: (claimId: string) => void;
};

export const CouponRemindersContext = createContext<CouponReminders | null>(null);

/** `null` when no provider is mounted: Billetera then offers no reminders. */
export const useCouponReminders = () => useContext(CouponRemindersContext);
