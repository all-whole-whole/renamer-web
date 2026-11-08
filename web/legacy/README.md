# 旧前端（原生 ES 模块，回滚用）

React 改造前的实现：`index.html` + `app.js`（约 1700 行，零依赖 ES 模块）+ `styles.css`。
不参与构建、不会被宿主服务，只作为回滚副本。

## 回滚

```powershell
cd E:\.test\renamer-web
Remove-Item -Recurse -Force public\assets -ErrorAction SilentlyContinue
Copy-Item web\legacy\index.html public\index.html -Force
Copy-Item web\legacy\app.js public\app.js -Force
Copy-Item web\legacy\styles.css public\styles.css -Force
```

`public/diff.mjs` 不用动（测试和旧版都 import 它；React 版构建时从 `web/public/` 复制）。
再次前移：

```powershell
npm run web:build
```

## 为什么保留

- 旧版是 `/api/*` 契约的参考实现：规则栈的扁平结构（`{type, enabled, ...config}`）、
  transient 草稿预览、draftPreview 阻止直接 rename、undo 的批次映射，这些边界都在它里面；
- 规则编辑器有 18 种类型的动态字段，React 版按 `/api/rule-types` 元数据渲染；
  遇到元数据没覆盖的极端组合，可以拿旧版对照；
- 回滚不需要重建任何东西：三个文件拷回去即可，宿主与测试完全不感知前端实现。
