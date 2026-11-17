import { useMemo } from "react";
import Svg, { Path, Rect } from "react-native-svg";
import { create } from "qrcode/lib/browser";

import { isQrToken } from "../domain/claim";
import { WALLET_COPY } from "../domain/copy";

/** Modules of white around the code; four is the QR specification's minimum. */
const QUIET_ZONE = 4;

type Drawing = { side: number; d: string };

/**
 * The matrix of the RAW token as one SVG path of horizontal runs. The token is
 * encoded as bytes (it is plain ASCII, checked first), never as a URL and never
 * through a text API, so nothing outside this call ever holds it as a string
 * that could reach a log, a label or a network request.
 */
export function buildQrDrawing(value: string): Drawing | null {
  if (!isQrToken(value)) return null;
  const bytes = Uint8Array.from(value, (character) => character.charCodeAt(0));
  const { modules } = create([{ data: bytes, mode: "byte" }], {
    errorCorrectionLevel: "M",
  });

  const { size, data } = modules;
  const runs: string[] = [];
  for (let row = 0; row < size; row += 1) {
    let column = 0;
    while (column < size) {
      if (!data[row * size + column]) {
        column += 1;
        continue;
      }
      const start = column;
      while (column < size && data[row * size + column]) column += 1;
      const length = column - start;
      runs.push(
        `M${start + QUIET_ZONE} ${row + QUIET_ZONE}h${length}v1h-${length}z`,
      );
    }
  }
  return { side: size + 2 * QUIET_ZONE, d: runs.join("") };
}

type Props = { value: string; size?: number };

/** Black square modules on white, with a quiet zone: maximum contrast. */
export default function QrCode({ value, size = 240 }: Props) {
  const drawing = useMemo(() => buildQrDrawing(value), [value]);
  if (!drawing) return null;
  // A whole number of pixels per module keeps every edge sharp.
  const edge = Math.max(drawing.side, Math.floor(size / drawing.side) * drawing.side);

  return (
    <Svg
      width={edge}
      height={edge}
      viewBox={`0 0 ${drawing.side} ${drawing.side}`}
      accessibilityRole="image"
      accessibilityLabel={WALLET_COPY.qrAccessibility}
    >
      <Rect x={0} y={0} width={drawing.side} height={drawing.side} fill="#ffffff" />
      <Path d={drawing.d} fill="#000000" />
    </Svg>
  );
}
