---
name: TinyPNG 压缩助手
description: macOS 优先的本地图片压缩工具，以原生工具栏、队列工作区和检查器组织高频批处理任务。
version: 2.0.0
tokens:
  color:
    ink: "#1D1D1F"
    canvas: "#F5F5F7"
    panel: "#FFFFFF"
    line: "#D2D2D7"
    calibration-blue: "#0A63C9"
    success: "#26845B"
    danger: "#C13C45"
    muted: "#6E6E73"
  typography:
    sans: "-apple-system, BlinkMacSystemFont, PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif"
    mono: "SF Mono, JetBrains Mono, SFMono-Regular, Menlo, Consolas, monospace"
  radius:
    control: 9px
    panel: 12px
  spacing:
    unit: 4px
  motion:
    compression-duration: 200ms
    easing: ease-out
---

# 设计方向

界面采用 macOS 专业工具语义，而非网页仪表盘。系统原生标题栏和菜单负责应用级操作；内容区域是紧凑工具栏、任务工作区和右侧检查器。表面以系统灰阶、细分隔线和克制的蓝色动作色建立层级，不使用渐变与玻璃叠层。

# 布局

- 系统菜单：导入图片、导入文件夹、开始压缩及标准系统命令。
- 工作区工具栏：产品上下文、当前批次的开始或取消操作。
- 主工作区：导入条、全局压缩进度与虚拟化压缩队列。队列总览始终展示全部任务数、已处理进度和累计压缩率；只渲染可视行，缩略图在可视范围内按需生成。
- 检查器：Auth Link 授予的逻辑额度、有效期、续费入口与输出策略。逻辑额度卡片可打开 TinyPNG 使用情况弹窗，但只展示 Token 序号、当月计数、状态与重置日，永不展示 Token 原文。
- 激活页：单独的设备授权表单；预览失败或超时不能阻止用户继续兑换 Auth Link。

# 排版

中文正文使用系统无衬线字体，以符合 macOS 和 Windows 的本地文本渲染；文件大小、数量和路径使用等宽字体。

# 颜色与质感

`Ink` 用于内容，`Muted` 用于辅助说明，`Calibration Blue` 仅用于主要动作、焦点和进行中状态。状态颜色永远同时配合图标或文本，不能仅靠颜色传达含义。

# 性能与队列

队列采用固定行高虚拟列表，避免大批图片导入时创建全部行节点。来自 Rust 的进度事件只替换对应任务记录，并通过非紧急更新进入渲染器。缩略图最多两路后台生成，压缩开始后让位于网络和磁盘传输。TinyPNG 使用情况查询只在 Rust 侧以四路并发执行，并与压缩任务互斥。

# 交互与动效

导出只提供“新文件夹”和“覆盖原文件”两种模式；覆盖模式必须二次确认，并在每个来源文件夹写入隐藏的 `.smartcompress.json` SHA-256 记录以跳过重复压缩。完成后，原始大小与压缩后大小的双刻度条以 200ms 收缩动画显示结果；启用 reduced motion 时取消该动画。

# 可访问性

所有按钮、单选项、队列行和错误恢复操作均可通过键盘聚焦，最小窗口为 `960 × 640`。
