import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, FlatList, Pressable, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import type { CustomerClaim } from "@repo/api-contracts";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import ReminderCard from "@/src/features/coupon-reminders/presentation/ReminderCard";
import { useCouponReminders } from "@/src/features/coupon-reminders/presentation/reminders-context";

import { WALLET_COPY } from "../domain/copy";
import ClaimCard from "./ClaimCard";
import QrModal from "./QrModal";
import ReleaseConfirmation from "./ReleaseConfirmation";
import { useWallet } from "./wallet-context";

function Notice({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <View className="mb-4 rounded-2xl bg-white p-4">
      <Text accessibilityRole="alert" className="text-base text-slate-900">
        {text}
      </Text>
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          className="mt-3 h-12 items-center justify-center rounded-full bg-black"
        >
          <Text className="text-base text-white">{WALLET_COPY.retry}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Message({ text }: { text: string }) {
  return (
    <Text className="mt-12 text-center text-base text-slate-600">{text}</Text>
  );
}

/**
 * Billetera: one list with the four server statuses, newest first. The server
 * is the only authority on status, so the list is read again whenever the tab
 * gains focus and whenever the app returns to the foreground; it is never
 * polled and never derived from the device clock.
 */
export default function WalletScreen() {
  const insets = useSafeAreaInsets();
  const { claims, claimsStatus, loadClaims, releaseClaim, releasingClaims } =
    useWallet();
  const [qrClaimId, setQrClaimId] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [confirmClaimId, setConfirmClaimId] = useState<string | null>(null);
  // The one outcome notice of a return; a new action replaces it.
  const [releaseNotice, setReleaseNotice] = useState<string | null>(null);
  // A tapped coupon reminder is resolved here, in the authenticated wallet.
  const reminders = useCouponReminders();
  const reminderTarget = reminders?.walletTarget ?? null;
  const finishReminder = reminders?.finishTarget;
  const [readForTarget, setReadForTarget] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const listRef = useRef<FlatList<CustomerClaim>>(null);

  const confirmRelease = useCallback(() => {
    const claimId = confirmClaimId;
    if (!claimId) return;
    setConfirmClaimId(null);
    setQrClaimId((current) => (current === claimId ? null : current));
    setReleaseNotice(null);
    void releaseClaim(claimId).then((result) => {
      // `ignored` means a second tap or a gone owner: nothing may be shown.
      if (result === "released") setReleaseNotice(WALLET_COPY.released);
      else if (result === "unavailable") setReleaseNotice(WALLET_COPY.unavailable);
      else if (result === "failed") setReleaseNotice(WALLET_COPY.releaseError);
    });
  }, [confirmClaimId, releaseClaim]);
  const focused = useRef(false);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      void loadClaims();
      return () => {
        focused.current = false;
        setHighlightId(null);
      };
    }, [loadClaims]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && focused.current) void loadClaims();
    });
    return () => subscription.remove();
  }, [loadClaims]);

  // The tap resolves only against a read that started after it, so an older
  // list can never answer for it.
  useEffect(() => {
    if (!reminderTarget) return;
    let cancelled = false;
    void loadClaims().then(() => {
      if (!cancelled) setReadForTarget(reminderTarget);
    });
    return () => {
      cancelled = true;
    };
  }, [reminderTarget, loadClaims]);

  useEffect(() => {
    if (!reminderTarget || readForTarget !== reminderTarget) return;
    if (claimsStatus === "loading") return;
    // Found or not, a failed read or a missing claim just ends the tap: nothing
    // is said about it and the wallet stays as the server reports it.
    const index = claims?.findIndex((claim) => claim.id === reminderTarget) ?? -1;
    if (claimsStatus === "idle" && claims && index >= 0) {
      if (claims[index]?.status === "claimed") {
        setHighlightId(reminderTarget);
        listRef.current?.scrollToIndex({ index, animated: false });
      }
    }
    setReadForTarget(null);
    finishReminder?.(reminderTarget);
  }, [reminderTarget, readForTarget, claims, claimsStatus, finishReminder]);

  let body;
  if (claims === null) {
    body =
      claimsStatus === "error" ? (
        <Notice text={WALLET_COPY.loadError} onRetry={() => void loadClaims()} />
      ) : (
        <Message text={WALLET_COPY.loading} />
      );
  } else if (claims.length === 0) {
    body = <Message text={WALLET_COPY.empty} />;
  } else {
    body = (
      <FlatList
        ref={listRef}
        onScrollToIndexFailed={() => {}}
        data={claims}
        keyExtractor={(claim) => claim.id}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <ClaimCard
            claim={item}
            highlighted={item.id === highlightId}
            releasing={releasingClaims.includes(item.id)}
            onViewQr={() => {
              setUnavailable(false);
              setReleaseNotice(null);
              setQrClaimId(item.id);
            }}
            onRelease={() => {
              setUnavailable(false);
              setReleaseNotice(null);
              setConfirmClaimId(item.id);
            }}
          />
        )}
      />
    );
  }

  return (
    <View className="flex-1 px-6" style={{ paddingTop: insets.top + 16 }}>
      <Text
        accessibilityRole="header"
        className="mb-4 text-2xl font-semibold text-slate-900"
      >
        {WALLET_COPY.title}
      </Text>
      <ReminderCard />
      {unavailable ? <Notice text={WALLET_COPY.unavailable} /> : null}
      {releaseNotice ? <Notice text={releaseNotice} /> : null}
      {claims !== null && claimsStatus === "error" ? (
        <Notice text={WALLET_COPY.loadError} onRetry={() => void loadClaims()} />
      ) : null}
      {body}
      {confirmClaimId ? (
        <ReleaseConfirmation
          onConfirm={confirmRelease}
          onCancel={() => {
            // Nothing was asked of the server and nothing is stored or changed.
            setConfirmClaimId(null);
            setReleaseNotice(WALLET_COPY.releaseCancelled);
          }}
        />
      ) : null}
      {qrClaimId ? (
        <QrModal
          key={qrClaimId}
          claimId={qrClaimId}
          onClose={() => setQrClaimId(null)}
          onUnavailable={() => {
            setQrClaimId(null);
            setUnavailable(true);
            void loadClaims();
          }}
        />
      ) : null}
    </View>
  );
}
