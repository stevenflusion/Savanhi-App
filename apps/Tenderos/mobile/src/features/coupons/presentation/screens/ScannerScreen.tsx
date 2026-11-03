import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { CouponRedemption } from "@repo/api-contracts";
import type { BarcodeScanningResult, BarcodeSettings } from "expo-camera";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/src/features/auth";

import { createCouponRedemptionsFetchRepository } from "../../infrastructure/coupon-redemptions-fetch-repository";
import { RedemptionSheet } from "../components/RedemptionSheet";
import { RedemptionSuccess } from "../components/RedemptionSuccess";
import { ScannerFrame } from "../components/ScannerFrame";
import { ScannerHeader } from "../components/ScannerHeader";
import { ScannerSheet } from "../components/ScannerSheet";

/** QR codes and nothing else: this screen reads coupon claims (S3). */
const BARCODE_SETTINGS: BarcodeSettings = { barcodeTypes: ["qr"] };

/**
 * What the tendero is told after a redemption REQUEST failed. It is not an
 * apology: a request that left the device may have committed, so the only
 * honest next step is another scan, which answers "already redeemed" when it
 * did commit.
 */
const RESCAN_HINT = "Escanea el código otra vez para ver su estado.";

type Phase =
  | "scanning"
  | "reading"
  | "preview"
  | "redeeming"
  | "failed"
  | "redeemed";

type ScanFailure = { message: string; hint: string | null };

/**
 * The tendero's QR scanner: it reads the code the customer shows, previews
 * what that code would redeem (T6), and redeems it on confirmation.
 *
 * Three rules shape the whole screen:
 *
 * - ONE scan is ONE request. The camera reports the same code many times a
 *   second, so a ref locks the flow on the first report and only an explicit
 *   "scan again" releases it. A ref and not state, because the repeats arrive
 *   before React has re-rendered.
 * - The scanned token is a bearer secret: it lives in a ref for exactly as
 *   long as the redemption it belongs to, is never rendered, never logged and
 *   never persisted, and is dropped the moment a redemption is attempted.
 * - A redemption that failed AFTER being sent is never repeated automatically,
 *   because it may have committed.
 *
 * S11: no id and no clock time reaches the screen — the date goes through the
 * shared date-only helper and the claim id is never rendered.
 */
