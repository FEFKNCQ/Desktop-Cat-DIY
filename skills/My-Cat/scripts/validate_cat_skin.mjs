#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PATTERNS = new Set(['solid', 'bicolor', 'tuxedo', 'tabby', 'calico', 'siamese']);
const SPOT_PARTS = new Set(['head', 'body', 'leftArm', 'rightArm']);
const BUILTIN_IDS = new Set(['black', 'calico', 'dafeiyu', 'orange-tabby', 'ragdoll', 'siamese', 'tuxedo']);

const COLOR_FIELDS = [
  'furColor', 'furSecondaryColor', 'outlineColor', 'legLineColor', 'maskColor',
  'foreheadBridgeColor', 'flankColor', 'bellyBibColor', 'stripeColor', 'calicoPatchColor',
  'earOuterColor', 'earTipColor', 'earInnerColor', 'earTuftColor', 'tailColor', 'tailTipColor',
  'eyeColorTop', 'eyeColorBottom', 'pupilColor', 'eyeRimColor', 'squintColor', 'squintGlowColor',
  'noseColor', 'mouthColor', 'blushColor', 'whiskerColor', 'armColor', 'pawColor',
  'pawOutlineColor', 'armCreaseColor', 'accentColor', 'accentSideColor'
];

const BOOL_FIELDS = [
  'builtin', 'tailFluffy', 'tailStripes', 'eyeCatchlight'
];

const KNOWN_FIELDS = new Set([
  'id', 'name', 'emoji', ...COLOR_FIELDS, ...BOOL_FIELDS, 'pattern', 'spots', 'kind', 'imageSkin'
]);

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const SLUG = /^[a-z0-9][a-z0-9_-]{0,35}$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function sanitizeId(raw) {
  const cleaned = String(raw ?? '')
    .trim()
    .toLowerCase()
    .split('')
    .map((c) => (/[a-z0-9_-]/.test(c) ? c : '-'))
    .join('')
    .replace(/^-+|-+$/g, '');
  return cleaned ? cleaned.slice(0, 36) : 'custom-cat';
}

export function extractCats(input) {
  if (Array.isArray(input)) return input;
  if (!isPlainObject(input)) return [input];
  if (isPlainObject(input.arguments) && input.arguments.cat !== undefined) return [input.arguments.cat];
  if (input.cat !== undefined) return [input.cat];
  return [input];
}

