#!/usr/bin/env node
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const DEFAULT_PORT = 27420;

function parseArgs(argv) {
  const result = {
    project: process.cwd(),
    start: false,
    build: false,
    install: true,
    checkOnly: false,
    waitOnly: false,
    port: null,
    host: '127.0.0.1',
    timeoutSeconds: 180
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project') result.project = argv[++i] || result.project;
    else if (arg === '--start') result.start = true;
    else if (arg === '--build') result.build = true;
    else if (arg === '--no-install') result.install = false;
    else if (arg === '--check-only') result.checkOnly = true;
    else if (arg === '--wait-only') result.waitOnly = true;
    else if (arg === '--port') result.port = Number(argv[++i]) || null;
    else if (arg === '--host') result.host = argv[++i] || '127.0.0.1';
    else if (arg === '--timeout') result.timeoutSeconds = Number(argv[++i]) || 180;
  }
  return result;
}

function versionTuple(raw) {
  const match = String(raw || '').match(/v?(\d+)\.(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, 0, 0];
}

function atLeast(nodeVersion, major, minor = 0) {
  const [a, b] = versionTuple(nodeVersion);
  return a > major || (a === major && b >= minor);
}

function findNode() {
  const candidates = [];
  if (process.env.KUROCAT_NODE) candidates.push(process.env.KUROCAT_NODE);
  candidates.push(process.execPath);
  if (process.platform === 'win32') {
    candidates.push('C:\\Users\\Administrator\\.workbuddy\\binaries\\node\\versions\\22.22.2-6\\node.exe');
    candidates.push('C:\\Program Files\\nodejs\\node.exe');
  }
  for (const candidate of candidates) {
    if (!candidate || !fs.existsSync(candidate)) continue;
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 5000 });
    if (result.status === 0 && atLeast(result.stdout, 18, 0)) {
      return { executable: candidate, version: result.stdout.trim() };
    }
  }
  return null;
}

function npmInvocation(nodeExecutable, args) {
  const nodeDir = path.dirname(nodeExecutable);
  const cli = path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (fs.existsSync(cli)) {
    return { command: nodeExecutable, args: [cli, ...args], env: { PATH: `${nodeDir}${path.delimiter}${process.env.PATH || ''}` } };
  }
  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args,
    env: { PATH: `${nodeDir}${path.delimiter}${process.env.PATH || ''}` }
  };
}

function runCommand(command, args, cwd, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv }
  });
  if (result.error) throw result.error;
  return result.status === 0;
}

function appDataDir() {
  if (process.platform === 'win32') return path.join(process.env.APPDATA || '', 'kuro-cat-pet');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'kuro-cat-pet');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'kuro-cat-pet');
}

function detectPort() {
  try {
    const settingsPath = path.join(appDataDir(), 'settings.json');
    if (!fs.existsSync(settingsPath)) return DEFAULT_PORT;
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const port = Number(settings.mcpPort ?? settings.mcp_port);
    return Number.isFinite(port) && port > 0 ? port : DEFAULT_PORT;
  } catch (error) {
    return DEFAULT_PORT;
  }
}

function isPortOpen(port, host) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (open) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(700);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function waitForPort(port, host, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    if (await isPortOpen(port, host)) return true;
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  return false;
}

function startDev(nodeExecutable, project) {
  const npm = npmInvocation(nodeExecutable, ['run', 'tauri:dev']);
  const logPath = path.join(os.tmpdir(), 'kurocat-tauri-dev.log');
  const log = fs.openSync(logPath, 'a');
  const child = spawn(npm.command, npm.args, {
    cwd: project,
    env: { ...process.env, ...npm.env },
    detached: true,
    stdio: ['ignore', log, log]
  });
  child.unref();
  fs.closeSync(log);
  return logPath;
}

function printUsage() {
  console.log('用法：node scripts/bootstrap_kurocat.mjs [--start] [--build] [--check-only] [--project <path>] [--port <port>] [--timeout <seconds>]');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const project = path.resolve(args.project);
  const packagePath = path.join(project, 'package.json');
  if (!fs.existsSync(packagePath)) {
    throw new Error(`未找到 package.json：${packagePath}。请用 --project 指定 Desktop-Cat-DIY 根目录。`);
  }

  const node = findNode();
  if (!node) {
    throw new Error('未找到 Node.js 18+。请安装 Node 18+，或设置 KUROCAT_NODE 指向 node.exe。');
  }
  const port = args.port ?? detectPort();
  const url = `http://${args.host}:${port}/mcp`;

  console.log(`project: ${project}`);
  console.log(`node:    ${node.version}  ${node.executable}`);
  console.log(`mcp:     ${url}`);

  if (args.checkOnly) {
    console.log(`deps:    ${fs.existsSync(path.join(project, 'node_modules')) ? 'installed' : 'missing (run without --check-only)'}`);
    console.log('check-only 完成。');
    return;
  }

  if (args.waitOnly) {
    const ok = await waitForPort(port, args.host, args.timeoutSeconds);
    if (!ok) throw new Error(`MCP 端口 ${port} 在 ${args.timeoutSeconds}s 内未就绪。请确认 KuroCat 已启动并勾选“开启 MCP 扩展”。`);
    console.log(`MCP 已就绪：${url}`);
    return;
  }

  if (args.install && !fs.existsSync(path.join(project, 'node_modules'))) {
    const npm = npmInvocation(node.executable, ['install']);
    console.log('install: npm install');
    if (!runCommand(npm.command, npm.args, project, npm.env)) throw new Error('npm install 失败');
  }

  if (args.build) {
    const npm = npmInvocation(node.executable, ['run', 'tauri:build']);
    console.log('build:   npm run tauri:build');
    if (!runCommand(npm.command, npm.args, project, npm.env)) throw new Error('npm run tauri:build 失败');
    console.log('安装包目录：src-tauri/target/release/bundle');
    return;
  }

  if (args.start) {
    if (await isPortOpen(port, args.host)) {
      console.log(`MCP 已运行：${url}`);
      return;
    }
    const logPath = startDev(node.executable, project);
    console.log(`start:   npm run tauri:dev（日志：${logPath}）`);
    const ok = await waitForPort(port, args.host, args.timeoutSeconds);
    if (!ok) {
      throw new Error(`KuroCat 已启动但 MCP 端口 ${port} 未就绪。请在托盘确认“开启 MCP 扩展”，或查看日志：${logPath}`);
    }
    console.log(`MCP 已就绪：${url}`);
    return;
  }

  printUsage();
}

main().catch((error) => {
  console.error(`[bootstrap_kurocat] ${error.message}`);
  process.exit(1);
});
