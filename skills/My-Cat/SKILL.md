---
name: My-Cat
description: 根据用户上传的至少一张参考图片（照片、截图或卡通图均可），为 Desktop-Cat-DIY / KuroCat 生成尽量还原的专属桌宠，并直接部署到本机、启动、导入、切换。支持参数化还原（CatSkinConfig JSON + upsert_cat）和真实图片皮肤（224x278 透明 PNG + import_image_cat）。标准触发语：“用 GitHub 上作者 FEFKNCQ 的Desktop-Cat-DIY 部署到本机，用 My-Cat skill 把我上传的图做成我的专属桌宠，直接帮我导入并切换”。也响应用户说“用 My-Cat skill”“把这张图做成我的桌宠”“按这张照片捏猫”。不要询问实拍还是卡通；若不在项目目录，先从 https://github.com/FEFKNCQ/Desktop-Cat-DIY 获取 skills/My-Cat/SKILL.md。
---

# My-Cat 照片定制猫

这个技能把用户猫照片变成 Desktop-Cat-DIY 可直接加载的桌宠。根据用户需求分两条路线：

| 路线 | 最终产物 | MCP 工具 | 效果 |
|---|---|---|---|
| A. 参数化还原 | `CatSkinConfig` JSON | `upsert_cat` | 6 种花纹 + 颜色 + 斑点，稳定但只能近似 |
| B. 图片皮肤 | 本地 PNG 文件 + 配置 | `import_image_cat` | 生成图直接当桌宠外观，照片还原度高 |

默认策略：

- **至少一张参考图片是硬要求**；用户没给就只请用户补充，不继续安装/导入
- **不要询问“实拍还是卡通”**；照片、截图、卡通图一视同仁
- 默认按“尽量还原参考图”执行 → **路线 B（图片皮肤）**
- 只有用户明确说“只要配色花纹 / 参数化 / 卡通一点 / 快一点” → **路线 A**
- 不再追问图片风格，不因为实拍/卡通而改变流程

## 标准触发语

用户只需说这一句：

```text
用 GitHub 上作者 FEFKNCQ 的Desktop-Cat-DIY 部署到本机，用 My-Cat skill 把我上传的图做成我的专属桌宠，直接帮我导入并切换
```

要求：

- 用户必须已上传**至少一张参考图片**；没有图片时只请求补充，不做安装/导入
- 不要询问“实拍还是卡通”，也不要让用户二选一
- 默认按“尽量还原参考图”执行，优先图片皮肤路线

Agent 不在项目目录时，先从：

```text
https://github.com/FEFKNCQ/Desktop-Cat-DIY
```

获取 `skills/My-Cat/SKILL.md`，再按本流程执行。

## 核心原则

1. **路线 A 的产物是 JSON，不是图片**  
   参数化猫由 `CatSkinConfig` 驱动，生成图只能做参考，不作为资源。

2. **路线 B 的产物是 224x278 PNG**  
   图片皮肤会复制到应用数据目录，不依赖 Agent 临时目录，也不把路径写死到 `cats.json`。

3. **先 schema，后生成**  
   优先调用 MCP `get_cat_schema`；本技能文档只作离线参考。

4. **先校验，后写入**  
   参数 JSON 用 `validate_cat_skin.mjs`；图片用 `import_image_cat.mjs` 内置 PNG 校验。

5. **图片皮肤只走 2D**  
   `import_image_cat` 会把 `renderMode` 改为 `2d`；3D shader 不支持用户图片。

## 阶段 -1：安装、启动与 MCP 就绪（Agent 必须从这一步开始）

当用户要求“通过 Agent 安装这个项目”“帮我装好然后把猫做成桌宠”时，先执行本阶段。

**版本硬要求**：必须从 main 源码启动，或使用 **v5.2.0+** 安装包。旧 **v5.1.0** 安装包的 MCP 没有 `import_image_cat`，会在导入图片皮肤时报未知工具。若用户已安装旧包，先关闭/卸载旧 KuroCat，再从源码启动或换 v5.2.0+ 安装包。

### 一键流程

在项目根目录执行：

```bash
# 只检查 Node / 项目路径 / MCP 地址，不启动
npm run cat:bootstrap -- --check-only

# 安装缺失依赖、后台启动 tauri:dev、等待 MCP 端口就绪
npm run cat:bootstrap -- --start
```

`bootstrap_kurocat.mjs` 会：

1. 查找 Node.js 18+（本机若默认是 Node 16，会优先使用已安装的 Node 22）
2. 检查项目根目录与 `package.json`
3. 缺失 `node_modules` 时自动执行 `npm install`
4. 后台运行 `npm run tauri:dev`
5. 从 `%APPDATA%\kuro-cat-pet\settings.json` 读取 MCP 端口（默认 `27420`）
6. 等待 MCP 端口就绪并输出 URL

成功输出示例：

```text
project: D:\project\github fork\Desktop-Cat-DIY
node:    v22.22.2  ...
mcp:     http://127.0.0.1:27420/mcp
start:   npm run tauri:dev（日志：...）
MCP 已就绪：http://127.0.0.1:27420/mcp
```

### 如果 `--start` 超时

不要反复重启。按以下顺序排查：

1. 托盘/右键菜单确认已勾选「开启 MCP 扩展」
2. 查看输出中的 `kurocat-tauri-dev.log`
3. 如果端口不是 27420，显式指定：

