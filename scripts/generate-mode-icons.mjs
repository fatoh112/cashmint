import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function createPngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const typeAndData = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crcBuf]);
}

/**
 * Decode PNG (Color type 2 RGB or 6 RGBA) into 32-bit RGBA Buffer
 */
function readPngRgba(filePath) {
  const buf = fs.readFileSync(filePath);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const colorType = buf[25]; // 2 = RGB, 6 = RGBA

  let pos = 8;
  const idatChunks = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    if (type === 'IDAT') {
      idatChunks.push(buf.subarray(pos + 8, pos + 8 + len));
    }
    pos += 12 + len;
  }

  const rawData = zlib.inflateSync(Buffer.concat(idatChunks));
  const bytesPerPixel = colorType === 2 ? 3 : 4;
  const rowSize = width * bytesPerPixel + 1;

  const pixels = Buffer.alloc(width * height * 4);
  let prevRow = Buffer.alloc(width * bytesPerPixel);

  for (let y = 0; y < height; y++) {
    const filterType = rawData[y * rowSize];
    const rowOffset = y * rowSize + 1;
    const currRow = Buffer.alloc(width * bytesPerPixel);

    for (let x = 0; x < width * bytesPerPixel; x++) {
      const val = rawData[rowOffset + x];
      if (filterType === 0) currRow[x] = val;
      else if (filterType === 1) {
        const left = x >= bytesPerPixel ? currRow[x - bytesPerPixel] : 0;
        currRow[x] = (val + left) & 0xff;
      } else if (filterType === 2) {
        const up = prevRow[x];
        currRow[x] = (val + up) & 0xff;
      } else if (filterType === 3) {
        const left = x >= bytesPerPixel ? currRow[x - bytesPerPixel] : 0;
        const up = prevRow[x];
        currRow[x] = (val + Math.floor((left + up) / 2)) & 0xff;
      } else if (filterType === 4) {
        const left = x >= bytesPerPixel ? currRow[x - bytesPerPixel] : 0;
        const up = prevRow[x];
        const upperLeft = x >= bytesPerPixel ? prevRow[x - bytesPerPixel] : 0;
        const p = left + up - upperLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upperLeft);
        let pr = left;
        if (pb < pa && pb <= pc) pr = up;
        else if (pc < pa) pr = upperLeft;
        currRow[x] = (val + pr) & 0xff;
      }
    }

    for (let px = 0; px < width; px++) {
      const srcIdx = px * bytesPerPixel;
      const destIdx = (y * width + px) * 4;
      pixels[destIdx] = currRow[srcIdx];
      pixels[destIdx + 1] = currRow[srcIdx + 1];
      pixels[destIdx + 2] = currRow[srcIdx + 2];
      pixels[destIdx + 3] = bytesPerPixel === 4 ? currRow[srcIdx + 3] : 255;
    }

    prevRow = currRow;
  }

  return { width, height, pixels };
}

/**
 * Encode RGBA pixels to 32-bit PNG file buffer
 */
function encodePngRgba(width, height, pixels) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const ihdrChunk = createPngChunk('IHDR', ihdr);
  const rowSize = width * 4 + 1;
  const rawData = Buffer.alloc(rowSize * height);

  for (let y = 0; y < height; y++) {
    rawData[y * rowSize] = 0; // Filter: None
    pixels.copy(rawData, y * rowSize + 1, y * width * 4, (y + 1) * width * 4);
  }

  const idatChunk = createPngChunk('IDAT', zlib.deflateSync(rawData));
  const iendChunk = createPngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

// Mode configurations
const MODES = {
  master: {
    name: 'Cashmint | الإدارة المركزية',
    shortName: 'Cashmint Master',
    tag: 'MASTER',
    bg: [15, 23, 42, 255],           // #0f172a (Deep Slate)
    badgeBorder: [6, 182, 212, 255],    // #06b6d4 (Cyan)
    badgeFill: [255, 255, 255, 255],   // White
    tagBg: [15, 23, 42, 255],
    tagBorder: [6, 182, 212, 255],
    tagText: [234, 179, 8, 255],      // Gold
    svgAccent: '#06b6d4',
    svgBadge: '#eab308'
  },
  pos: {
    name: 'Cashmint | نقاط البيع',
    shortName: 'Cashmint POS',
    tag: 'POS',
    bg: [15, 23, 42, 255],           // #0f172a
    badgeBorder: [245, 158, 11, 255],   // #f59e0b (Amber)
    badgeFill: [255, 255, 255, 255],   // White
    tagBg: [15, 23, 42, 255],
    tagBorder: [245, 158, 11, 255],
    tagText: [16, 185, 129, 255],     // Emerald
    svgAccent: '#f59e0b',
    svgBadge: '#10b981'
  },
  store: {
    name: 'Cashmint | إدارة المطعم',
    shortName: 'Cashmint Store',
    tag: 'STORE',
    bg: [15, 23, 42, 255],           // #0f172a
    badgeBorder: [16, 185, 129, 255],   // #10b981 (Emerald)
    badgeFill: [255, 255, 255, 255],   // White
    tagBg: [15, 23, 42, 255],
    tagBorder: [16, 185, 129, 255],
    tagText: [20, 184, 166, 255],     // Teal
    svgAccent: '#10b981',
    svgBadge: '#14b8a6'
  }
};

