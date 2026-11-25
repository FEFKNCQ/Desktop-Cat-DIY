# AGENTS.md — Desktop-Cat-DIY

给所有 Agent 的简短执行约定。用户无需了解项目细节，只要上传猫咪照片/卡通图，并要求“做成 Desktop-Cat-DIY / KuroCat 桌宠”时，按本文件执行。

## 必读 Skill

本仓库内置 My-Cat skill：

```text
skills/My-Cat/SKILL.md
```

如果 Agent 不在仓库目录中，先从 GitHub 获取：

```text
https://github.com/FEFKNCQ/Desktop-Cat-DIY
```

读取 `skills/My-Cat/SKILL.md` 后再行动。不要凭记忆自行发明配置格式，优先调用项目 MCP 的 `get_cat_schema`。

## 用户一句话指令示例

用户可能会说：

```text
用 GitHub 上 FEFKNCQ/Desktop-Cat-DIY 的 My-Cat skill，把我上传的这张图做成专属桌宠，直接安装启动、导入切换。
```

或在仓库目录中：

```text
用 My-Cat skill，把这张图做成我的桌宠，直接安装启动、导入切换。
```

这两种都视为明确触发 My-Cat skill。

## 标准流程

1. 读取 `skills/My-Cat/SKILL.md`
2. 安装/启动：
   ```bash
   npm run cat:bootstrap -- --check-only
   npm run cat:bootstrap -- --start
   ```
3. 如果 MCP 端口未就绪，提示用户在托盘勾选「开启 MCP 扩展」，不要反复重启
4. 分析用户图片：
   - 用户说“尽量像 / 一模一样 / 用生成的图” → 图片皮肤路线
   - 用户说“卡通一点 / 捏一只 / 快一点” → 参数化路线
5. 图片皮肤路线：
   - 生成或处理为 **224×278、8-bit RGB/RGBA PNG、透明背景**
   - 至少生成 `idle`，可选 `blink` / `shy` / `happy`
   - 写 `image-cat.json`
   - `npm run cat:import-image -- image-cat.json`
6. 参数化路线：
   - 生成 `CatSkinConfig` JSON
   - `npm run cat:validate -- cat.json`
   - `npm run cat:upsert -- cat.json`
7. 调用 MCP `list_cats` 验证新 ID 与激活状态
8. 向用户报告：桌宠名称、ID、使用路线、是否切换成功

## 约束

- Agent 必须能操作本机并访问本地文件，否则只能给出命令，不能声称已安装/切换
- 不要修改与本任务无关的仓库
- 不要把图片 URL、base64 或临时路径写进 `cats.json`
- 图片皮肤只走 2D 渲染
- 删除猫时走项目已有 `delete_cat` 流程，会同步清理图片目录
- 涉及把用户照片上传到外部生图服务时，先获得用户同意
