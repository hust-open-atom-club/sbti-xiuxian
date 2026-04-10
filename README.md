# 灵根测试（凡人修仙传）

16 题测出你在修仙界的资质品阶。数据完全本地计算，不回传。

**华科开放原子开源俱乐部 出品**

## 在线体验

https://hust-open-atom-club.github.io/sbit-xiuxian/

## 本地运行

```bash
# 本项目是纯静态站点，无需安装任何依赖
# 直接用 Python 内置服务器启动即可
python3 -m http.server

# 然后在浏览器打开 http://localhost:8000
```

**注意**：直接双击 `index.html` 打开（`file://` 协议）会因浏览器 CORS 限制导致加载失败，页面会显示错误提示。请务必通过 HTTP server 访问。

## 修改题库 / 结果字典

题库和结果字典以 Markdown 格式存储在 `data/` 目录下，非技术贡献者可以直接编辑：

- **`data/questions.md`** — 16 道题目（签文体）
  - 每题由 `## Q<序号>` 开头
  - 题干用 `>` 引用块
  - 选项以 `- 标签 · \`维度表达式\` 选项文本` 格式书写
  - 维度白名单：`金 木 水 火 土 躺平 emo 社牛`
  - 详细 DSL 规范见 `docs/superpowers/specs/2026-04-10-lingen-test-design.md` §4.1

- **`data/results.md`** — 25 条灵根结果
  - 每条由 `## 灵根名` 开头，下接元数据（key/品阶/属性/前缀/结果代码）
  - 子段 `### 签文` / `### 推荐功法` / `### 画像`
  - 画像配饰白名单：sword staff gourd sword-water cauldron seal fan banner broken-sword pillow wine-gourd wooden-fish nothing
  - 画像背景白名单：waves mist-waves grass flames rocks lightning ice-flowers wind dark-clouds void quilt night-rain crowd blank
  - 详细 DSL 规范见 spec §4.2

修改后通过 `test.html` 运行 Content Lint 检查是否有格式错误：

```bash
python3 -m http.server
# 打开 http://localhost:8000/test.html 查看测试结果
```

## 技术栈

- 纯 HTML / CSS / JavaScript，零依赖
- 签文体视觉风格（米黄宣纸 + 楷体 + 朱砂印章）
- 手写 Markdown DSL 解析器（不依赖 marked.js）
- 程序化 SVG 道士立像渲染（不依赖外部图片）
- Mobile-first 响应式布局（断点 768px / 1200px）

## QA 清单

发布前逐项验证：

- [x] Chrome DevTools 模拟 iPhone SE (375px)：题目页三个选项单列堆叠，无溢出 — 用户经 https://hust-open-atom-club.github.io/sbit-xiuxian/ 验证通过
- [x] Chrome DevTools 模拟 iPad (768px)：结果页签文和五行条双列布局生效 — 用户验证通过
- [x] 桌面 1280px：内容居中、鼠标 hover 反馈存在、不粘住 — 用户验证通过
- [x] 键盘测试：`1`/`2`/`3` 选择选项、`Enter` 确认、`←` 不触发回退 — 用户验证通过
- [ ] 故意损坏 `data/questions.md`（删除一个反引号）→ 错误页显示可读的错误信息且指出具体题号
- [ ] 直接双击 `index.html` 打开（file://）→ 错误页提示起 http server
- [x] `python3 -m http.server` 启动后，完整走一遍测试 → 结果页正常 — 用户验证通过
- [x] 结果页"结果代码"点击后剪贴板复制生效 — 用户验证通过
- [ ] Linux 下无 KaiTi 字体时，页面退化为 serif，布局不崩
- [x] 每个品阶（天/变异/真/伪/隐）至少有一组 fixture 答卷可以产出预期结果（通过 test.html 验证） — fixture 答卷已设计并在 test.html 中自动化
- [x] 打开 `test.html` → 所有 ✓ 通过，无 ✗ 失败 — 用户经部署站点验证通过

## 许可证

MIT

## 署名

华科开放原子开源俱乐部 · HUST Open Atom Open-Source Club
