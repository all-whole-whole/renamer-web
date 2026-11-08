# web/ui — 内联的组件基座

`web/src` 里的界面不是从零写的：按钮、输入框、对话框、Toast、卡片这些零件来自工作区
共用的前端套件（`@ui`）。为了让这个仓库单独 clone 下来就能构建，套件中**被用到的子集**
直接内联在这里，构建时 `@ui` 别名指向本目录。

## 内容

| 目录 | 来源 | 说明 |
|---|---|---|
| `components/` | 共用套件 `src/components` | Button / Field / Controls / Dialog / Badge / Card / Toast / Loading 等，含各自 CSS |
| `lib/` | 共用套件 `src/lib` | `cx`（className 合并）、`focus`（对话框焦点陷阱） |
| `styles/` | 共用套件 `src/styles` | `tokens.css`（设计令牌）、`base.css`（基础排版与重置） |

未内联：`pages/`、`shell/`、`App.tsx`、`main.tsx` —— 那是套件自己的文档站外壳，本工具用不到。

## 为什么内联

- 运行时依旧零依赖：产物在 `public/`，宿主只跑 Node。
- 构建可复现：`npm ci && npm run web:build`，不需要仓库外的任何目录。
- 代价：这是一份快照，不会自动跟随上游套件更新。

## 同步方式

在共用套件里改完组件后，整目录覆盖回来即可（不要手工改这里的文件，否则下次同步会丢）：

```powershell
Copy-Item -Recurse -Force <工作区>\ui\src\components web\ui\components
Copy-Item -Recurse -Force <工作区>\ui\src\lib        web\ui\lib
Copy-Item -Recurse -Force <工作区>\ui\src\styles     web\ui\styles
npm run web:check   # 类型校验；通过后再 npm run web:build 更新 public/
```

组件里只有 `../lib/cx` 与 `../lib/focus` 两处跨目录引用，`styles/` 无 `@import`、无外部字体，
因此这三块可以独立搬动。
