#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';

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

function validatePng(filePath, label) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return `${label} 必须是本地 PNG 文件路径`;
  }
  if (!fs.existsSync(filePath)) return `${label} 文件不存在：${filePath}`;
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return `${label} 不是文件`;
  if (stat.size === 0 || stat.size > 12 * 1024 * 1024) return `${label} 大小必须在 1 字节到 12MB 之间`;
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(29);
  try {
    fs.readSync(fd, buf, 0, buf.length, 0);
  } finally {
    fs.closeSync(fd);
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
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    return `${label} 必须是 8-bit RGB 或 RGBA PNG`;
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
  for (const key of Object.keys(payload.images)) {
    if (!['idle', 'blink', 'shy', 'happy'].includes(key)) {
      errors.push(`images.${key} 不支持，只能用 idle/blink/shy/happy`);
    }
  }
  if (!payload.images.idle) errors.push('images.idle 是必填项');
  for (const key of ['idle', 'blink', 'shy', 'happy']) {
    if (payload.images[key] !== undefined) {
      const error = validatePng(payload.images[key], `images.${key}`);
      if (error) errors.push(error);
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
  if (!toolNames.includes('import_image_cat')) {
    throw new Error(`当前 MCP 缺少 import_image_cat（工具：${toolNames.join(', ') || '无'}）。请关闭/卸载旧版 KuroCat，改用 v5.2.2+ 安装包或从 main 源码启动。`);
  }

  const argumentsPayload = {
    id: payload.id,
    name: payload.name,
    images: payload.images,
    colors: payload.colors || {},
    activate: typeof payload.activate === 'boolean' ? payload.activate : args.activate
  };

  const response = await rpc(args.url, 'tools/call', {
    name: 'import_image_cat',
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