export function ScannerScreen() {
  const router = useRouter();
  const { requestAuthenticated } = useAuth();
  const repository = useMemo(
    () => createCouponRedemptionsFetchRepository(requestAuthenticated),
    [requestAuthenticated],
  );

  const [permission, requestPermission] = useCameraPermissions();
  const [cameraFailed, setCameraFailed] = useState(false);
  const [torch, setTorch] = useState(false);
  const [phase, setPhase] = useState<Phase>("scanning");
  const [redemption, setRedemption] = useState<CouponRedemption | null>(null);
  const [failure, setFailure] = useState<ScanFailure | null>(null);

  const scanLock = useRef(false);
  const redeemLock = useRef(false);
  const tokenRef = useRef<string | null>(null);

  const resetToScanning = () => {
    tokenRef.current = null;
    scanLock.current = false;
    redeemLock.current = false;
    setRedemption(null);
    setFailure(null);
    setTorch(false);
    setPhase("scanning");
  };

  const handleBarcodeScanned = ({ data }: BarcodeScanningResult) => {
    if (scanLock.current) return;
    scanLock.current = true;
    tokenRef.current = data;
    setPhase("reading");
    void readPreview(data);
  };

  const readPreview = async (qrToken: string) => {
    const result = await repository.previewRedemption(qrToken);
    if (!result.success) {
      tokenRef.current = null;
      setFailure({ message: result.error, hint: null });
      setPhase("failed");
      return;
    }
    setRedemption(result.data);
    setPhase("preview");
  };

  const confirmRedemption = () => {
    const qrToken = tokenRef.current;
    if (!qrToken || redeemLock.current) return;
    redeemLock.current = true;
    setPhase("redeeming");
    void sendRedemption(qrToken);
  };

  const sendRedemption = async (qrToken: string) => {
    const result = await repository.redeemCoupon(qrToken);
    // The token is dropped either way: the request left the device, so it is
    // never sent a second time without a new scan.
    tokenRef.current = null;
    if (!result.success) {
      setFailure({ message: result.error, hint: RESCAN_HINT });
      setPhase("failed");
      return;
    }
    setRedemption(result.data);
    setPhase("redeemed");
  };

  const goBack = () => router.back();

  if (!permission) {
    return (
      <SafeAreaView className="flex-1 bg-orange-50">
        <ScannerHeader onBack={goBack} />
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-center text-base text-slate-600">
            Preparando la cámara...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView className="flex-1 bg-orange-50">
        <ScannerHeader onBack={goBack} />
        <View className="flex-1 items-center justify-center gap-3 px-8">
          <View className="h-20 w-20 items-center justify-center rounded-full bg-white shadow-sm">
            <MaterialCommunityIcons
              name="camera-off-outline"
              size={36}
              color="#1f2937"
            />
          </View>
          <Text className="text-center text-base font-semibold text-slate-900">
            {permission.canAskAgain
              ? "Necesitamos tu cámara"
              : "La cámara está bloqueada"}
          </Text>
          <Text className="text-center text-sm text-slate-600">
            {permission.canAskAgain
              ? "La usamos solo para leer el código QR del cliente."
              : "Activa el permiso de cámara en los ajustes del teléfono para poder escanear."}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              permission.canAskAgain
                ? void requestPermission()
                : void Linking.openSettings()
            }
            className="mt-2 min-h-[52px] w-full max-w-sm items-center justify-center rounded-full bg-black px-5"
          >
            <Text className="text-base font-semibold text-white">
              {permission.canAskAgain ? "Permitir cámara" : "Abrir ajustes"}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  /**
   * The permission can be granted and the camera still refuse to open —
   * another app holding the device, a hardware fault, an emulator with no
   * camera. The viewfinder would then be a black rectangle that never scans
   * anything, so it comes off the screen and the tendero is told in Spanish
   * and given the way out. The native message is deliberately not shown: it
   * is English and names a module the tendero cannot act on.
   */
  if (cameraFailed) {
    return (
      <SafeAreaView className="flex-1 bg-orange-50">
        <ScannerHeader onBack={goBack} />
        <View className="flex-1 items-center justify-center gap-3 px-8">
          <View className="h-20 w-20 items-center justify-center rounded-full bg-white shadow-sm">
            <MaterialCommunityIcons
              name="camera-off-outline"
              size={36}
              color="#1f2937"
            />
          </View>
          <Text className="text-center text-base font-semibold text-slate-900">
            No pudimos abrir la cámara
          </Text>
          <Text className="text-center text-sm text-slate-600">
            Cierra las otras apps que estén usando la cámara y vuelve a
            intentarlo.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={goBack}
            className="mt-2 min-h-[52px] w-full max-w-sm items-center justify-center rounded-full bg-black px-5"
          >
            <Text className="text-base font-semibold text-white">Volver</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const sheetVisible =
    phase === "preview" || phase === "redeeming" || phase === "failed";

  return (
    <View className="flex-1 bg-black">
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={BARCODE_SETTINGS}
        onBarcodeScanned={handleBarcodeScanned}
        onMountError={() => setCameraFailed(true)}
      />

      {sheetVisible ? (
        <View
          testID="camera-dim"
          className="absolute bottom-0 left-0 right-0 top-0"
          style={{ backgroundColor: "rgba(15, 23, 42, 0.55)" }}
        />
      ) : null}

      <SafeAreaView className="flex-1">
        <ScannerHeader onBack={goBack} tone="dark" />

        {phase === "scanning" || phase === "reading" ? (
          <View className="flex-1 items-center justify-center gap-6">
            <ScannerFrame />
            <Text className="px-10 text-center text-sm text-white/70">
              {phase === "reading"
                ? "Leyendo el código..."
                : "Apunta al código QR del cliente"}
            </Text>
            <Pressable
              accessibilityLabel="Linterna"
              accessibilityRole="button"
              accessibilityState={{ selected: torch }}
              onPress={() => setTorch((current) => !current)}
              className={`h-14 w-14 items-center justify-center rounded-full ${
                torch ? "bg-white" : "bg-white/20"
              }`}
            >
              <MaterialCommunityIcons
                name={torch ? "flashlight" : "flashlight-off"}
                size={24}
                color={torch ? "#111827" : "#ffffff"}
              />
            </Pressable>
          </View>
        ) : null}
      </SafeAreaView>

      {phase === "preview" || phase === "redeeming" ? (
        redemption ? (
          <ScannerSheet>
            <RedemptionSheet
              redemption={redemption}
              redeeming={phase === "redeeming"}
              onConfirm={confirmRedemption}
              onCancel={resetToScanning}
            />
          </ScannerSheet>
        ) : null
      ) : null}

      {phase === "failed" && failure ? (
        <ScannerSheet>
          <View className="gap-4">
            <View className="flex-row items-center gap-3">
              <View className="h-10 w-10 items-center justify-center rounded-full bg-rose-50">
                <MaterialCommunityIcons
                  name="alert-circle-outline"
                  size={22}
                  color="#be123c"
                />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-base font-semibold text-slate-900">
                  {failure.message}
                </Text>
                {failure.hint ? (
                  <Text className="mt-1 text-sm text-slate-600">
                    {failure.hint}
                  </Text>
                ) : null}
              </View>
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={resetToScanning}
              className="min-h-[56px] w-full items-center justify-center rounded-full bg-black px-5"
            >
              <Text className="text-base font-semibold text-white">
                Escanear de nuevo
              </Text>
            </Pressable>
          </View>
        </ScannerSheet>
      ) : null}

      {phase === "redeemed" && redemption ? (
        <RedemptionSuccess
          redemption={redemption}
          onScanAnother={resetToScanning}
          onClose={() => router.back()}
        />
      ) : null}
    </View>
  );
}
