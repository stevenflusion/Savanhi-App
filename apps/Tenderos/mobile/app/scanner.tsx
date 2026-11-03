import { ScannerScreen } from "@/src/features/coupons/presentation/screens/ScannerScreen";

/**
 * The route the floating bar's centre button pushes to. It is a root stack
 * sibling of `(tabs)`, so the scanner takes the whole screen with no tab bar
 * over the camera.
 *
 * The screen owns its own safe-area handling, because the camera preview fills
 * the screen edge to edge while the controls stay inside the safe area.
 */
export default function ScannerRoute() {
  return <ScannerScreen />;
}
