# Book-First Mainline — 验收清单与 B3 进入条件

> 时间：2026-04-14
> 状态：B1/B2/B5 已实施，待真实样本验证

---

## 验收清单

在 2-3 个真实仓库上跑 generate 后，检查以下项：

### 目录结构语义

- [ ] `wiki.json` 每页稳定带 `kind` 字段（guide/explanation/reference/appendix）
- [ ] `wiki.json` 每页带 `readerGoal` 字段且非空
- [ ] 前 5 页里至少有 1 个 `guide`
- [ ] `reference` / `appendix` 落在 reading_order 后半段
- [ ] `prerequisites` 只引用已存在的前序 slug

### 页面写作质量

- [ ] `guide` 页明显偏导览/入门风格，少代码多认知地图
- [ ] `reference` 页明显偏高密度查阅，多表格少叙事
- [ ] `appendix` 页明显偏长尾/补充，不承担正文导读
- [ ] `explanation` 页保持当前深度，讲机制讲权衡

### 发布产物

- [ ] `version.json` 的 `pages[]` 包含 `section/group/level/kind`
- [ ] `page.meta.json` 包含完整书结构字段
- [ ] Web 版本页按 section/group 分组显示，不再是平铺列表
- [ ] Web 页面阅读器显示当前 section、kind badge、level

### 向下兼容

- [ ] 旧版本产物（无 kind/section）仍能正常浏览
- [ ] Web 目录页对旧产物回退为平铺列表

---

## B3 Editorial Pass 进入条件

**只有在以下条件全部成立时，才启动 B3 Editorial Pass：**

1. B1/B2/B5 已在 3+ 个真实仓库上验证
2. 验收清单中仍有 **明显不达标** 的结构性问题
3. 这些问题 **无法通过调整 catalog prompt 或 drafter prompt 解决**

**不进入 B3 的情况：**

- 仅个别页面 kind 标注不精确 → 调 prompt
- 个别 appendix 出现偏前 → 调 prompt 结构约束权重
- 页面碎片化但不严重 → 调 catalog 页面合并策略

**进入 B3 的信号：**

- 多个仓库稳定出现"主阅读流中夹杂大量 reference/appendix"
- 多个仓库稳定出现"相邻页高重复度"
- catalog 的结构约束已调到极限但仍不够

一句话：**B3 是最后手段，不是默认下一步。**
