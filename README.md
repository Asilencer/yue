<p align="center">
  <img src="src/assets/brand/yue-logo.svg" width="112" alt="阅品牌字形">
</p>

<h1 align="center">阅</h1>

<p align="center">从书页，看向生活。</p>

<p align="center">
  <a href="https://github.com/Asilencer/yue/releases/latest">
    <img
      src="https://img.shields.io/github/v/release/Asilencer/yue?display_name=tag&style=flat-square&color=697a66"
      alt="最新版本">
  </a>
  <img
    src="https://img.shields.io/badge/macOS-Apple%20Silicon-111111?style=flat-square&logo=apple"
    alt="macOS Apple Silicon">
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-cd7654?style=flat-square" alt="MIT License">
  </a>
</p>

<p align="center">
  一款明亮、安静、本地优先的 macOS EPUB 阅读器。<br>
  阅读不必躲开生活；窗外的光、书架上的书与正在读的文字，可以留在同一个空间里。
</p>

<p align="center">
  <a href="https://github.com/Asilencer/yue/releases/latest"><strong>下载最新版本</strong></a>
  ·
  <a href="https://asilencer.github.io/works.html#yue">查看作品介绍</a>
</p>

![阅的开始页](docs/images/landing.png)

## 设计取向

“阅”不是把人从现实中抽离的深色书房，而是一扇仍然望得见生活的窗。

- **轻盈的进入方式**：四种明亮景观会随横竖窗口选择更合适的画面，
  开书动效只负责连接书架与正文。
- **真正可读的正文**：打开书后进入全屏单列连续阅读，
  内容不会被限制在装饰性的书本模型里。
- **安静但不失去方向**：缩略进度条、章节目录和 Pin 在需要时提供定位，
  不持续打断阅读。
- **书和进度留在本机**：无需账号，也没有云端同步；
  导入内容与阅读数据只保存在当前 Mac。

## 已有能力

- 文件选择与拖放导入未加密、可重排 EPUB
- 卡片式书架、书名与作者搜索、在读/已读分类和本地图书移除
- 标题、作者、列表、引用、代码、表格、显式换行与常见数学公式排版
- 全屏连续阅读、章节目录、逻辑文字进度、阅读位置 Pin 和自动续读
- 本地字体、12–32 px 字号、行距、字体颜色与纸张颜色设置
- 四种可切换首页背景，以及适配横向与纵向窗口的高清场景图
- 可关闭的轻量翻页声效与 macOS 原生菜单
- 跟随系统“减少动态效果”和“减少透明度”辅助功能设置

## 安装

当前发布包面向 **Apple Silicon（arm64）Mac**。

1. 前往 [Releases](https://github.com/Asilencer/yue/releases/latest) 下载最新 ZIP。
2. 解压后，将 `阅.app` 拖入“应用程序”。
3. 首次启动时右键点击应用并选择“打开”。当前公开构建尚未经过 Apple 公证，
   macOS 可能会显示来源提示。

## EPUB 支持边界

- 支持扩展名为 `.epub` 的未加密、可重排 EPUB。
- 明确拒绝 DRM、加密正文和固定版式 EPUB；`linear="no"` 资源不进入主阅读流。
- 忽略目录中的外部、片段和失效链接，不因辅助导航链接中止整本书导入。
- EPUB 文件上限为 128 MB，ZIP 条目数上限为 10,000；超大条目和异常压缩比会被拒绝。
- 暂不支持 PDF、Markdown、TXT、跨设备同步和书籍元数据编辑。

## 本地数据

- 图书元数据和正文分别保存在 IndexedDB。
- 阅读显示、进度、Pin、已读状态和最近阅读记录保存在 localStorage。
- 删除图书时同步清理其正文、进度、Pin、已读状态和最近阅读引用。
- 阅读位置使用文字锚点保存，字体或窗口重排后仍能尽量回到原文位置。

## 快捷键

| 快捷键 | 操作 |
| --- | --- |
| `⌘O` | 导入 EPUB |
| `⌘K` | 搜索书架 |
| `⌘D` | 添加或移除当前位置 Pin |
| `⌘,` | 打开阅读显示设置 |
| `⌘+` / `⌘-` | 调整字号 |
| `⌘0` | 恢复默认字号 |
| `Esc` | 关闭面板或返回书架 |

## 本地开发

需要 Node.js `^20.19.0 || >=22.12.0`。

```bash
npm install
npm start
```

生成当前架构的 macOS 应用与 ZIP：

```bash
npm run make
```

技术栈：Electron、TypeScript、Vite、IndexedDB、Unified、KaTeX、highlight.js。

## License

[MIT](LICENSE) © 2026 Asilencer
