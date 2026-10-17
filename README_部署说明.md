# ことのは · 标日听读

可直接上传到腾讯云 EdgeOne Pages 的静态网站：24 课、1,079 个词条及完整的日语女声音频。无需安装依赖、运行构建命令、配置 API Key 或购买云服务器。

## 使用方法

- 点击课程，查看本课所有词条；一词一行，中文释义默认隐藏。
- 点击日语单词：单独朗读一次。
- 点击「从头播放」：朗读整课；点击某词右侧「▶ 从此」：从该词读到本课结束。
- 连读时可暂停、继续、停止；「播放设置」可调整速度、重复次数、词间停顿和自动滚动。
- 点击「释义」：弹出中文释义，不改变词条高度。长释义保持一行，可横向滚动查看。
- 上次播放位置和设置保存在当前浏览器；首页「继续」定位到上次的词，点击后即可朗读。

## 文件与音频命名

```text
kotonoha/
  index.html                   # 网站入口
  app.js                       # 播放与交互
  styles.css
  vocab-data.js                # 网页使用的词表
  vocabulary.json              # 同一词表的 JSON 版本
  manifest.webmanifest         # 安装到桌面的元信息
  service-worker.js            # 页面与已播放音频的离线缓存
  icons/
    icon.svg                   # 原创耳机少女 SVG 图标
    icon-192.png
    icon-512.png
    apple-touch-icon.png
  audio/
    ja-JP-NanamiNeural/
      manifest.json            # ID、词条、文件路径和大小清单
      01/
        01-001.mp3
        ...
      ...
      24/
        24-031.mp3
  README_部署说明.md
```

音频路径固定为 `audio/ja-JP-NanamiNeural/{两位课号}/{单词ID}.mp3`。例如 `01-001` 对应 `audio/ja-JP-NanamiNeural/01/01-001.mp3`。音频已生成并随项目分发，网页不会实时调用 TTS 服务。项目不包含生成音频或测试用的临时脚本。

## GitHub Pages 静态托管

本仓库根目录已经可以直接作为 GitHub Pages 的发布目录。提交并推送后，在 GitHub 仓库中打开 **Settings → Pages**，选择 **Deploy from a branch**，Branch 选择 `main`，目录选择 `/ (root)`，点击 **Save**。GitHub 会自动生成 Pages 部署任务；完成后访问页面顶部显示的站点地址。

仓库根目录的 `.nojekyll` 会让 GitHub Pages 直接提供音频、图标和其他静态文件。网页内使用相对路径，因此仓库名是 `kotonoha` 时，`https://用户名.github.io/kotonoha/` 这样的项目站点路径也能正常加载。首次打开使用 HTTPS，Service Worker 和 PWA 安装功能才会生效。

GitHub Pages 是公开静态托管：词表、中文释义和 MP3 都会随仓库公开。若以后不希望公开这些内容，不要使用公开仓库 Pages。

## EdgeOne Pages 直接上传

