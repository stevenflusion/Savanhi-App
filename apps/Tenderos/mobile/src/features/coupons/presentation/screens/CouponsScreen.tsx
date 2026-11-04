import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { Coupon } from "@repo/api-contracts";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { EmptyState } from "@/src/components/EmptyState";
import { useAuth } from "@/src/features/auth";

import { uploadCouponImage } from "../../application/use-cases/upload-coupon-image.use-case";
import type { CouponProductOption } from "../../application/ports/coupons-repository";
import {
  EMPTY_COUPON_FORM,
  couponToFormState,
  toCouponCreateRequest,
  toCouponUpdateRequest,
  type CouponFormState,
} from "../../domain/coupon-form";
import { createCouponsFetchRepository } from "../../infrastructure/coupons-fetch-repository";
import { CouponCard } from "../components/CouponCard";
import { CouponEditor } from "../components/CouponEditor";

/**
 * The tendero's coupon workspace: the store's coupons, their pause state, and
 * the one editor that creates and edits them (S4, S5, S6).
 *
 * It follows the ProductsWorkspace pattern this app already uses — the screen
 * owns the state and reads through the authenticated transport the
 * AuthProvider exposes — while the rules themselves live in the feature's
 * domain and its repository, so they are asserted without a React tree.
 *
 * Nothing here renders an id or a time (S11): every date goes through the
 * shared date-only formatter and the coupon id travels only inside request
 * paths.
 */
