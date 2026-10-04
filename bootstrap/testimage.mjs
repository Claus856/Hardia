// Genererer små PNG-testbilleder uden eksterne pakker. Billedet viser et stort ciffer (postens grad) og
// et antal prikker (billede nr.), så man kan se i interfacet hvilket billede der er hvilket.
import zlib from 'node:zlib';

const SEGMENTS = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function makePng({ width = 640, height = 480, bg = [40, 90, 160], digit = 1, dots = 1 }) {
  const px = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const shade = 0.75 + 0.25 * (y / height); // let lodret farveforløb
      px[i] = bg[0] * shade; px[i + 1] = bg[1] * shade; px[i + 2] = bg[2] * shade;
    }
  }
  const rect = (x0, y0, w, h, c) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const i = (y * width + x) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
    }
  };
  // 7-segment ciffer
  const t = 36, dw = 180, dh = 300, ox = Math.round((width - dw) / 2), oy = Math.round((height - dh) / 2) - 20;
  const seg = {
    a: [ox + t, oy, dw - 2 * t, t], b: [ox + dw - t, oy + t, t, dh / 2 - t], c: [ox + dw - t, oy + dh / 2, t, dh / 2 - t],
    d: [ox + t, oy + dh - t, dw - 2 * t, t], e: [ox, oy + dh / 2, t, dh / 2 - t], f: [ox, oy + t, t, dh / 2 - t],
    g: [ox + t, oy + dh / 2 - t / 2, dw - 2 * t, t],
  };
  for (const s of SEGMENTS[digit]) rect(...seg[s], [255, 255, 255]);
  for (let d = 0; d < dots; d++) rect(30 + d * 44, height - 60, 28, 28, [255, 230, 80]);

  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    px.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

export const COLORS = { 1: [40, 100, 170], 5: [170, 90, 30], 8: [110, 40, 130] };
