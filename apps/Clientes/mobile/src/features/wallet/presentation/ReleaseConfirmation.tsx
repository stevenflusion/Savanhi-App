import { Modal, Pressable, Text, View } from "react-native";

import { WALLET_COPY } from "../domain/copy";

type Props = { onConfirm: () => void; onCancel: () => void };

/**
 * The approved confirmation before a coupon is given back (L21). It is a
 * declarative `Modal`, so it unmounts with the screen: a native alert's callback
 * could outlive a logout, this cannot. Opening it asks nothing of the server.
 */
export default function ReleaseConfirmation({ onConfirm, onCancel }: Props) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View className="flex-1 items-center justify-center bg-black/60 px-6">
        <View className="w-full rounded-3xl bg-white p-6">
          <Text
            accessibilityRole="alert"
            className="mb-6 text-center text-base text-slate-900"
          >
            {WALLET_COPY.releaseConfirm}
          </Text>
          <Pressable
            onPress={onConfirm}
            accessibilityRole="button"
            className="mb-3 h-12 items-center justify-center rounded-full bg-black"
          >
            <Text className="text-base text-white">{WALLET_COPY.release}</Text>
          </Pressable>
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            className="h-12 items-center justify-center rounded-full border border-slate-300 bg-white"
          >
            <Text className="text-base text-slate-900">{WALLET_COPY.cancel}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
