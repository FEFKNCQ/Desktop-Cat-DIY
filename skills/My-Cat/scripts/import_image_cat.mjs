#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import zlib from 'node:zlib';

const DEFAULT_URL = 'http://127.0.0.1:27420/mcp';
const EXPECTED_W = 224;
const EXPECTED_H = 278;
const SLUG = /^[a-z0-9][a-z0-9_-]{0,35}$/;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function parseArgs(argv) {
  const result = { file: '', url: DEFAULT_URL, activate: true, verify: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--url') result.url = argv[++i] || DEFAULT_URL;
    else if (arg === '--activate=false' || arg === '--no-activate') result.activate = false;
    else if (arg === '--no-verify') result.verify = false;
    else if (!arg.startsWith('--')) result.file = arg;
  }
  return result;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function readPngRgbaRows(buf, width, height) {
  let offset = 8;
  const idat = [];
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    if (offset + 12 + length > buf.length) throw new Error('PNG chunk out of bounds');
    if (type === 'IDAT') idat.push(buf.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  if (!idat.length) throw new Error('PNG has no IDAT');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  if (raw.length < height * (stride + 1)) throw new Error('PNG pixel data too short');

  const rows = [];
  let prev = Buffer.alloc(stride);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const cur = Buffer.from(raw.subarray(pos, pos + stride));
    pos += stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? cur[x - 4] : 0;
      const up = prev[x];
      const upLeft = x >= 4 ? prev[x - 4] : 0;
      if (filter === 1) cur[x] = (cur[x] + left) & 0xff;
      else if (filter === 2) cur[x] = (cur[x] + up) & 0xff;
      else if (filter === 3) cur[x] = (cur[x] + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) cur[x] = (cur[x] + paeth(left, up, upLeft)) & 0xff;
      else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}`);
    }
    rows.push(cur);
    prev = cur;
  }
  return rows;
}

function validatePng(filePath, label) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return `${label} 必须是本地 PNG 文件路径`;
  }
  if (!fs.existsSync(filePath)) return `${label} 文件不存在：${filePath}`;
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return `${label} 不是文件`;
  if (stat.size === 0 || stat.size > 12 * 1024 * 1024) return `${label} 大小必须在 1 字节到 12MB 之间`;

  let buf;
  try {
    buf = fs.readFileSync(filePath);
  } catch (error) {
    return `${label} 读取失败：${error.message}`;
  }
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) return `${label} 不是 PNG 文件`;
  if (buf.readUInt32BE(8) !== 13 || buf.toString('ascii', 12, 16) !== 'IHDR') {
    return `${label} PNG IHDR 无效`;
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width !== EXPECTED_W || height !== EXPECTED_H) {
    return `${label} 必须是 ${EXPECTED_W}x${EXPECTED_H}，当前 ${width}x${height}`;
  }
  const bitDepth = buf[24];
  const colorType = buf[25];
  if (bitDepth !== 8 || colorType !== 6) {
    return `${label} 必须是 8-bit RGBA PNG（带透明通道）；不接受 RGB 或不透明背景`;
  }
  try {
    const rows = readPngRgbaRows(buf, width, height);
    const alphaAt = (x, y) => rows[y][x * 4 + 3];
    if (alphaAt(0, 0) !== 0 || alphaAt(width - 1, 0) !== 0 || alphaAt(0, height - 1) !== 0 || alphaAt(width - 1, height - 1) !== 0) {
      return `${label} 背景必须透明：PNG 四角 alpha 必须为 0，禁止导入整张背景/风景图`;
    }
  } catch (error) {
    return `${label} PNG alpha 校验失败：${error.message}`;
  }
  return null;
}

function validatePayload(payload, activateArg) {
  const errors = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return ['配置文件必须是 JSON 对象'];
  }
  if (typeof payload.id !== 'string' || !SLUG.test(payload.id)) {
    errors.push('id 必须是小写 slug（^[a-z0-9][a-z0-9_-]{0,35}$）');
  }
  if (typeof payload.name !== 'string' || !payload.name.trim()) {
    errors.push('name 不能为空');
  }
  if (!payload.images || typeof payload.images !== 'object' || Array.isArray(payload.images)) {
    errors.push('images 必须是对象');
    return errors;
  }
  const allowedImageKeys = ['idle', 'blink', 'shy', 'happy', 'angry', 'curious'];
  for (const key of Object.keys(payload.images)) {
    if (!allowedImageKeys.includes(key)) {
      errors.push(`images.${key} 不支持，只能用 idle/blink/shy/happy/angry/curious`);
    }
  }
  if (!payload.images.idle) errors.push('images.idle 是必填项');
  for (const key of allowedImageKeys) {
    if (payload.images[key] !== undefined) {
      const error = validatePng(payload.images[key], `images.${key}`);
      if (error) errors.push(error);
    }
  }
  if (payload.anchors !== undefined) {
    if (!payload.anchors || typeof payload.anchors !== 'object' || Array.isArray(payload.anchors)) {
      errors.push('anchors 必须是对象');
    } else {
      const isUnit = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
      for (const key of ['headBox', 'leftPawBox', 'rightPawBox']) {
        const box = payload.anchors[key];
        if (box === undefined) continue;
        if (!box || typeof box !== 'object' || Array.isArray(box)) {
          errors.push(`anchors.${key} 必须是 {x,y,w,h} 对象`);
          continue;
        }
        for (const part of ['x', 'y', 'w', 'h']) {
          if (!isUnit(box[part])) errors.push(`anchors.${key}.${part} 必须是 0..1 的数字`);
        }
        if (typeof box.w === 'number' && box.w <= 0) errors.push(`anchors.${key}.w 必须大于 0`);
        if (typeof box.h === 'number' && box.h <= 0) errors.push(`anchors.${key}.h 必须大于 0`);
      }
      const tail = payload.anchors.tailAnchor;
      if (tail !== undefined) {
        if (!tail || typeof tail !== 'object' || Array.isArray(tail)) {
          errors.push('anchors.tailAnchor 必须是 {x,y} 对象');
        } else {
          for (const part of ['x', 'y']) {
            if (!isUnit(tail[part])) errors.push(`anchors.tailAnchor.${part} 必须是 0..1 的数字`);
          }
        }
      }
    }
  }
  if (payload.pet !== undefined) {
    if (!payload.pet || typeof payload.pet !== 'object' || Array.isArray(payload.pet)) {
      errors.push('pet 必须是对象');
    } else {
      const allowedPet = new Set(['petType', 'motionProfile', 'tailMode', 'pawMode']);
      const enums = {
        petType: ['cat', 'dog', 'rabbit', 'bird', 'fish', 'other'],
        motionProfile: ['cat', 'dog', 'generic', 'none'],
        tailMode: ['cat', 'wag', 'none', 'image'],
        pawMode: ['vector', 'crop', 'none']
      };
      for (const [key, value] of Object.entries(payload.pet)) {
        if (!allowedPet.has(key)) errors.push(`pet.${key} 不支持`);
        else if (typeof value !== 'string' || !enums[key].includes(value)) {
          errors.push(`pet.${key} 必须是 ${enums[key].join(' / ')} 之一`);
        }
      }
    }
  }
  if (payload.colors !== undefined) {
    if (!payload.colors || typeof payload.colors !== 'object' || Array.isArray(payload.colors)) {
      errors.push('colors 必须是对象');
    } else {
      const allowed = new Set(['furColor', 'pawColor', 'tailColor', 'tailTipColor', 'outlineColor', 'accentColor', 'accentSideColor', 'noseColor', 'eyeColorTop', 'eyeColorBottom']);
      for (const [key, value] of Object.entries(payload.colors)) {
        if (!allowed.has(key)) errors.push(`colors.${key} 不支持`);
        else if (typeof value !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim())) {
          errors.push(`colors.${key} 必须是 #RGB 或 #RRGGBB`);
        }
      }
    }
  }
  return errors;
}

