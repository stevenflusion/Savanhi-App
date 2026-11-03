import type { ReactNode } from "react";
import { View } from "react-native";

/**
 * The white sheet that rises over the dimmed camera, with the drag handle the
 * tendero reads as "there is something to act on here". It is the shell only:
 * the result, the error and the loading states all live inside it, so a scan
 * never moves the controls around.
 */
export function ScannerSheet({ children }: { children: ReactNode }) {
  return (
    <View
      testID="scanner-sheet"
      className="absolute bottom-0 left-0 right-0 rounded-t-[32px] bg-white px-5 pb-10 pt-3"
      style={{
        shadowColor: "#0f172a",
        shadowOpacity: 0.18,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: -6 },
        elevation: 12,
      }}
    >
      <View className="mb-4 h-1.5 w-12 self-center rounded-full bg-slate-200" />
      {children}
    </View>
  );
}
