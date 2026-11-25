#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import { validateCatSkin } from './validate_cat_skin.mjs';

const DEFAULT_URL = 'http://127.0.0.1:27420/mcp';

function parseArgs(argv) {
  const result = { file: '', url: DEFAULT_URL, activate: true, verify: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--url') {
      result.url = argv[++i] || DEFAULT_URL;
    } else if (arg === '--activate=false' || arg === '--no-activate') {
      result.activate = false;
    } else if (arg === '--no-verify') {
      result.verify = false;
    } else if (!arg.startsWith('--')) {
      result.file = arg;
    }
  }
  return result;
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
    console.error('用法：node scripts/upsert_cat_from_json.mjs <cat.json> [--url http://127.0.0.1:27420/mcp] [--no-activate] [--no-verify]');
    process.exit(1);
  }

  let input;
  try {
    input = JSON.parse(fs.readFileSync(args.file, 'utf8'));
  } catch (error) {
    console.error(`[upsert_cat_from_json] JSON 读取失败：${error.message}`);
    process.exit(1);
  }

  const report = validateCatSkin(input);
  if (!report.ok) {
    for (const item of report.cats) {
      item.errors.forEach((message) => console.error(`ERROR [${item.id}] ${message}`));
    }
    console.error('JSON 校验失败，未调用 MCP。');
    process.exit(1);
  }
  report.cats.forEach((item) => item.warnings.forEach((message) => console.warn(`WARN [${item.id}] ${message}`)));

  const cats = report.cats.map((item) => {
    if (Array.isArray(input) || input.cat || input.arguments?.cat) return null;
    return item.id;
  });

  let payload;
  if (Array.isArray(input)) {
    payload = input;
  } else if (input.arguments?.cat || input.cat) {
    payload = input;
  } else {
    payload = input;
  }

  if (Array.isArray(payload)) {
    for (const cat of payload) {
      const response = await rpc(args.url, 'tools/call', {
        name: 'upsert_cat',
        arguments: { cat, activate: args.activate }
      });
      console.log(readResultText(response));
    }
  } else {
    const cat = payload.cat || payload.arguments?.cat || payload;
    const response = await rpc(args.url, 'tools/call', {
      name: 'upsert_cat',
      arguments: { cat, activate: args.activate }
    });
    console.log(readResultText(response));
  }

  if (args.verify) {
    const response = await rpc(args.url, 'tools/call', { name: 'list_cats', arguments: {} });
    const rawText = readResultText(response);
    const text = rawText.replace(/\\"/g, '"');
    const missing = cats.filter((id) => id && !text.includes(`"id": "${id}"`) && !text.includes(`"id":"${id}"`));
    if (missing.length) {
      console.warn(`验证提醒：list_cats 文本中未直接找到 id：${missing.join(', ')}（可人工确认）`);
    }
    console.log('已调用 list_cats 做验证。');
  }
}

main().catch((error) => {
  console.error(`[upsert_cat_from_json] ${error.message}`);
  process.exit(1);
});