function validateOne(cat, index) {
  const errors = [];
  const warnings = [];

  if (!isPlainObject(cat)) {
    return { index, id: `#${index}`, ok: false, errors: ['配置文件必须是 JSON 对象'], warnings };
  }

  const id = typeof cat.id === 'string' ? cat.id.trim() : '';
  if (!id) {
    errors.push('缺少必填字段 id');
  } else if (!SLUG.test(id)) {
    const fixed = sanitizeId(id);
    errors.push(`id 必须是小写 slug（^[a-z0-9][a-z0-9_-]{0,35}$），建议改为 "${fixed}"`);
  } else if (BUILTIN_IDS.has(id)) {
    warnings.push(`id "${id}" 与内置猫冲突，写入后会覆盖内置外观；建议换一个专属 id`);
  }

  if (typeof cat.name !== 'string' || !cat.name.trim()) {
    errors.push('缺少必填字段 name');
  }

  if (typeof cat.furColor !== 'string' || !HEX.test(cat.furColor.trim())) {
    errors.push('缺少或无效的必填字段 furColor，需要 #RGB 或 #RRGGBB');
  }

  if (cat.pattern !== undefined && !PATTERNS.has(cat.pattern)) {
    errors.push(`pattern 必须是 ${[...PATTERNS].join(' / ')} 之一`);
  }

  for (const field of COLOR_FIELDS) {
    if (cat[field] !== undefined && (typeof cat[field] !== 'string' || !HEX.test(cat[field].trim()))) {
      errors.push(`${field} 必须是 #RGB 或 #RRGGBB`);
    }
  }

  for (const field of BOOL_FIELDS) {
    if (cat[field] !== undefined && typeof cat[field] !== 'boolean') {
      errors.push(`${field} 必须是布尔值`);
    }
  }

  if (cat.builtin === true) {
    warnings.push('builtin: true 是内置猫标记，自定义猫通常不要设置');
  }

  if (cat.kind !== undefined && cat.kind !== 'params' && cat.kind !== 'image') {
    errors.push('kind 只能是 "params" 或 "image"');
  }
  if (cat.kind === 'image') {
    if (!isPlainObject(cat.imageSkin)) {
      errors.push('kind 为 image 时必须提供 imageSkin 对象');
    } else {
      if (typeof cat.imageSkin.idle !== 'string' || !cat.imageSkin.idle.trim()) {
        errors.push('imageSkin.idle 是必填图片文件名');
      }
      for (const key of ['blink', 'shy', 'happy']) {
        if (cat.imageSkin[key] !== undefined && typeof cat.imageSkin[key] !== 'string') {
          errors.push(`imageSkin.${key} 必须是图片文件名字符串`);
        }
      }
      for (const key of ['width', 'height']) {
        const value = cat.imageSkin[key];
        if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) {
          errors.push(`imageSkin.${key} 必须是正数`);
        }
      }
    }
  } else if (cat.imageSkin) {
    warnings.push('imageSkin 已提供但 kind 不是 image，会被忽略');
  }

  if (cat.spots !== undefined && !Array.isArray(cat.spots)) {
    errors.push('spots 必须是数组');
  } else if (Array.isArray(cat.spots)) {
    if (cat.spots.length > 8) {
      errors.push(`spots 最多 8 个，当前 ${cat.spots.length} 个；3D 渲染会截断多余斑点`);
    }
    cat.spots.forEach((spot, i) => {
      const label = `spots[${i}]`;
      if (!isPlainObject(spot)) {
        errors.push(`${label} 必须是对象`);
        return;
      }
      if (!SPOT_PARTS.has(spot.part)) {
        errors.push(`${label}.part 必须是 ${[...SPOT_PARTS].join(' / ')} 之一`);
      }
      for (const key of ['x', 'y', 'rx', 'ry']) {
        if (typeof spot[key] !== 'number' || !Number.isFinite(spot[key])) {
          errors.push(`${label}.${key} 必须是有限数字`);
        }
      }
      if (typeof spot.color !== 'string' || !HEX.test(spot.color.trim())) {
        errors.push(`${label}.color 必须是 #RGB 或 #RRGGBB`);
      }
      if (spot.part === 'head' || spot.part === 'body') {
        for (const key of ['x', 'y']) {
          if (typeof spot[key] === 'number' && (spot[key] < -1 || spot[key] > 1)) {
            errors.push(`${label}.${key} 对 head/body 必须在 -1..1`);
          }
        }
      }
      if (spot.part === 'leftArm' || spot.part === 'rightArm') {
        if (typeof spot.x === 'number' && (spot.x < 0 || spot.x > 1)) {
          errors.push(`${label}.x 对 leftArm/rightArm 必须在 0..1`);
        }
        if (typeof spot.y === 'number' && Math.abs(spot.y) > 60) {
          warnings.push(`${label}.y 是手臂侧向像素偏移，绝对值大于 60 可能不可见`);
        }
      }
      if ((typeof spot.rx === 'number' && spot.rx < 2) || (typeof spot.ry === 'number' && spot.ry < 2)) {
        warnings.push(`${label} 的 rx/ry 建议至少 2，否则斑点可能不可见`);
      }
      if (spot.rotation !== undefined && (typeof spot.rotation !== 'number' || !Number.isFinite(spot.rotation))) {
        errors.push(`${label}.rotation 必须是有限数字`);
      }
      if (spot.opacity !== undefined && (typeof spot.opacity !== 'number' || spot.opacity < 0 || spot.opacity > 1)) {
        errors.push(`${label}.opacity 必须在 0..1`);
      }
    });
  }

  const unknown = Object.keys(cat).filter((key) => !KNOWN_FIELDS.has(key));
  if (unknown.length) {
    warnings.push(`未识别字段会被 Rust 忽略：${unknown.join(', ')}`);
  }

  return { index, id: id || `#${index}`, ok: errors.length === 0, errors, warnings };
}

export function validateCatSkin(input) {
  const cats = extractCats(input);
  return { ok: cats.every((cat, index) => validateOne(cat, index).ok), cats: cats.map(validateOne) };
}

function readInput(file) {
  const raw = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
  return JSON.parse(raw);
}

function main() {
  const file = process.argv[2];
  let input;
  try {
    input = readInput(file);
  } catch (error) {
    console.error(`[validate_cat_skin] JSON 读取/解析失败：${error.message}`);
    process.exit(1);
  }

  const report = validateCatSkin(input);
  for (const item of report.cats) {
    console.log(`[${item.ok ? 'OK' : 'FAIL'}] cat #${item.index + 1} (${item.id})`);
    item.errors.forEach((message) => console.log(`  ERROR: ${message}`));
    item.warnings.forEach((message) => console.log(`  WARN:  ${message}`));
  }
  if (!report.ok) process.exit(1);
  console.log(`校验通过：${report.cats.length} 只猫`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
