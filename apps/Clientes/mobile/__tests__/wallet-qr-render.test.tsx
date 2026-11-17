import React from "react";
import { render, screen } from "@testing-library/react-native";

import QrCode from "@/src/features/wallet/presentation/QrCode";

import {
  COPY,
  QR_CELL,
  TOKEN_1,
  TOKEN_2,
  TOKEN_3,
  decodeDrawnQr,
  qrPathData,
  qrViewBox,
} from "./wallet-test-utils";

describe("QR renderer (real qrcode matrix, decoded back with jsQR)", () => {
  it.each([TOKEN_1, TOKEN_2, TOKEN_3])(
    "draws the raw token so it decodes to exactly the same text (%s)",
    (token) => {
      render(<QrCode value={token} />);
      expect(decodeDrawnQr()).toBe(token);
    },
  );

  it("keeps lowercase, uppercase, digits, dash and underscore intact", () => {
    expect(TOKEN_1).toMatch(/[a-z]/);
    expect(TOKEN_1).toMatch(/[A-Z]/);
    expect(TOKEN_1).toMatch(/\d/);
    expect(TOKEN_1).toContain("-");
    expect(TOKEN_1).toContain("_");
    render(<QrCode value={TOKEN_1} />);
    expect(decodeDrawnQr()).toBe(TOKEN_1);
  });

  it("leaves a quiet zone of at least four modules on every side", () => {
    render(<QrCode value={TOKEN_1} />);
    const side = Number(qrViewBox()?.split(" ")[2]);
    const cells = qrPathData().flatMap((d) =>
      [...d.matchAll(QR_CELL)].map((m) => ({
        x: Number(m[1]),
        y: Number(m[2]),
        w: Number(m[3]),
      })),
    );
    expect(cells.length).toBeGreaterThan(0);
    expect(Math.min(...cells.map((c) => c.x))).toBeGreaterThanOrEqual(4);
    expect(Math.min(...cells.map((c) => c.y))).toBeGreaterThanOrEqual(4);
    expect(Math.max(...cells.map((c) => c.x + c.w))).toBeLessThanOrEqual(
      side - 4,
    );
    expect(Math.max(...cells.map((c) => c.y + 1))).toBeLessThanOrEqual(
      side - 4,
    );
  });

  it("needs no TextEncoder and no Buffer, so it does not depend on the Hermes globals", () => {
    const globals = globalThis as unknown as Record<string, unknown>;
    const saved = { TextEncoder: globals.TextEncoder, Buffer: globals.Buffer };
    globals.TextEncoder = undefined;
    globals.Buffer = undefined;
    try {
      render(<QrCode value={TOKEN_2} />);
      expect(decodeDrawnQr()).toBe(TOKEN_2);
    } finally {
      globals.TextEncoder = saved.TextEncoder;
      globals.Buffer = saved.Buffer;
    }
  });

  it("never puts the token in any rendered text or accessibility value", () => {
    render(<QrCode value={TOKEN_1} />);
    const dump = JSON.stringify(screen.toJSON());
    expect(dump).not.toContain(TOKEN_1);
    expect(dump).toContain(COPY.qrLabel);
    expect(screen.queryByText(TOKEN_1)).toBeNull();
  });

  it.each([
    ["a URL", "https://savanhi.example/qr/abc"],
    ["text with spaces", "not a token at all, no way"],
    ["an empty value", ""],
    ["a value outside base64url", "ñandú-ñandú-ñandú-ñandú-ñandú-ñandú"],
  ])("draws nothing for %s", (_label, value) => {
    render(<QrCode value={value} />);
    expect(screen.toJSON()).toBeNull();
  });
});
