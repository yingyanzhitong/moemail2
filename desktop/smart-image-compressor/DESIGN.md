---
name: 智能压缩工具
description: 面向批量图片压缩的影像校准工作台，强调精密、可信与可恢复。
version: 1.0.0
tokens:
  color:
    ink: "#172033"
    canvas: "#F3F6FA"
    panel: "#FFFFFF"
    line: "#D6DDE8"
    calibration-blue: "#2956D8"
    success: "#15806A"
    danger: "#C53D47"
    muted: "#667085"
  typography:
    sans: "Source Han Sans SC, Noto Sans CJK SC, PingFang SC, Microsoft YaHei, sans-serif"
    mono: "JetBrains Mono, SFMono-Regular, Consolas, monospace"
  radius:
    control: 8px
    panel: 12px
  spacing:
    unit: 4px
  motion:
    compression-duration: 220ms
    easing: cubic-bezier(0.22, 1, 0.36, 1)
---

# 设计方向

界面采用“影像校准工作台”语义：浅色画布、清晰分隔线、接触印样式队列和克制的蓝色校准标记。它应像专业摄影工具，而不是营销型 SaaS 仪表盘。

# 布局

单窗口最小尺寸为 `960 × 640`。左侧为文件入口和任务队列，右侧固定展示授权周期、逻辑额度和输出规则。系统原生标题栏保留；主要内容使用 24px 外边距与 12px 面板圆角。

# 排版

中文正文优先使用思源黑体系统回退。路径、尺寸与压缩比例使用 JetBrains Mono。标题不使用超大字号，信息层级依靠字重、间距和细线建立。

# 颜色与质感

禁止渐变和大面积发光效果。阴影仅用于弹窗与悬浮状态，面板默认依靠 `Line` 描边分隔。Calibration Blue 只用于主要动作、焦点和进度；成功与错误颜色必须同时配合文字或图标。

# 交互与动效

代表性交互是图片条目的“原始大小 → 压缩大小”双刻度条，完成时执行一次 220ms 收缩动画。其他状态变化保持即时。系统开启 `prefers-reduced-motion` 时禁用所有非必要动画。

# 可访问性

所有操作支持键盘导航，并提供明显的 `:focus-visible` 外环。按钮禁用时同时给出原因；错误信息说明恢复动作。正文与背景保持 WCAG AA 对比度。v1 仅提供浅色模式与简体中文。
