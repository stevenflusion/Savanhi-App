const sharedNativePreset = require("@repo/tailwind-config/native");

/** @type {import("tailwindcss").Config} */
module.exports = {
  presets: [sharedNativePreset],
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {},
  },
};