export function CouponsScreen() {
  const router = useRouter();
  /**
   * Where the screen was opened FROM (S14): the Home tab's round black button
   * sends `intent=new`, and the coupon detail's edit action sends
   * `intent=edit` with the coupon it was showing. Anything else opens the
   * plain list, which is what the tab itself does.
   */
  const { intent, couponId: intentCouponId } = useLocalSearchParams<{
    intent?: string;
    couponId?: string;
  }>();
  const { requestAuthenticated } = useAuth();
  const repository = useMemo(
    () => createCouponsFetchRepository(requestAuthenticated),
    [requestAuthenticated],
  );

  const [storeId, setStoreId] = useState("");
  const [storeMissing, setStoreMissing] = useState(false);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [products, setProducts] = useState<CouponProductOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [editingCouponId, setEditingCouponId] = useState<string | null>(null);
  const [form, setForm] = useState<CouponFormState | null>(null);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  /**
   * The incoming intent is honoured ONCE. The screen reloads on every focus,
   * and re-opening the form each time would make "Cancelar" impossible: the
   * tendero would be thrown straight back into the editor they just left.
   */
  const intentApplied = useRef(false);
  const applyIntent = useCallback(
    (list: Coupon[]) => {
      if (intentApplied.current) return;
      if (intent === "new") {
        intentApplied.current = true;
        setEditingCouponId(null);
        setForm(EMPTY_COUPON_FORM);
        setFormError("");
        return;
      }
      if (intent === "edit" && intentCouponId) {
        const stored = list.find((item) => item.id === intentCouponId);
        // A coupon that is not in this store is simply not opened: the list is
        // the honest answer, not an editor for something that is not there.
        if (!stored) return;
        intentApplied.current = true;
        setEditingCouponId(stored.id);
        setForm(couponToFormState(stored));
        setFormError("");
      }
    },
    [intent, intentCouponId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const stores = await repository.listOwnStores();
    if (!stores.success) {
      setError(stores.error);
      setLoading(false);
      return;
    }

    const nextStoreId = stores.data[0]?.id ?? "";
    setStoreId(nextStoreId);
    setStoreMissing(!nextStoreId);
    if (!nextStoreId) {
      setCoupons([]);
      setProducts([]);
      setLoading(false);
      return;
    }

    const [couponList, productOptions] = await Promise.all([
      repository.listStoreCoupons(nextStoreId),
      repository.listProductOptions(nextStoreId),
    ]);
    if (!couponList.success) {
      setError(couponList.error);
    } else {
      setCoupons(couponList.data);
      applyIntent(couponList.data);
    }
    if (!productOptions.success) {
      setError((current) => current || productOptions.error);
    } else {
      setProducts(productOptions.data);
    }
    setLoading(false);
  }, [applyIntent, repository]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const openCreate = () => {
    setEditingCouponId(null);
    setForm(EMPTY_COUPON_FORM);
    setFormError("");
  };

  const openEdit = (coupon: Coupon) => {
    setEditingCouponId(coupon.id);
    setForm(couponToFormState(coupon));
    setFormError("");
  };

  const closeForm = () => {
    setEditingCouponId(null);
    setForm(null);
    setFormError("");
  };

  const togglePaused = async (coupon: Coupon) => {
    setBusy(true);
    setError("");
    const result = await repository.setCouponPaused(coupon.id, !coupon.paused);
    setBusy(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    await load();
  };

  const pickPhoto = async () => {
    if (!form || !storeId) return;
    setFormError("");
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.8,
    });
    if (picked.canceled || !picked.assets[0]) return;

    setUploading(true);
    const uploaded = await uploadCouponImage({
      storeId,
      uri: picked.assets[0].uri,
      deps: { repository },
    });
    setUploading(false);
    if (!uploaded.success) {
      setFormError(uploaded.error);
      return;
    }
    setForm((current) =>
      current ? { ...current, imageObjectKey: uploaded.objectKey } : current,
    );
  };

  const save = async () => {
    if (!form) return;
    setFormError("");

    // The payload is built only from a form that validates, so a cardinality
    // or a validity the form could catch never reaches the backend (S5, S6).
    const payload = editingCouponId
      ? toCouponUpdateRequest(form)
      : toCouponCreateRequest(form);
    if (!payload) return;

    setSaving(true);
    const result = editingCouponId
      ? await repository.updateCoupon(
          editingCouponId,
          payload as Parameters<typeof repository.updateCoupon>[1],
        )
      : await repository.createCoupon(
          storeId,
          payload as Parameters<typeof repository.createCoupon>[1],
        );
    setSaving(false);
    if (!result.success) {
      setFormError(result.error);
      return;
    }
    closeForm();
    await load();
  };

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{
        paddingHorizontal: 16,
        paddingBottom: 120,
        gap: 12,
      }}
      showsVerticalScrollIndicator={false}
    >
      {form ? (
        <CouponEditor
          state={form}
          onChange={setForm}
          products={products}
          editing={editingCouponId !== null}
          saving={saving}
          uploading={uploading}
          photoReady={form.imageObjectKey !== null}
          error={formError}
          onPickPhoto={() => void pickPhoto()}
          onSave={() => void save()}
          onCancel={closeForm}
        />
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            disabled={storeMissing}
            onPress={openCreate}
            className="min-h-[52px] w-full max-w-xl flex-row items-center justify-center gap-2 self-center rounded-full bg-black px-5"
          >
            <MaterialCommunityIcons name="plus" size={20} color="#ffffff" />
            <Text className="text-base font-semibold text-white">
              Nuevo cupón
            </Text>
          </Pressable>

          {loading ? (
            <Text className="py-6 text-center text-sm text-slate-500">
              Cargando cupones...
            </Text>
          ) : null}

          {error ? (
            <View className="w-full max-w-xl self-center rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
              <Text className="text-sm text-rose-700">{error}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void load()}
                className="mt-2"
              >
                <Text className="text-sm font-semibold text-rose-800">
                  Reintentar
                </Text>
              </Pressable>
            </View>
          ) : null}

          {!loading && storeMissing ? (
            <EmptyState
              title="Sin tienda disponible"
              message="Completa el registro de tu tienda para crear cupones."
            />
          ) : null}

          {!loading && !storeMissing && !error && !coupons.length ? (
            <EmptyState
              title="Sin cupones"
              message="Crea tu primer cupón para que los clientes te encuentren."
            />
          ) : null}

          {coupons.map((coupon) => (
            <CouponCard
              key={coupon.id}
              coupon={coupon}
              busy={busy}
              onOpen={() => router.push(`/coupon/${coupon.id}`)}
              onEdit={() => openEdit(coupon)}
              onTogglePaused={() => void togglePaused(coupon)}
            />
          ))}
        </>
      )}
    </ScrollView>
  );
}
