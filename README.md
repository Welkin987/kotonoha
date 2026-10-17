# ことのは · 标日听读

在线访问：[https://welkin987.github.io/kotonoha/](https://welkin987.github.io/kotonoha/)

标准日本语初级上册词汇听读工具，包含 24 课、1,079 个词条和完整的 `ja-JP-NanamiNeural` MP3 音频。

网页支持单词点读、整课连读、从指定词开始、暂停继续，以及按需查看中文释义。音频按课号和单词 ID 保存，首次播放后可由 Service Worker 缓存离线使用。

## GitHub Pages 部署

仓库根目录已经是可发布的静态网站，不需要 Node.js、构建命令或后端服务：

1. 打开仓库的 **Settings → Pages**。
2. 在 **Build and deployment** 中选择 **Deploy from a branch**。
3. Branch 选择 `main`，目录选择 `/ (root)`，点击 **Save**。
4. 等待 Pages 部署完成，访问设置页显示的站点地址。

`.nojekyll` 文件用于让 GitHub Pages 直接提供音频和其他静态资源。网页使用相对路径，支持 `/kotonoha/` 这样的项目站点路径；请保持 `index.html`、`audio/`、`app.js` 等文件位于仓库根目录。

## 使用方法

- 点击课程查看全部词条；每词独立一行，长文本自动换行，中文释义默认隐藏。
- 点击日语单词：单独朗读一次。
- 点击「从头播放」：朗读整课；点击「从此播放」：从该词读到课末。
- 支持暂停、继续、停止；默认朗读速度为 1 倍，词间停顿为 0.3 秒，可调整速度、重复次数、词间停顿和自动滚动。
- 点击「释义」弹出中文；长释义自动换行。
- 首页「继续」定位到上次播放的词，播放位置和设置保存在当前浏览器。

## 音频与词表

音频路径为 `audio/ja-JP-NanamiNeural/{两位课号}/{单词ID}.mp3`，例如 `01-001` 对应 `audio/ja-JP-NanamiNeural/01/01-001.mp3`。

`audio/ja-JP-NanamiNeural/manifest.json` 记录音频 ID、路径和大小；`vocab-data.js` 是网页使用的词表，`vocabulary.json` 保存同一词表的 JSON 版本。全部音频已生成，网页直接播放 MP3。

## 安装与离线使用

通过 HTTPS 打开网站，在支持的浏览器中点击首页「安装」，或使用浏览器的「安装应用 / 添加到主屏幕」。iPhone/iPad 可使用 Safari 分享菜单中的「添加到主屏幕」。

Service Worker 就绪后会缓存页面、词表和图标；音频在播放时按需缓存，已缓存的词可离线播放，未缓存的词仍需联网。浏览器清理网站数据或空间不足时可能删除缓存。

移动系统在锁屏或后台可能限制连续播放，建议保持网页在前台。屏幕常亮功能取决于浏览器支持。

## 更新网站

1. 修改文件；词表变动时同步更新 `vocab-data.js` 和 `vocabulary.json`，音频变动时保持 ID、路径与清单一致。
2. 页面、词表或音频发生变化时，将 `service-worker.js` 首行缓存版本递增，例如 `kotonoha-v1.0.0` 改为 `kotonoha-v1.0.1`。新版本激活后会清理旧缓存。
3. 提交并推送到 `main`，等待 GitHub Pages 自动完成新部署，然后刷新网站检查。

## 本地预览

在仓库根目录运行：

```powershell
python -m http.server 8080
```

打开 `http://127.0.0.1:8080/`。本地 localhost 可调试 Service Worker；部署后使用 HTTPS。
