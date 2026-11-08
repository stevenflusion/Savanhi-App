import { useState } from "react";
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  EMPTY_BIRTH_DATE_PARTS,
  parseBirthDate,
  toBirthDateParts,
  type BirthDateParts,
} from "../../domain/birth-date";
import { GATE_COPY } from "../../domain/copy";
import { composeFullName, type GateState } from "../../domain/profile-gate";
import authLogo from "../assets/auth-logo";
import { useAuth } from "../AuthProvider";
import DateOfBirthInput from "../components/DateOfBirthInput";

type RequiredGate = Extract<GateState, { status: "profile-required" }>;

function Splash() {
  return (
    <View className="flex-1 items-center justify-center bg-white">
      <Image source={authLogo} className="h-40 w-40" resizeMode="contain" />
    </View>
  );
}

function SignOutButton() {
  const { logout } = useAuth();
  return (
    <Pressable
      onPress={() => void logout()}
      accessibilityRole="button"
      className="h-14 items-center justify-center rounded-full"
    >
      <Text className="text-base text-gray-700 underline">
        {GATE_COPY.signOut}
      </Text>
    </Pressable>
  );
}

function Message({ title, retry }: { title: string; retry?: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-1 justify-center bg-white px-6"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom + 16 }}
    >
      <Text
        accessibilityRole="alert"
        className="pb-8 text-center text-2xl font-medium text-gray-900"
      >
        {title}
      </Text>
      {retry ? (
        <Pressable
          onPress={retry}
          accessibilityRole="button"
          className="h-16 items-center justify-center rounded-full bg-black"
        >
          <Text className="text-lg text-white">{GATE_COPY.retry}</Text>
        </Pressable>
      ) : null}
      <SignOutButton />
    </View>
  );
}

function ProfileForm({ gate }: { gate: RequiredGate }) {
  const { saveProfile } = useAuth();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [surname, setSurname] = useState("");
  // A date already saved stays in the field; only the missing part is asked.
  const [parts, setParts] = useState<BirthDateParts>(() =>
    gate.birthDate ? toBirthDateParts(gate.birthDate) : EMPTY_BIRTH_DATE_PARTS,
  );
  const [nameError, setNameError] = useState("");
  const [dateError, setDateError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [showUnderage, setShowUnderage] = useState(gate.underage);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (saving) return;
    Keyboard.dismiss();
    setSaveError("");

    const missingName = gate.needsName && !composeFullName(name, surname);
    const date = parseBirthDate(parts);
    setNameError(missingName ? GATE_COPY.nameRequired : "");
    setDateError(
      date.status === "incomplete"
        ? GATE_COPY.birthDateIncomplete
        : date.status === "invalid"
          ? GATE_COPY.birthDateInvalid
          : "",
    );
    if (missingName || date.status !== "ok") return;

    setSaving(true);
    setShowUnderage(false);
    try {
      const result = await saveProfile({
        name,
        surname,
        birthDate: date.value,
      });
      if (result.success || result.reason === "stale") return;
      if (result.reason === "underage") setShowUnderage(true);
      else setSaveError(GATE_COPY.saveError);
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1 bg-white">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: insets.top + 40,
          paddingBottom: insets.bottom + 16,
          paddingHorizontal: 24,
        }}
      >
        <Text
          accessibilityRole="header"
          className="pb-8 text-4xl font-medium text-gray-900"
        >
          {gate.needsName
            ? GATE_COPY.titleNewProfile
            : GATE_COPY.titleBirthDateOnly}
        </Text>

        {gate.needsName ? (
          <View className="gap-4 pb-6">
            <View>
              <TextInput
                value={name}
                onChangeText={(value) => {
                  setName(value);
                  if (nameError) setNameError("");
                }}
                placeholder={GATE_COPY.nameLabel}
                placeholderTextColor="#9ca3af"
                accessibilityLabel={GATE_COPY.nameLabel}
                autoCapitalize="words"
                autoComplete="given-name"
                className={`h-16 rounded-2xl border px-4 text-lg text-gray-900 ${
                  nameError ? "border-red-400" : "border-gray-900"
                }`}
              />
              {nameError ? (
                <Text
                  accessibilityRole="alert"
                  className="pt-2 text-sm text-red-400"
                >
                  {nameError}
                </Text>
              ) : null}
            </View>
            <TextInput
              value={surname}
              onChangeText={setSurname}
              placeholder={GATE_COPY.surnameLabel}
              placeholderTextColor="#9ca3af"
              accessibilityLabel={GATE_COPY.surnameLabel}
              autoCapitalize="words"
              autoComplete="family-name"
              className="h-16 rounded-2xl border border-gray-900 px-4 text-lg text-gray-900"
            />
          </View>
        ) : null}

        <Text className="text-base font-medium text-gray-900">
          {GATE_COPY.birthDateLabel}
        </Text>
        <Text className="pb-3 text-sm text-gray-600">
          {GATE_COPY.birthDateHint}
        </Text>
        <DateOfBirthInput
          value={parts}
          onChange={(next) => {
            setParts(next);
            if (dateError) setDateError("");
          }}
          invalid={Boolean(dateError) || showUnderage}
          disabled={saving}
        />
        {dateError ? (
          <Text accessibilityRole="alert" className="pt-2 text-sm text-red-400">
            {dateError}
          </Text>
        ) : null}
        {showUnderage ? (
          <Text
            accessibilityRole="alert"
            className="pt-4 text-base leading-5 text-red-400"
          >
            {GATE_COPY.underage}
          </Text>
        ) : null}
        {saveError ? (
          <Text
            accessibilityRole="alert"
            className="pt-4 text-base leading-5 text-red-400"
          >
            {saveError}
          </Text>
        ) : null}

        <View className="flex-1 justify-end pt-8">
          <Pressable
            onPress={handleSubmit}
            disabled={saving}
            accessibilityRole="button"
            accessibilityState={{ disabled: saving, busy: saving }}
            className="h-16 items-center justify-center rounded-full bg-black"
          >
            <Text className="text-lg text-white">{GATE_COPY.continue}</Text>
          </Pressable>
          <SignOutButton />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export default function ProfileGateScreen() {
  const { gate, retryProfile } = useAuth();

  switch (gate.status) {
    case "loading":
      return <Splash />;
    case "profile-error":
      return (
        <Message
          title={GATE_COPY.loadError}
          retry={() => void retryProfile()}
        />
      );
    case "wrong-role":
      return <Message title={GATE_COPY.wrongRole} />;
    case "profile-required":
      return <ProfileForm gate={gate} />;
    default:
      return null;
  }
}
