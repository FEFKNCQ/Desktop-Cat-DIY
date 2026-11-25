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

## 标准触发语（用户只需要说这一句）

```text
用 GitHub 上作者 FEFKNCQ 的Desktop-Cat-DIY 部署到本机，用 My-Cat skill 把我上传的图做成我的专属桌宠，直接帮我导入并切换
```

这句视为明确触发 My-Cat skill，Agent 必须执行完整流程：部署/启动 Desktop-Cat-DIY → 使用 My-Cat skill → 导入 → 切换 → 验证。

要求：

- 用户必须提供**至少一张参考图片**（照片、截图、卡通图均可）
- **不要询问用户图片是实拍还是卡通**，也不要因此停下
- 默认按“尽量还原参考图”执行，优先图片皮肤路线

## 标准流程

1. 读取 `skills/My-Cat/SKILL.md`
2. 安装/启动：
   ```bash
   npm run cat:bootstrap -- --check-only
   npm run cat:bootstrap -- --start
   ```
3. 如果 MCP 端口未就绪，提示用户在托盘勾选「开启 MCP 扩展」，不要反复重启
4. 检查参考图片：
   - 没有图片：请用户至少上传一张，不继续安装/导入
   - 有至少一张：不要追问“实拍还是卡通”，默认尽量还原参考图
   - 优先图片皮肤路线；只有用户明确要求参数化/卡通时才走路线 A
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

- 参考图片至少一张；不足时只请求补充图片，不要询问“实拍还是卡通”
- 默认按“尽量还原参考图”处理，不因为图片风格是实拍或卡通而改变流程
- Agent 必须能操作本机并访问本地文件，否则只能给出命令，不能声称已安装/切换
- 不要修改与本任务无关的仓库
- 不要把图片 URL、base64 或临时路径写进 `cats.json`
- 图片皮肤只走 2D 渲染
- 删除猫时走项目已有 `delete_cat` 流程，会同步清理图片目录
- 涉及把用户照片上传到外部生图服务时，先获得用户同意
