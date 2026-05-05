/**
 * Generate mobile/assets/notification-icon.png — a 96x96 PNG with a white
 * chat-bubble silhouette on a transparent background.
 *
 * Android notification icons (status bar) are rendered as alpha masks: only
 * the alpha channel matters; RGB is replaced by the system tint color at
 * runtime. A colored or fully-opaque icon shows as a solid white square.
 *
 * Pure Node — no native dependencies.
 *
 * Usage: node scripts/gen-notif-icon.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'mobile', 'assets', 'notification-icon.png');
const W = 96;
const H = 96;

// CRC32 for PNG chunks
const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
    }
    return t;
})();
function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const tBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tBuf, data])), 0);
    return Buffer.concat([len, tBuf, data, crc]);
}

// Geometry — chat bubble centered with a small tail bottom-left.
const BODY_LEFT = 8;
const BODY_RIGHT = 88;
const BODY_TOP = 6;
const BODY_BOTTOM = 70;
const RADIUS = 18;

// Three dots inside (kept as alpha=0 holes so the silhouette still reads as a chat bubble).
const DOT_RADIUS = 5.5;
const DOT_Y = 38;
const DOT_XS = [30, 48, 66];

// Tail — a soft triangle from inside the bubble's bottom-left to a point below.
function inTail(x, y) {
    if (y < BODY_BOTTOM - 1 || y > 88) return false;
    const t = (y - (BODY_BOTTOM - 1)) / (88 - (BODY_BOTTOM - 1)); // 0..1
    // Tail tapers from x in [16, 38] at top to point near (12, 88)
    const leftX = 16 + (12 - 16) * t;
    const rightX = 38 + (16 - 38) * t;
    return x >= leftX && x <= rightX;
}

function distToRoundedRectInside(x, y, l, r, t, b, rad) {
    // Returns positive if outside, 0 on edge, negative if inside.
    const dx = Math.max(l - x, 0, x - r);
    const dy = Math.max(t - y, 0, y - b);
    if (dx === 0 && dy === 0) {
        // Inside bounding rect — distance to nearest corner-circle if in corner zone
        const cornerX = (x < l + rad) ? l + rad : (x > r - rad ? r - rad : null);
        const cornerY = (y < t + rad) ? t + rad : (y > b - rad ? b - rad : null);
        if (cornerX !== null && cornerY !== null) {
            const d = Math.hypot(x - cornerX, y - cornerY);
            return d - rad;
        }
        return -1; // safely inside
    }
    return Math.hypot(dx, dy); // outside
}

// Sample 4x sub-pixels for smooth edges.
function alphaAt(x, y) {
    let acc = 0;
    const samples = 4;
    for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
            const px = x + (sx + 0.5) / samples;
            const py = y + (sy + 0.5) / samples;

            const dRect = distToRoundedRectInside(px, py, BODY_LEFT, BODY_RIGHT, BODY_TOP, BODY_BOTTOM, RADIUS);
            const inBody = dRect <= 0 || inTail(px, py);
            if (!inBody) continue;

            // Punch out the three dots
            let onDot = false;
            for (const dx of DOT_XS) {
                if (Math.hypot(px - dx, py - DOT_Y) <= DOT_RADIUS) { onDot = true; break; }
            }
            if (onDot) continue;

            acc += 1;
        }
    }
    return Math.round((acc / (samples * samples)) * 255);
}

// Build raw image data (filter byte + grayscale + alpha per pixel)
const rowLen = 1 + W * 2;
const raw = Buffer.alloc(H * rowLen);
for (let y = 0; y < H; y++) {
    raw[y * rowLen] = 0; // filter: None
    for (let x = 0; x < W; x++) {
        const a = alphaAt(x, y);
        const off = y * rowLen + 1 + x * 2;
        raw[off] = 255;     // gray (white) — Android ignores this and tints
        raw[off + 1] = a;   // alpha
    }
}

// IHDR
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;    // bit depth
ihdr[9] = 4;    // color type: grayscale + alpha
ihdr[10] = 0;   // compression
ihdr[11] = 0;   // filter
ihdr[12] = 0;   // interlace

const idat = zlib.deflateSync(raw, { level: 9 });

const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
]);

fs.writeFileSync(OUT, png);
console.log(`Wrote ${png.length} bytes -> ${OUT}`);
console.log(`Format: ${W}x${H}, grayscale+alpha, white silhouette on transparent.`);
