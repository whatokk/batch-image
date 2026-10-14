# 批量出图 · 网页版

把 [batch-image-universal](https://github.com/whatokk/batch-image-universal) 的命令行批量出图工具，改造成**纯前端、零后端、公开可访问**的网页版。

## 特性

- 🎨 文生图 / 图生图（单张或多张参考图）
- 🔀 多通道自适应降级（自动适配不同中转站的参数兼容性）
- 🛡️ 图片完整性校验（二进制魔数，避免损坏图静默展示）
- 📦 打包下载全部结果（ZIP）
- 🔒 **API Key 仅存浏览器本地**，不上传任何服务器，安全无后端
- ⚡ 并发控制、失败重试、进度显示

## 使用方式

1. 打开网页
2. 填写接口地址（任意 OpenAI 兼容接口，如 `https://api.example.com/v1`）和 API Key
3. 输入提示词（一行一条）
4. 可选上传参考图做图生图
5. 点「开始生成」

配置会自动保存到浏览器 localStorage，下次打开不用重填。

## 本地预览

纯静态站，直接双击 `index.html` 即可，或起个本地服务：

```bash
python -m http.server 8000
# 然后访问 http://localhost:8000
```

## 部署到 GitHub Pages（免费）

1. 新建一个 GitHub 仓库，把本目录内容推上去
2. 仓库 Settings → Pages → Source 选 `main` 分支 + 根目录 `/`
3. 保存后获得 `https://<用户名>.github.io/<仓库名>/` 的公开网址

### 方式一：手动推送

```bash
git init
git add .
git commit -m "batch image web"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

### 方式二：GitHub Actions 自动部署

把 `.github/workflows/deploy.yml` 一并提交，每次 push 自动发布到 Pages。

## 与 CLI 版的区别

| 能力 | CLI (`batch.mjs`) | 网页版 |
|---|---|---|
| 纯文生图 | ✅ | ✅ |
| 图生图（多参考图） | ✅ | ✅ |
| 遮罩局部重绘 | ✅ | ❌（网页版暂未实现遮罩） |
| 断点续传 | ✅ | ❌（浏览器无持久输出目录） |
| 批量规模 | 数百张无限制 | 小批量（建议 ≤20 条） |
| API Key | 服务端/环境变量 | 浏览器本地 |

## 安全说明

- API Key 用 `localStorage` 存储，**只存在你自己的浏览器**，不会发送到本项目的任何服务器
- 请求直接由浏览器发往你填写的接口地址，不经过任何中间服务器
- 不要把含真实 key 的页面截图或分享给他人

## 许可

沿用上游项目 [batch-image-universal](https://github.com/whatokk/batch-image-universal) 的许可。
