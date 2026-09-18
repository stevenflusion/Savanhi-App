import { View, StyleSheet } from "react-native"
import LottieView from "lottie-react-native"
import { useCallback, useRef, type ComponentType } from "react"

const CompatibleLottieView = LottieView as unknown as ComponentType<any>

type SplashScreenProps = {
  onAnimationFinish: () => void
}

function SplashScreen({ onAnimationFinish }: SplashScreenProps) {
  const animationRef = useRef<LottieView>(null)
  const hasFinished = useRef(false)

  const handleFinish = useCallback(
    (isCancelled: boolean) => {
      // Only count non-cancelled completions as "finished"
      if (isCancelled) return
      if (hasFinished.current) return
      hasFinished.current = true
      onAnimationFinish()
    },
    [onAnimationFinish],
  )

  return (
    <View style={styles.container}>
      <View style={styles.lottieWrapper}>
        <CompatibleLottieView
          ref={animationRef}
          source={require("../../assets/lotties/Splash_Screen.json")}
          autoPlay
          loop={false}
          resizeMode="cover"
          onAnimationFinish={handleFinish}
          style={styles.animation}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#ffffff",
  },
  lottieWrapper: {
    width: 280,
    height: 280,
    borderRadius: 20,
    overflow: "hidden",
  },
  animation: {
    width: "100%",
    height: "100%",
  },
})

export default SplashScreen
