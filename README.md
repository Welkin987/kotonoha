# ことのは · 标日听读

标准日本语初级上册词汇听读工具，包含 24 课、1,079 个词条和完整的 `ja-JP-NanamiNeural` MP3 音频。

网页支持单词点读、整课连读、从指定词开始、暂停继续，以及按需查看中文释义。音频按课号和单词 ID 保存，首次播放后可由 Service Worker 缓存离线使用。

## GitHub Pages

仓库根目录已经是可发布的静态网站，不需要 Node.js、构建命令或后端服务：

1. 打开仓库的 **Settings → Pages**。
2. 在 **Build and deployment** 中选择 **Deploy from a branch**。
3. Branch 选择 `main`，目录选择 `/ (root)`，点击 **Save**。
4. 等待 GitHub Actions 的 Pages 部署完成，访问页面顶部显示的站点地址。

`.nojekyll` 文件用于让 GitHub Pages 直接提供音频和其他静态资源；请保持 `index.html`、`audio/`、`app.js` 等文件位于仓库根目录。

详细的 EdgeOne、域名和本地预览说明见 [README_部署说明.md](README_部署说明.md)。
