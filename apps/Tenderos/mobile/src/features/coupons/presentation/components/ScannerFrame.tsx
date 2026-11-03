import { useEffect, useRef } from "react";
import { Animated, Easing, useWindowDimensions, View } from "react-native";

/**
 * The viewfinder: a large square with rounded corner brackets and one line
 * sweeping across it, so the tendero knows where to aim and that the camera is
 * actually looking.
 *
 * The sweep is plain React Native `Animated` on the native driver — no
 * animation dependency was added for it (only `expo-camera` is authorized,
 * S3/L6).
 */
export function ScannerFrame() {
  const { width } = useWindowDimensions();
  const size = Math.min(width - 72, 300);
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, {
          toValue: 1,
          duration: 2000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(sweep, {
          toValue: 0,
          duration: 2000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [sweep]);

  const translateY = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: [8, size - 8],
  });

  return (
    <View
      testID="scanner-frame"
      style={{ height: size, width: size }}
      className="items-center justify-center"
    >
      <Corner className="left-0 top-0 rounded-tl-3xl border-l-4 border-t-4" />
      <Corner className="right-0 top-0 rounded-tr-3xl border-r-4 border-t-4" />
      <Corner className="bottom-0 left-0 rounded-bl-3xl border-b-4 border-l-4" />
      <Corner className="bottom-0 right-0 rounded-br-3xl border-b-4 border-r-4" />

      <Animated.View
        style={{
          position: "absolute",
          left: 18,
          right: 18,
          top: 0,
          height: 2,
          borderRadius: 2,
          backgroundColor: "rgba(255, 255, 255, 0.9)",
          transform: [{ translateY }],
        }}
      />
    </View>
  );
}

function Corner({ className }: { className: string }) {
  return (
    <View
      className={`absolute h-12 w-12 border-white ${className}`}
      style={{ borderColor: "#ffffff" }}
    />
  );
}
