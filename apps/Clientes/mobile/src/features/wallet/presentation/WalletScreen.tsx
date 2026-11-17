import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, FlatList, Pressable, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { WALLET_COPY } from "../domain/copy";
import ClaimCard from "./ClaimCard";
import QrModal from "./QrModal";
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
  const { claims, claimsStatus, loadClaims } = useWallet();
  const [qrClaimId, setQrClaimId] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const focused = useRef(false);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      void loadClaims();
      return () => {
        focused.current = false;
      };
    }, [loadClaims]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && focused.current) void loadClaims();
    });
    return () => subscription.remove();
  }, [loadClaims]);

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
        data={claims}
        keyExtractor={(claim) => claim.id}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <ClaimCard
            claim={item}
            onViewQr={() => {
              setUnavailable(false);
              setQrClaimId(item.id);
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
      {unavailable ? <Notice text={WALLET_COPY.unavailable} /> : null}
      {claims !== null && claimsStatus === "error" ? (
        <Notice text={WALLET_COPY.loadError} onRetry={() => void loadClaims()} />
      ) : null}
      {body}
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
