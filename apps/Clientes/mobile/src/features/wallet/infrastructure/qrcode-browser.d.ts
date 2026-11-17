/**
 * The browser build of `qrcode` has no canvas or filesystem at import time, so
 * it is the entry the app imports explicitly. It exposes the same `create`.
 */
declare module "qrcode/lib/browser" {
  export { create } from "qrcode";
}
