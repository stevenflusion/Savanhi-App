import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Mapbox from "@rnmapbox/maps";
import type { NearbyStore } from "@repo/api-contracts";

import type { Coordinates } from "../domain/location";

type Props = {
  coordinates: Coordinates;
  stores: NearbyStore[];
  accessToken: string;
};

/**
 * The native map, fixed on the position the stores were found around, with one
 * marker per real store. It is only rendered once a real position exists, and
 * it never follows the user: no `UserLocation`, no tracking camera, so a tab
 * that stays mounted while hidden cannot keep the GPS busy. Coordinates reach
 * the SDK as `[longitude, latitude]`.
 */
export default function NearbyMap({ coordinates, stores, accessToken }: Props) {
  useMemo(() => Mapbox.setAccessToken(accessToken), [accessToken]);

  return (
    <View className="mb-4 h-64 overflow-hidden rounded-3xl bg-slate-200">
      <Mapbox.MapView
        style={StyleSheet.absoluteFill}
        styleURL="mapbox://styles/mapbox/streets-v12"
        scaleBarEnabled={false}
      >
        <Mapbox.Camera
          centerCoordinate={[coordinates.longitude, coordinates.latitude]}
          zoomLevel={12}
          animationMode="moveTo"
          animationDuration={0}
        />
        {stores.map((store) => (
          <Mapbox.PointAnnotation
            key={store.id}
            id={store.id}
            coordinate={[store.longitude, store.latitude]}
          />
        ))}
      </Mapbox.MapView>
    </View>
  );
}