// Read source cashmint logo image
const logoSrcPath = path.resolve('public/cashmint-logo.png');
const logo = readPngRgba(logoSrcPath);
console.log(`Loaded Cashmint brand mark asset: ${logo.width}x${logo.height}`);

/**
 * Generate a mode-specific square PWA icon with full Cashmint branding
 */
function createModeIconBuffer(targetSize, modeKey, isMaskable = false) {
  const mode = MODES[modeKey];
  const outPixels = Buffer.alloc(targetSize * targetSize * 4);

  // Define badge bounds (keeping inside Android maskable safe area if maskable)
  const marginFrac = isMaskable ? 0.15 : 0.08;
  const badgeX = Math.round(targetSize * marginFrac);
  const badgeY = Math.round(targetSize * marginFrac);
  const badgeW = targetSize - badgeX * 2;
  const badgeH = targetSize - badgeY * 2;
  const borderRadius = Math.round(badgeW * 0.20);

  // Fill background #0f172a
  for (let i = 0; i < targetSize * targetSize; i++) {
    outPixels[i * 4] = mode.bg[0];
    outPixels[i * 4 + 1] = mode.bg[1];
    outPixels[i * 4 + 2] = mode.bg[2];
    outPixels[i * 4 + 3] = mode.bg[3];
  }

  // Draw inner badge card with rounded corners
  const borderThickness = Math.max(2, Math.round(targetSize * 0.015));

  for (let y = badgeY; y < badgeY + badgeH; y++) {
    for (let x = badgeX; x < badgeX + badgeW; x++) {
      const relX = x - badgeX;
      const relY = y - badgeY;
      let inCorner = false;
      let cornerDist = 0;

      if (relX < borderRadius && relY < borderRadius) {
        cornerDist = Math.hypot(relX - borderRadius, relY - borderRadius);
        if (cornerDist > borderRadius) inCorner = true;
      } else if (relX > badgeW - borderRadius && relY < borderRadius) {
        cornerDist = Math.hypot(relX - (badgeW - borderRadius), relY - borderRadius);
        if (cornerDist > borderRadius) inCorner = true;
      } else if (relX < borderRadius && relY > badgeH - borderRadius) {
        cornerDist = Math.hypot(relX - borderRadius, relY - (badgeH - borderRadius));
        if (cornerDist > borderRadius) inCorner = true;
      } else if (relX > badgeW - borderRadius && relY > badgeH - borderRadius) {
        cornerDist = Math.hypot(relX - (badgeW - borderRadius), relY - (badgeH - borderRadius));
        if (cornerDist > borderRadius) inCorner = true;
      }

      if (!inCorner) {
        const idx = (y * targetSize + x) * 4;

        const isBorder = (
          relX < borderThickness || relX >= badgeW - borderThickness ||
          relY < borderThickness || relY >= badgeH - borderThickness ||
          (cornerDist > 0 && cornerDist >= borderRadius - borderThickness)
        );

        if (isBorder) {
          outPixels[idx] = mode.badgeBorder[0];
          outPixels[idx + 1] = mode.badgeBorder[1];
          outPixels[idx + 2] = mode.badgeBorder[2];
          outPixels[idx + 3] = mode.badgeBorder[3];
        } else {
          outPixels[idx] = mode.badgeFill[0];
          outPixels[idx + 1] = mode.badgeFill[1];
          outPixels[idx + 2] = mode.badgeFill[2];
          outPixels[idx + 3] = mode.badgeFill[3];
        }
      }
    }
  }

  // Calculate scaling for Cashmint logo to fit inside the inner badge
  const innerPad = Math.round(badgeW * 0.10);
  const logoTargetW = badgeW - innerPad * 2;
  const logoScale = logoTargetW / logo.width;
  const logoTargetH = Math.round(logo.height * logoScale);

  const logoStartX = badgeX + Math.round((badgeW - logoTargetW) / 2);
  const logoStartY = badgeY + Math.round((badgeH - logoTargetH) / 2) - Math.round(targetSize * 0.02);

  // Composite scaled Cashmint logo onto inner badge
  for (let ly = 0; ly < logoTargetH; ly++) {
    for (let lx = 0; lx < logoTargetW; lx++) {
      const srcX = Math.min(logo.width - 1, Math.floor(lx / logoScale));
      const srcY = Math.min(logo.height - 1, Math.floor(ly / logoScale));

      const srcIdx = (srcY * logo.width + srcX) * 4;
      const sr = logo.pixels[srcIdx];
      const sg = logo.pixels[srcIdx + 1];
      const sb = logo.pixels[srcIdx + 2];
      const sa = (logo.pixels[srcIdx + 3] / 255);

      // Check if pixel is white background in original logo (to keep white badge clean)
      const isWhiteBg = (sr > 245 && sg > 245 && sb > 245);

      if (!isWhiteBg && sa > 0.05) {
        const destX = logoStartX + lx;
        const destY = logoStartY + ly;

        if (destX >= 0 && destX < targetSize && destY >= 0 && destY < targetSize) {
          const destIdx = (destY * targetSize + destX) * 4;
          outPixels[destIdx] = sr;
          outPixels[destIdx + 1] = sg;
          outPixels[destIdx + 2] = sb;
          outPixels[destIdx + 3] = 255;
        }
      }
    }
  }

  return encodePngRgba(targetSize, targetSize, outPixels);
}

