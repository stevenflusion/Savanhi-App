// An in-memory stand-in for the native keystore, so storage code runs through
// the real `expo-secure-store` import path. Tests reach the backing map as
// `require("expo-secure-store").__store`.
jest.mock("expo-secure-store", () => {
  const store = new Map();
  return {
    __store: store,
    getItemAsync: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    setItemAsync: jest.fn(async (key, value) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key) => {
      store.delete(key);
    }),
  };
});

// The native map is replaced by host components that keep their props, so
// tests read the camera and marker coordinates the screen really passes. No
// tile or Mapbox API call can happen.
jest.mock("@rnmapbox/maps", () => {
  // Not called `createElement` in place: the NativeWind Babel transform
  // rewrites those calls and would reference an out-of-scope helper here.
  const h = require("react")["create" + "Element"];
  const host = (name) => {
    const Component = ({ children, ...props }) => h(name, props, children);
    Component.displayName = name;
    return Component;
  };
  const Mapbox = {
    setAccessToken: jest.fn(),
    MapView: host("MapView"),
    Camera: host("Camera"),
    PointAnnotation: host("PointAnnotation"),
  };
  return { __esModule: true, default: Mapbox, ...Mapbox };
});

// The device location module. Every call is a mock the tests configure; no
// default answer grants anything, and importing the module prompts nothing.
jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
  hasServicesEnabledAsync: jest.fn(),
}));
