import { useCallback } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getMapboxAccessToken } from "@/src/lib/mapbox";

import { DISCOVERY_COPY } from "../domain/copy";
import type { Coordinates } from "../domain/location";
import { useDiscoveryShared } from "./DiscoveryProvider";
import NearbyMap from "./NearbyMap";
import StoreCard from "./StoreCard";
import { useNearbyStores } from "./useNearbyStores";

function ErrorNotice({
  text,
  onRetry,
}: {
  text: string;
  onRetry?: () => void;
}) {
  return (
    <View className="mb-4 rounded-2xl bg-white p-4">
      <Text accessibilityRole="alert" className="text-base text-slate-900">
        {text}
      </Text>
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          className="mt-3 h-12 items-center justify-center rounded-full bg-black"
        >
          <Text className="text-base text-white">{DISCOVERY_COPY.retry}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Message({ text }: { text: string }) {
  return (
    <Text className="mt-12 text-center text-base text-slate-600">{text}</Text>
  );
}

/** Only mounted with a real position, so it never draws a fabricated one. */
function NearbyContent({ coordinates }: { coordinates: Coordinates }) {
  const nearby = useNearbyStores(coordinates);
  const accessToken = getMapboxAccessToken();
  const { items } = nearby;

  let body;
  if (items === null) {
    body = nearby.error ? (
      <ErrorNotice text={DISCOVERY_COPY.storesError} onRetry={nearby.reload} />
    ) : (
      <Message text={DISCOVERY_COPY.searchingStores} />
    );
  } else if (items.length === 0) {
    body = <Message text={DISCOVERY_COPY.noNearbyStores} />;
  } else {
    body = (
      <FlatList
        data={items}
        extraData={nearby}
        keyExtractor={(store) => store.id}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <StoreCard
            store={item}
            followed={nearby.isFollowed(item)}
            pending={nearby.pendingStores.includes(item.id)}
            onToggleFollow={() =>
              void nearby.changeFollow(item.id, !nearby.isFollowed(item))
            }
          />
        )}
      />
    );
  }

  return (
    <>
      {nearby.followError ? (
        <ErrorNotice text={DISCOVERY_COPY.followError} />
      ) : null}
      {accessToken ? (
        <NearbyMap
          coordinates={coordinates}
          stores={items ?? []}
          accessToken={accessToken}
        />
      ) : (
        // A build without the public token cannot load tiles: say so with the
        // approved error instead of drawing a map that stays blank.
        <ErrorNotice text={DISCOVERY_COPY.storesError} />
      )}
      {items !== null && nearby.error ? (
        <ErrorNotice text={DISCOVERY_COPY.storesError} onRetry={nearby.reload} />
      ) : null}
      {body}
    </>
  );
}

/**
 * Nearby stores on a native map. Opening this tab is what may ask the OS for
 * the foreground location (C10). A denial shows the approved sentence and
 * nothing else: no retry control, no settings button, no repeated request.
 */
export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const { location, openMap, retryLocation } = useDiscoveryShared();

  useFocusEffect(
    useCallback(() => {
      openMap();
    }, [openMap]),
  );

  let body;
  if (location.coordinates) {
    body = <NearbyContent coordinates={location.coordinates} />;
  } else if (location.permission === "denied") {
    body = <Message text={DISCOVERY_COPY.locationRequired} />;
  } else if (location.status === "error") {
    body = (
      <ErrorNotice
        text={DISCOVERY_COPY.storesError}
        onRetry={retryLocation}
      />
    );
  } else {
    body = <Message text={DISCOVERY_COPY.searchingStores} />;
  }

  return (
    <View className="flex-1 px-6" style={{ paddingTop: insets.top + 16 }}>
      <Text
        accessibilityRole="header"
        className="mb-4 text-2xl font-semibold text-slate-900"
      >
        {DISCOVERY_COPY.mapTitle}
      </Text>
      {body}
    </View>
  );
}
