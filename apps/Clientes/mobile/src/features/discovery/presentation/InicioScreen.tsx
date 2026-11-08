import { FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/features/auth";

import { DISCOVERY_COPY } from "../domain/copy";
import FeedCard from "./FeedCard";
import { useDiscoveryFeed, type FeedError } from "./useDiscoveryFeed";

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

const ERROR_TEXT: Record<FeedError, string> = {
  coupons: DISCOVERY_COPY.couponsError,
  stores: DISCOVERY_COPY.storesError,
};

function InicioFeed() {
  const feed = useDiscoveryFeed();
  const insets = useSafeAreaInsets();
  const { items, error } = feed;

  let body;
  if (items === null) {
    body = error ? (
      <ErrorNotice text={ERROR_TEXT[error]} onRetry={feed.reload} />
    ) : (
      <Message text={DISCOVERY_COPY.loadingCoupons} />
    );
  } else if (error === "stores") {
    body = <ErrorNotice text={ERROR_TEXT.stores} onRetry={feed.reload} />;
  } else if (items.length === 0) {
    body = (
      <Message
        text={
          feed.followedStoreCount === 0
            ? DISCOVERY_COPY.noFollowedStores
            : DISCOVERY_COPY.noCoupons
        }
      />
    );
  } else {
    body = (
      <FlatList
        data={items}
        extraData={feed}
        keyExtractor={(item) => item.coupon.id}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <FeedCard
            item={item}
            followed={feed.isFollowed(item)}
            pending={feed.pendingStores.includes(item.store.id)}
            onToggleFollow={() =>
              void feed.changeFollow(item.store.id, !feed.isFollowed(item))
            }
          />
        )}
      />
    );
  }

  return (
    <View className="flex-1 px-6" style={{ paddingTop: insets.top + 16 }}>
      <Text
        accessibilityRole="header"
        className="mb-4 text-2xl font-semibold text-slate-900"
      >
        {DISCOVERY_COPY.title}
      </Text>
      {feed.followError ? (
        <ErrorNotice text={DISCOVERY_COPY.followError} />
      ) : null}
      {items !== null && error === "coupons" ? (
        <ErrorNotice text={ERROR_TEXT.coupons} onRetry={feed.reload} />
      ) : null}
      {body}
    </View>
  );
}

/** Keyed by customer, so a different login never inherits another feed. */
export default function InicioScreen() {
  const { user } = useAuth();
  return <InicioFeed key={user?.id ?? "signed-out"} />;
}