```bash
npm run cat:bootstrap -- --wait-only --port <实际端口> --timeout 60
```

4. 若宿主已连接 stdio MCP，可跳过 HTTP 检查，但后续脚本仍需要 `--url` 指向正确端口

### 只构建安装包

如果用户想要安装包而不是开发模式：

```bash
npm run cat:bootstrap -- --build
```

产物目录：

```text
src-tauri/target/release/bundle
```

### 手动等价命令

如果 Agent 没有脚本执行能力，按下面顺序手工执行：

```bash
cd <Desktop-Cat-DIY 根目录>
npm install
npm run tauri:dev
```

然后启动 KuroCat，在托盘勾选「开启 MCP 扩展」，确认：

```text
http://127.0.0.1:27420/mcp
```

## 前置条件（阶段 -1 完成后）

- Desktop-Cat-DIY / KuroCat 已运行
- 已在托盘确认「开启 MCP 扩展」
- Agent 能访问 `http://127.0.0.1:27420/mcp`，或宿主已连接项目 MCP
- 用户已上传**至少一张参考图片**；没有时只请求补充，不用文字描述替代
- Agent 能读取该图片；不要询问“实拍还是卡通”，默认尽量还原

---

## 路线 A：参数化卡通还原

### 流程

1. 调用 `get_cat_schema`
2. 分析照片：主色、副色、花纹、眼鼻爪色、最多 8 个斑点
3. 可选：用生图能力生成正脸卡通参考图，只用于提升判断准确度
4. 生成 `CatSkinConfig` JSON，示例见 `examples/my-cat.json`
5. 校验：

```bash
node skills/My-Cat/scripts/validate_cat_skin.mjs cat.json
```

6. 写入并激活：

```bash
node skills/My-Cat/scripts/upsert_cat_from_json.mjs cat.json
```

7. 调 `list_cats` 验证

规则与限制见 `references/schema.md`。

---

## 路线 B：真实图片皮肤

### 输入要求

Agent 需要用自身生图能力生成 PNG，或对用户截图做去背/裁剪后生成 PNG。

每张图片必须：

- **224 × 278 像素**
- **8-bit RGB 或 RGBA PNG**
- 推荐 RGBA 透明背景
- 单张不超过 12 MB
- 只包含猫主体，不要背景、文字、水印、项圈（除非用户明确要）

表情图：

| 文件 | 是否必填 | 说明 |
|---|---|---|
| `idle` | 必填 | 默认形态 |
| `blink` | 可选 | 眨眼 / 眯眼 |
| `shy` | 可选 | 困倦 / 害羞 |
| `happy` | 可选 | 被摸 / 按键开心 |

只有 `idle` 时，其他状态会复用 `idle`。

### 推荐生图提示词

```text
参考这张猫的照片，生成 224x278 像素的透明背景 PNG 桌宠立绘：
正面坐姿，完整身体和头部，保留真实毛色、脸部花纹、眼睛颜色和显著斑点；
卡通但尽量保留照片特征；猫主体居中，边缘干净，适合透明背景；
不要背景、文字、水印、项圈、衣服、阴影底板。
```

如果 Agent 的生图工具不能直接指定尺寸，先生成高清图，再裁剪/缩放到 224x278 并转 RGBA PNG。

### 导入配置

示例：`examples/image-cat.json`

```json
{
  "id": "my-photo-cat",
  "name": "我家猫（照片皮肤）",
  "images": {
    "idle": "C:\\path\\to\\my-cat-idle.png"
  },
  "activate": true
}
```

路径必须是 Agent 本机可访问的绝对路径。`import_image_cat` 会把图片复制到：

```text
<app_data>/cat-images/<cat-id>/
```

### 校验并导入

```bash
node skills/My-Cat/scripts/import_image_cat.mjs image-cat.json
```

脚本会先检查：

- id / name
- `images.idle` 存在
- 文件存在
- PNG 签名、IHDR、尺寸、色深、颜色类型、文件大小

通过后调用 MCP：

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

最后调用 `list_cats` 验证新 id 和激活状态。

### 资源清理

`delete_cat` 会同时删除 `cats.json` 条目和 `<app_data>/cat-images/<id>/` 目录，避免照片残留。

---

## Agent 执行检查清单

- [ ] `npm run cat:bootstrap -- --check-only` 或 `--start` 已完成，KuroCat 与 MCP 可用
- [ ] 调用 `get_cat_schema`
- [ ] 明确路线 A 或 B
- [ ] 路线 A：JSON 校验通过后再 `upsert_cat`
- [ ] 路线 B：PNG 尺寸/格式校验通过后再 `import_image_cat`
- [ ] 图片皮肤只使用 2D
- [ ] `list_cats` 验证新 id 与激活状态
- [ ] 向用户说明还原精度与限制

## 不要做的事

- 不要询问“实拍还是卡通”；不要在用户未提供参考图时用纯文字描述直接生成
- 不要把图片 URL、base64 或用户目录路径写进 `cats.json`
- 不要跳过 PNG 尺寸校验
- 不要在 3D 模式下期待图片皮肤生效
- 不要硬编码 schema，优先 `get_cat_schema`
- 不要用内置 ID 覆盖内置猫
- 不要声称路线 A 能像素级复刻照片
