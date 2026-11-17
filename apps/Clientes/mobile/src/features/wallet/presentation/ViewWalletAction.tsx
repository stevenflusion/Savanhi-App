import { Pressable, Text } from "react-native";
import { useRouter } from "expo-router";

import { WALLET_COPY } from "../domain/copy";

/**
 * The only way a successful claim leads to Billetera: an explicit action. It
 * is its own component so the router is read only when a claim was confirmed.
 */
export default function ViewWalletAction() {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push("/wallet" as never)}
      accessibilityRole="button"
      className="h-10 items-center justify-center rounded-full bg-black px-5"
    >
      <Text className="text-sm font-medium text-white">
        {WALLET_COPY.viewWallet}
      </Text>
    </Pressable>
  );
}