1. 打开 [腾讯云 EdgeOne Pages 控制台](https://console.cloud.tencent.com/edgeone/pages)，登录腾讯云账号。部分新版界面或国际站文档会显示 **Makers** 名称。
2. 选择 **创建项目 → 直接上传 / Direct Upload**。不要选择需要构建的框架模板。
3. 项目名填写 `kotonoha`（如已占用可加自己的后缀），然后选择加速区域。只做初次体验且暂无备案域名，可选择不含中国大陆的区域；主要在大陆长期使用并已有备案域名时，选择包含大陆的区域并绑定该域名。
4. 上传当前仓库根目录中已经打包好的 **kotonoha-edgeone.zip**。也可以直接上传 `kotonoha` 文件夹。ZIP 解压后的第一层必须直接是 `index.html`、`audio/` 等，不能多套一层 `kotonoha/`。
5. 点击 **开始部署 / Start Deployment**。此方式直接托管已有文件，不执行 `npm install` 或 `npm run build`，不需要填写构建命令、环境变量或后端配置。
6. 部署完成后，打开控制台给出的预览链接。进入第 1 课，点一个单词，再测试「从头播放」和「从此」。手机也打开同一 HTTPS 地址测试。

本项目总大小约 11 MB，约 1,100 个文件。已核对官方文档：直接上传上限为 20,000 个文件、单文件 25 MB，本项目在范围内。文件多时官方建议使用 ZIP。

### 绑定自己的域名

1. 打开项目的 **域名管理 / Domain Management → 添加自定义域名 / Add custom domain**，填入例如 `words.example.com`。
2. 按弹窗指引，在域名 DNS 服务商处添加所有权验证记录。
3. 添加控制台给出的 CNAME 记录。例如主机记录 `words`、类型 `CNAME`，记录值使用控制台实际显示的目标，不要直接抄预览网址。
4. 等待校验通过，在 HTTPS 配置里按控制台指引申请或选择证书，直到 HTTPS 状态可用，再访问自己的域名。

选择「中国大陆」或「全球（含中国大陆）」加速区域时，自定义域名需先完成 ICP 备案；这是 EdgeOne 官方自定义域名文档的区域要求。若暂时使用平台提供的测试地址，其使用范围和有效期以控制台显示为准。

### 安装到手机 / 平板桌面

用 HTTPS 访问部署后的网页。支持安装的浏览器会在首页显示「安装」按钮，也可从浏览器菜单选择「安装应用 / 添加到主屏幕」；iPhone/iPad 可用 Safari 的分享菜单「添加到主屏幕」。

## 离线行为

Service Worker 就绪后会缓存页面、词表和图标；单词音频在播放时按需缓存，不会首次打开就下载全部 1,079 个文件。已缓存的音频可离线播放；未听过的词仍需联网。浏览器可能因空间不足或清理网站数据而删除缓存，不能将浏览器缓存当作永久下载。播放 MP3 支持字节范围请求。

连续播放建议保持网页在前台。屏幕常亮功能取决于浏览器支持；移动系统在锁屏或后台可能限制连续播放。

## 以后更新网站

1. 修改 `kotonoha` 内的文件。若修改词表，需同步更新 `vocab-data.js` 和 `vocabulary.json`；替换音频时保持 ID 路径与 `audio/.../manifest.json` 一致。
2. 每次修改页面、词表或音频，都将 `service-worker.js` 首行缓存版本从 `kotonoha-v1.0.0` 改为新版本，例如 `kotonoha-v1.0.1`。新 Service Worker 激活后会清理旧版缓存，旧音频需重新联网缓存。
3. 在仓库根目录重新打包（PowerShell）：

   ```powershell
   Compress-Archive -Path .\kotonoha\* -DestinationPath .\kotonoha-edgeone.zip -Force
   ```

4. 进入 EdgeOne 项目的 **构建与部署 / Build & Deploy → 新建部署 / New Deployment**，选择 **Production / 生产环境**，上传新 ZIP 并部署。若先选择 Preview，则仅生成预览版本，不更新正式网站。
5. 等部署成功，刷新页面检查版本。若浏览器仍显示旧内容，关闭旧标签后重新进入；排查时也可清除此站点的网站数据后刷新。

## 本地预览（可选，不属于部署步骤）

在 `kotonoha` 目录打开终端，已有 Python 时执行：

```powershell
python -m http.server 8080
```

浏览器打开 `http://127.0.0.1:8080/`。不要只双击 HTML 来验证离线缓存或安装功能；本地 localhost 可调试 Service Worker，部署后使用 HTTPS。

## 官方参考

以下页面于 2026-10-17 核对：

- [EdgeOne 官方：Direct Upload](https://pages.edgeone.ai/document/direct-upload)
- [EdgeOne 官方：Custom Domain](https://pages.edgeone.ai/document/custom-domain)
