#!/usr/bin/env node
/**
 * RigMaster — Phase D Sprite Chroma-Key Processor (`scripts/process-sprites.mjs`)
 *
 * Broadcast-grade chroma-key removal + edge despill + interior-hole cutout + auto-trim + Lanczos resize.
 * Uses ImageMagick (`convert` / `identify`) for image I/O — zero extra npm dependencies.
 *
 * Usage:
 *   node scripts/process-sprites.mjs <input> <output.png> [--key=magenta|green] [--maxH=512] [--pad=2] [--preview=out.png]
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const positional = [];
  const opts = { key: 'magenta', maxH: 512, pad: 2, preview: null };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--key=')) opts.key = arg.slice(6);
    else if (arg.startsWith('--maxH=')) opts.maxH = Number(arg.slice(7));
    else if (arg.startsWith('--pad=')) opts.pad = Number(arg.slice(6));
    else if (arg.startsWith('--preview=')) opts.preview = arg.slice(10);
    else positional.push(arg);
  }
  if (positional.length < 2) {
    console.error('Usage: node scripts/process-sprites.mjs <input> <output.png> [--key=magenta|green] [--maxH=512] [--pad=2] [--preview=preview.png]');
    process.exit(1);
  }
  return { input: positional[0], output: positional[1], ...opts };
}

function getDimensions(filePath) {
  const out = execFileSync('identify', ['-format', '%w %h', filePath], { encoding: 'utf8' }).trim();
  const [w, h] = out.split(/\s+/).map(Number);
  if (!w || !h) throw new Error(`Failed to read dimensions of ${filePath}`);
  return { w, h };
}

function decodeRGBA(filePath) {
  const { w, h } = getDimensions(filePath);
  const buf = execFileSync('convert', [filePath, '-alpha', 'on', '-depth', '8', 'rgba:-'], {
    maxBuffer: w * h * 4 + 1024 * 1024,
  });
  return { w, h, data: new Uint8Array(buf.buffer, buf.byteOffset, w * h * 4) };
}

function removeChromaKey(w, h, data, keyType) {
  const n = w * h;
  // 1. High-confidence seed mask: catches exterior background AND interior frame cutouts
  //    without ever touching crimson/red paint or dark purple glass tint.
  const seed = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];

    if (keyType === 'green') {
      const greenExcess = g - Math.max(r, b);
      if (g > 165 && greenExcess > 95 && Math.abs(r - b) < 75) {
        seed[i] = 1;
      }
    } else {
      // Magenta #FF00FF: both R and B are very high, G is low, and R ≈ B
      const magExcess = Math.min(r, b) - g;
      if (r > 165 && b > 165 && magExcess > 95 && Math.abs(r - b) < 75) {
        seed[i] = 1;
      }
    }
  }

  // 2. Dilate seed mask by 2px so soft JPEG anti-aliased edge pixels around the cutout are flagged
  const nearKey = new Uint8Array(n);
  const dilatePass = (src, dst) => {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const idx = row + x;
        if (src[idx]) {
          dst[idx] = 1;
          continue;
        }
        if (
          (x > 0 && src[idx - 1]) ||
          (x + 1 < w && src[idx + 1]) ||
          (y > 0 && src[idx - w]) ||
          (y + 1 < h && src[idx + w]) ||
          (x > 0 && y > 0 && src[idx - w - 1]) ||
          (x + 1 < w && y > 0 && src[idx - w + 1]) ||
          (x > 0 && y + 1 < h && src[idx + w - 1]) ||
          (x + 1 < w && y + 1 < h && src[idx + w + 1])
        ) {
          dst[idx] = 1;
        }
      }
    }
  };
  const pass1 = new Uint8Array(n);
  dilatePass(seed, pass1);
  dilatePass(pass1, nearKey);

  // 3. Apply transparent cutout on seed pixels + smooth feathering & despill on edge ring
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (seed[i]) {
      data[o] = 0;
      data[o + 1] = 0;
      data[o + 2] = 0;
      data[o + 3] = 0;
      continue;
    }

    if (!nearKey[i]) continue;

    let r = data[o];
    let g = data[o + 1];
    let b = data[o + 2];

    if (keyType === 'green') {
      const maxRB = Math.max(r, b);
      const excess = g - maxRB;
      if (excess > 14 && Math.abs(r - b) < 95) {
        const alpha = Math.max(0, Math.min(255, Math.round(255 * (1 - (excess - 14) / 85))));
        // Despill green fringe cleanly
        g = maxRB;
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
        data[o + 3] = alpha;
      }
    } else {
      const minRB = Math.min(r, b);
      const excess = minRB - g;
      if (excess > 14 && Math.abs(r - b) < 95) {
        // Compute feathered alpha from remaining magenta excess
        const alpha = Math.max(0, Math.min(255, Math.round(255 * (1 - (excess - 14) / 85))));
        // Despill magenta fringe cleanly into neutral dark charcoal outline
        r = Math.max(0, r - excess);
        b = Math.max(0, b - excess);
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
        data[o + 3] = alpha;
      }
    }
  }
}

function findTrimBounds(w, h, data, alphaThresh = 20) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (data[(row + x) * 4 + 3] > alphaThresh) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) {
    throw new Error('Image became completely transparent after chroma-key removal!');
  }
  return { minX, minY, maxX, maxY };
}

function cropWithPadding(w, h, data, bounds, pad) {
  const cw = bounds.maxX - bounds.minX + 1 + pad * 2;
  const ch = bounds.maxY - bounds.minY + 1 + pad * 2;
  const out = new Uint8Array(cw * ch * 4);
  for (let y = bounds.minY; y <= bounds.maxY; y++) {
    const dy = y - bounds.minY + pad;
    const srcOff = (y * w + bounds.minX) * 4;
    const dstOff = (dy * cw + pad) * 4;
    const rowBytes = (bounds.maxX - bounds.minX + 1) * 4;
    out.set(data.subarray(srcOff, srcOff + rowBytes), dstOff);
  }
  return { w: cw, h: ch, data: out };
}

function savePNG(w, h, data, outputPath, maxH) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const args = [
    '-size', `${w}x${h}`,
    '-depth', '8',
    'rgba:-',
  ];
  if (maxH > 0 && h > maxH) {
    args.push('-filter', 'Lanczos', '-resize', `x${maxH}`);
  }
  args.push('-strip', `PNG32:${outputPath}`);
  execFileSync('convert', args, { input: Buffer.from(data.buffer, data.byteOffset, data.byteLength) });
}

function makePreviewSheet(pngPath, previewPath) {
  fs.mkdirSync(path.dirname(previewPath), { recursive: true });
  execFileSync('convert', [
    '(', pngPath, '-background', '#18202c', '-alpha', 'remove', '-bordercolor', '#18202c', '-border', '24', ')',
    '(', pngPath, '-background', '#e2e8f0', '-alpha', 'remove', '-bordercolor', '#e2e8f0', '-border', '24', ')',
    '+append',
    previewPath,
  ]);
}

const opts = parseArgs(process.argv);
const src = decodeRGBA(opts.input);
removeChromaKey(src.w, src.h, src.data, opts.key);
const bounds = findTrimBounds(src.w, src.h, src.data);
const cropped = cropWithPadding(src.w, src.h, src.data, bounds, opts.pad);
savePNG(cropped.w, cropped.h, cropped.data, opts.output, opts.maxH);
const finalDim = getDimensions(opts.output);
const sizeKb = (fs.statSync(opts.output).size / 1024).toFixed(1);

if (opts.preview) {
  makePreviewSheet(opts.output, opts.preview);
}

console.log(
  JSON.stringify({
    input: opts.input,
    output: opts.output,
    key: opts.key,
    sourceSize: `${src.w}x${src.h}`,
    croppedSize: `${cropped.w}x${cropped.h}`,
    finalSize: `${finalDim.w}x${finalDim.h}`,
    aspect: Number((finalDim.w / finalDim.h).toFixed(3)),
    sizeKb: Number(sizeKb),
  }),
);