function rpc(url, method, params) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch (error) {
      reject(new Error(`MCP URL 无效：${error.message}`));
      return;
    }
    const body = JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params });
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port || 80,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Accept: 'application/json, text/event-stream'
        }
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`MCP HTTP ${res.statusCode}: ${raw.slice(0, 300)}`));
            return;
          }
          try {
            resolve(JSON.parse(raw));
          } catch (error) {
            reject(new Error(`MCP 返回不是 JSON：${raw.slice(0, 300)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function readResultText(response) {
  if (response?.error) throw new Error(`JSON-RPC error ${response.error.code}: ${response.error.message}`);
  const content = response?.result?.content;
  if (Array.isArray(content)) {
    return content.map((item) => item?.text || '').filter(Boolean).join('\n');
  }
  return JSON.stringify(response?.result ?? {}, null, 2);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error('用法：node scripts/import_image_cat.mjs <image-cat.json> [--url http://127.0.0.1:27420/mcp] [--no-activate] [--no-verify]');
    process.exit(1);
  }

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(args.file, 'utf8'));
  } catch (error) {
    console.error(`[import_image_cat] JSON 读取失败：${error.message}`);
    process.exit(1);
  }

  const errors = validatePayload(payload, args.activate);
  if (errors.length) {
    errors.forEach((message) => console.error(`ERROR: ${message}`));
    console.error('图片校验失败，未调用 MCP。');
    process.exit(1);
  }

  const toolList = await rpc(args.url, 'tools/list');
  const toolNames = (toolList?.result?.tools || []).map((tool) => tool?.name).filter(Boolean);
  const prefersPetTool = payload.pet?.petType && payload.pet.petType !== 'cat';
  const toolName = prefersPetTool && toolNames.includes('import_image_pet')
    ? 'import_image_pet'
    : toolNames.includes('import_image_cat')
      ? 'import_image_cat'
      : toolNames.includes('import_image_pet')
        ? 'import_image_pet'
        : null;
  if (!toolName) {
    throw new Error(`当前 MCP 缺少图片导入工具（工具：${toolNames.join(', ') || '无'}）。请关闭/卸载旧版 KuroCat，改用 v5.2.7+ 安装包或从 main 源码启动。`);
  }

  const argumentsPayload = {
    id: payload.id,
    name: payload.name,
    images: payload.images,
    colors: payload.colors || {},
    anchors: payload.anchors || {},
    pet: payload.pet || {},
    activate: typeof payload.activate === 'boolean' ? payload.activate : args.activate
  };

  const response = await rpc(args.url, 'tools/call', {
    name: toolName,
    arguments: argumentsPayload
  });
  const resultText = readResultText(response);
  console.log(resultText);
  if (response?.result?.isError) process.exit(1);

  if (args.verify) {
    const list = await rpc(args.url, 'tools/call', { name: 'list_cats', arguments: {} });
    const text = readResultText(list).replace(/\\"/g, '"');
    if (!text.includes(`"id":"${payload.id}"`) && !text.includes(`"id": "${payload.id}"`)) {
      console.warn(`验证提醒：list_cats 中未找到 ${payload.id}，请人工确认。`);
    } else {
      console.log('已调用 list_cats 做验证。');
    }
  }
}

main().catch((error) => {
  console.error(`[import_image_cat] ${error.message}`);
  process.exit(1);
});
