import { encode } from 'uqr';

/**
 * A share link as a scannable QR code: one SVG path over the dark modules,
 * on a white quiet zone (scanners need the contrast whatever the theme).
 */
export function QrCode(props: { value: string; label: string; size?: number }) {
  const qr = encode(props.value, { ecc: 'L', border: 2 });
  const n = qr.size;
  let d = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (qr.data[y][x]) d += `M${x} ${y}h1v1h-1z`;
    }
  }
  const px = props.size ?? 192;
  return (
    <svg
      className="qr-code"
      viewBox={`0 0 ${n} ${n}`}
      width={px}
      height={px}
      role="img"
      aria-label={props.label}
      shapeRendering="crispEdges"
    >
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