/**
 * Generate SVG icon for mode
 */
function generateModeSvg(modeKey) {
  const mode = MODES[modeKey];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">
  <rect width="512" height="512" rx="128" fill="#0F172A"/>
  <rect x="40" y="40" width="432" height="432" rx="96" fill="#FFFFFF" stroke="${mode.svgAccent}" stroke-width="16"/>
  <g transform="translate(64, 180) scale(0.216)">
    <path d="M256 120V392M200 160H285C315 160 330 175 330 200C330 230 300 245 256 256C210 267 182 282 182 312C182 337 197 352 227 352H312" stroke="#10B981" stroke-width="48" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <rect x="140" y="360" width="232" height="48" rx="24" fill="#0F172A" stroke="${mode.svgAccent}" stroke-width="4"/>
  <text x="256" y="392" text-anchor="middle" fill="${mode.svgBadge}" font-family="system-ui, sans-serif" font-weight="900" font-size="26" letter-spacing="3">${mode.tag}</text>
</svg>`;
}

const pwaAssetDir = path.resolve('public/pwa');
if (!fs.existsSync(pwaAssetDir)) {
  fs.mkdirSync(pwaAssetDir, { recursive: true });
}

console.log("Generating official Cashmint branded icons for master, pos, store...");

for (const modeKey of Object.keys(MODES)) {
  const modeDir = path.join(pwaAssetDir, modeKey);
  if (!fs.existsSync(modeDir)) {
    fs.mkdirSync(modeDir, { recursive: true });
  }

  // Remove legacy duplicates if present
  const legacyDuplicates = ['icon-192x192.png', 'icon-512x512.png'];
  for (const dup of legacyDuplicates) {
    const dupPath = path.join(modeDir, dup);
    if (fs.existsSync(dupPath)) {
      fs.unlinkSync(dupPath);
      console.log(`Cleaned legacy duplicate: ${dupPath}`);
    }
  }

  // Also clean in dist-master, dist-pos, dist-store if present
  const distModeDir = path.resolve(`dist-${modeKey}`);
  if (fs.existsSync(distModeDir)) {
    for (const dup of legacyDuplicates) {
      const dupPath = path.join(distModeDir, dup);
      if (fs.existsSync(dupPath)) {
        fs.unlinkSync(dupPath);
        console.log(`Cleaned legacy duplicate in dist: ${dupPath}`);
      }
    }
  }

  // 1. Generate SVG
  fs.writeFileSync(path.join(modeDir, 'favicon.svg'), generateModeSvg(modeKey));

  // 2. Generate required PNG icons
  const iconConfigs = [
    { name: 'icon-192.png', size: 192, maskable: false },
    { name: 'icon-512.png', size: 512, maskable: false },
    { name: 'maskable-icon.png', size: 512, maskable: true },
    { name: 'apple-touch-icon.png', size: 180, maskable: false },
    { name: 'favicon-32x32.png', size: 32, maskable: false },
    { name: 'favicon-16x16.png', size: 16, maskable: false }
  ];

  for (const cfg of iconConfigs) {
    const pngBuf = createModeIconBuffer(cfg.size, modeKey, cfg.maskable);
    fs.writeFileSync(path.join(modeDir, cfg.name), pngBuf);
  }

  // 3. Generate Web App Manifest referencing ONLY icon-192.png, icon-512.png, maskable-icon.png
  const manifestData = {
    name: MODES[modeKey].name,
    short_name: MODES[modeKey].shortName,
    description: `Cashmint ${MODES[modeKey].shortName} - نظام نقاط بيع وإدارة مطاعم متكامل`,
    start_url: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#0f172a',
    theme_color: '#0f172a',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any'
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any'
      },
      {
        src: '/maskable-icon.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable'
      }
    ]
  };

  const manifestStr = JSON.stringify(manifestData, null, 2);
  fs.writeFileSync(path.join(modeDir, 'manifest.webmanifest'), manifestStr);
  fs.writeFileSync(path.join(modeDir, 'manifest.json'), manifestStr);

  console.log(`✓ Branded icons & manifest generated for mode: ${modeKey}`);
}

console.log("All official Cashmint mode icons generated cleanly!");
