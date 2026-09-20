// Deterministic data texture, not a rendered frame. Run only when editing the lens profile.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const size = 128;
const rows = Buffer.alloc(size * (1 + size * 4));
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size * 2 - 1, v = (y + 0.5) / size * 2 - 1;
    const falloff = Math.max(0, 1 - u * u - v * v) ** 2;
    const offset = y * (1 + size * 4) + 1 + x * 4;
    rows[offset] = Math.round(128 - u * falloff * 115);
    rows[offset + 1] = Math.round(128 - v * falloff * 115);
    rows[offset + 2] = 128;
    rows[offset + 3] = 255;
}
function chunk(type, data) {
    const bytes = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const result = Buffer.alloc(data.length + 12);
    result.writeUInt32BE(data.length);
    bytes.copy(result, 4);
    result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
    return result;
}
const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
header[8] = 8; header[9] = 6;
writeFileSync(new URL('../assets/displacement.png', import.meta.url), Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0)),
]));