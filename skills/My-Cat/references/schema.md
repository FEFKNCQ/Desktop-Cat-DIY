# KuroCat 自定义猫 Schema 离线参考

优先调用 MCP `get_cat_schema`；本文件用于离线参考。

KuroCat 支持两种皮肤：

- `kind: "params"`（默认）：参数化猫，`upsert_cat` 写入 JSON
- `kind: "image"`：图片猫，`import_image_cat` 导入本地 PNG

---

## 路线 A：参数化猫

### 最小 JSON

```json
{
  "id": "my-cat",
  "name": "我家猫",
  "furColor": "#f2a452"
}
```

### 字段总览

| 字段 | 类型 | 规则 |
|---|---|---|
| `id` | string | 小写 slug，`^[a-z0-9][a-z0-9_-]{0,35}$` |
| `name` | string | 非空显示名 |
| `furColor` | string | `#RGB` 或 `#RRGGBB` |
| `kind` | enum | 可省略；`params` 或 `image` |
| `emoji` | string | 菜单小图标 |
| `pattern` | enum | `solid` / `bicolor` / `tuxedo` / `tabby` / `calico` / `siamese` |
| `furSecondaryColor` / `outlineColor` / `legLineColor` | string | 颜色 |
| `maskColor` / `foreheadBridgeColor` / `flankColor` | string | bicolor / siamese |
| `bellyBibColor` / `stripeColor` / `calicoPatchColor` | string | 花纹 |
| `earOuterColor` / `earTipColor` / `earInnerColor` / `earTuftColor` | string | 耳朵 |
| `tailColor` / `tailTipColor` | string | 尾巴 |
| `tailFluffy` / `tailStripes` | boolean | 尾巴形态 |
| `eyeColorTop` / `eyeColorBottom` / `pupilColor` / `eyeRimColor` | string | 眼睛 |
| `eyeCatchlight` | boolean | 眼睛高光 |
| `noseColor` / `mouthColor` / `blushColor` / `whiskerColor` | string | 面部 |
| `armColor` / `pawColor` / `pawOutlineColor` / `armCreaseColor` | string | 爪子 |
| `accentColor` / `accentSideColor` | string | 键盘/鼠标高亮 |
| `spots` | array | 自定义斑点，最多 8 个 |

### 花纹映射

| pattern | 适用照片 |
|---|---|
| `solid` | 纯色猫 |
| `bicolor` | 布偶 / 双色脸罩 |
| `tuxedo` | 奶牛猫 / 白手套 / 白胸口 |
| `tabby` | 橘猫 / 狸花 / 虎斑 |
| `calico` | 三花 / 玳瑁近似 |
| `siamese` | 暹罗 / 重点色 |

### spots 坐标

```json
{
  "part": "head",
  "x": -0.35,
  "y": -0.15,
  "rx": 7,
  "ry": 5,
  "rotation": 0.2,
  "color": "#b85d19",
  "opacity": 0.8
}
```

- `part`：`head` / `body` / `leftArm` / `rightArm`
- head/body 的 `x/y`：`-1..1`
- leftArm/rightArm 的 `x`：`0..1`，`y` 为侧向像素偏移
- `rx/ry` 建议至少 2
- 最多 8 个，3D 渲染会截断多余斑点

### MCP 写入

```json
{
  "name": "upsert_cat",
  "arguments": {
    "cat": { "...": "CatSkinConfig" },
    "activate": true
  }
}
```

---

## 路线 B：图片猫

### 图片硬约束

| 项 | 要求 |
|---|---|
| 尺寸 | **224 × 278** |
| 格式 | **8-bit RGB 或 RGBA PNG** |
| 背景 | 推荐透明背景 |
| 大小 | 单张 ≤ 12 MB |
| 内容 | 只含猫主体，无背景/文字/水印 |
| 存储 | 复制到 `<app_data>/cat-images/<id>/` |
| 渲染 | 仅 2D Canvas，3D 不可用 |

### 表情文件

| key | 必填 | 用途 |
|---|---|---|
| `idle` | 是 | 默认 |
| `blink` | 否 | 眨眼 |
| `shy` | 否 | 困倦 / 害羞 |
| `happy` | 否 | 被摸 / 按键开心 |

缺少可选表情时复用 `idle`。

### 导入配置

```json
{
  "id": "my-photo-cat",
  "name": "我家猫（照片皮肤）",
  "images": {
    "idle": "C:\\path\\to\\my-cat-idle.png",
    "blink": "C:\\path\\to\\my-cat-blink.png"
  },
  "activate": true
}
```

### MCP 工具

```json
{
  "name": "import_image_cat",
  "arguments": {
    "id": "my-photo-cat",
    "name": "我家猫（照片皮肤）",
    "images": {
      "idle": "C:\\path\\to\\my-cat-idle.png"
    },
    "activate": true
  }
}
```

写入后：

- `renderMode` 自动切为 `2d`
- 前端通过 `get_cat_images` 读取 data URL 并绘制
- `delete_cat` 会删除图片目录

### 校验脚本

```bash
node skills/My-Cat/scripts/import_image_cat.mjs image-cat.json
```

脚本会检查 PNG 签名、IHDR 尺寸、bit depth、color type 和文件大小。

---

## 内置 ID 不要复用

```text
black
calico
dafeiyu
orange-tabby
ragdoll
siamese
tuxedo
```

自定义猫请使用自己的专属 slug，例如 `my-orange-cat`、`photo-cat-luna`。
