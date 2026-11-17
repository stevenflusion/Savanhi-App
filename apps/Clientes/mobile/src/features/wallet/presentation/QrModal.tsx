import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Modal, Pressable, Text, View } from "react-native";

import { WALLET_COPY } from "../domain/copy";
import QrCode from "./QrCode";
import { useWallet } from "./wallet-context";

type Props = {
  claimId: string;
  onClose: () => void;
  /** The claim can no longer show a code (redeemed, released or expired). */
  onUnavailable: () => void;
};

type View_ =
  | { phase: "loading" }
  | { phase: "ready"; token: string }
  | { phase: "error" };

/**
 * The code of one claim, over the wallet. The token lives only in this
 * component's state: it is dropped when the sheet closes, when the app leaves
 * the foreground and when the screen unmounts (including a closed gate), and an
 * answer that arrives after any of those is ignored.
 */
export default function QrModal({ claimId, onClose, onUnavailable }: Props) {
  const wallet = useWallet();
  const [view, setView] = useState<View_>({ phase: "loading" });
  // Bumped to ignore every answer that is still on its way.
  const attempt = useRef(0);
  const callbacks = useRef({ onClose, onUnavailable });
  callbacks.current = { onClose, onUnavailable };

  const open = useCallback(async () => {
    const current = ++attempt.current;
    setView({ phase: "loading" });
    const result = await wallet.resolveQr(claimId);
    if (current !== attempt.current) return;
    if (result.status === "ok") {
      setView({ phase: "ready", token: result.token });
    } else if (result.status === "unavailable") {
      callbacks.current.onUnavailable();
    } else if (result.status === "failed") {
      setView({ phase: "error" });
    }
    // `ignored` means the owner is gone: nothing may be shown.
  }, [wallet, claimId]);

  useEffect(() => {
    void open();
    return () => {
      attempt.current += 1;
    };
    // The attempt is started once per sheet; «Reintentar» calls `open` itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimId]);

  // The code never stays on screen once the app is not in the foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") return;
      attempt.current += 1;
      setView({ phase: "loading" });
      callbacks.current.onClose();
    });
    return () => subscription.remove();
  }, []);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/60 px-6">
        <View className="w-full items-center rounded-3xl bg-white p-6">
          {view.phase === "loading" ? (
            <Text className="my-8 text-base text-slate-600">
              {WALLET_COPY.qrLoading}
            </Text>
          ) : null}
          {view.phase === "ready" ? (
            <>
              <Text className="mb-4 text-center text-base text-slate-900">
                {WALLET_COPY.qrInstruction}
              </Text>
              <QrCode value={view.token} />
            </>
          ) : null}
          {view.phase === "error" ? (
            <>
              <Text
                accessibilityRole="alert"
                className="my-4 text-center text-base text-slate-900"
              >
                {WALLET_COPY.qrError}
              </Text>
              <Pressable
                onPress={() => void open()}
                accessibilityRole="button"
                className="mb-3 h-12 w-full items-center justify-center rounded-full bg-black"
              >
                <Text className="text-base text-white">{WALLET_COPY.retry}</Text>
              </Pressable>
            </>
          ) : null}
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            className="mt-4 h-12 w-full items-center justify-center rounded-full border border-slate-300 bg-white"
          >
            <Text className="text-base text-slate-900">{WALLET_COPY.close}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
