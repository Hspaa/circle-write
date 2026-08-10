/**
 * 生成 PWA 图标（纯 Node 实现，零依赖 PNG 编码）
 * 用法：node scripts/generate-icons.js
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** pixelFn(x, y) -> [r, g, b, a] */
function encodePNG(width, height, pixelFn) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelFn(x, y);
      const p = row + 1 + x * 4;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
      raw[p + 3] = a;
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function mix(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

/** 生成图标：深色圆角底 + 白色圆桌 + 三个彩色玩家圆点 */
function drawIcon(size) {
  const s = size;
  const c = s / 2;
  const radius = s * 0.2; // 圆角半径
  const tableR = s * 0.185;
  const dotR = s * 0.1;
  const dotDist = s * 0.24;
  const dots = [
    { a: -90, color: [251, 191, 36] },   // 黄
    { a: 30, color: [34, 211, 238] },    // 青
    { a: 150, color: [244, 114, 182] },  // 粉
  ].map((d) => ({
    x: c + Math.cos((d.a * Math.PI) / 180) * dotDist,
    y: c + Math.sin((d.a * Math.PI) / 180) * dotDist,
    color: d.color,
  }));

  return (x, y) => {
    // 圆角矩形外边缘（抗锯齿）
    const cxEdge = Math.max(radius - x, x - (s - 1 - radius), 0);
    const cyEdge = Math.max(radius - y, y - (s - 1 - radius), 0);
    const edgeD = Math.sqrt(cxEdge * cxEdge + cyEdge * cyEdge);
    const alpha = clamp(radius - edgeD + 0.5, 0, 1);
    if (alpha <= 0) return [0, 0, 0, 0];

    // 竖直渐变底
    const t = y / s;
    let color = mix([79, 70, 229], [124, 58, 237], t); // #4f46e5 -> #7c3aed

    // 白色圆桌
    const dTable = Math.hypot(x - c, y - c);
    const ta = clamp(tableR - dTable + 0.5, 0, 1);
    color = mix(color, [255, 255, 255], ta * 0.95);

    // 三个彩色玩家圆点
    for (const dot of dots) {
      const dd = Math.hypot(x - dot.x, y - dot.y);
      const da = clamp(dotR - dd + 0.5, 0, 1);
      if (da > 0) color = mix(color, dot.color, da);
    }

    return [color[0], color[1], color[2], Math.round(alpha * 255)];
  };
}

const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const sizes = [512, 192, 180];
for (const size of sizes) {
  const png = encodePNG(size, size, drawIcon(size));
  const file = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, png);
  console.log(`已生成 ${file} (${png.length} 字节)`);
}
console.log('图标生成完成 ✅');
