# Medieval Juice Crafter Planner

《Medieval Juice Crafter》繁體中文攻略／販售規劃工具。

目前先解決遊玩途中最常用的查詢：

- 依階段與顧客滿意度顯示目前可用資料。
- 已記錄階段三／四的東港村滿意度、正式顧客數與隔日回信解鎖條件。
- 搜尋顧客、職業、喜好、配方、原料與特性。
- 顧客只把「全部喜好都滿足」視為完全匹配。
- 顧客列表可依姓名、最佳完全匹配、最高售價排序。
- 配方列表可反查能完全滿足的顧客，顧客顯示為 `名字(職業)`。
- 三原料配方保留調味順序；四原料以上的重複調味實測不進一般配方列表。

## 資料邊界

```text
src/
  data/
    customers.ts       # 顧客、喜好、滿意度門檻、作息觀察
    ingredients.ts     # 原料價格與原料特性數值
    equipment.ts       # 設備與已知解鎖資訊
    recipes.ts         # 一般網站顯示的已確認配方（目前最多三原料）
    recipeResearch.ts  # 四原料以上的機制研究實測，不進一般列表
    stages.ts          # 階段摘要
  domain/
    matching.ts        # 完全／部分匹配判定
    matching.test.ts
  App.tsx              # 目前 MVP UI
  styles.css
```

未確認的遊戲機制不會直接寫成正式配方或最佳化公式。

## 開發

```bash
npm install
npm run dev
```

驗證：

```bash
npm test
npm run build
```

## 部署

GitHub Pages 由 `.github/workflows/pages.yml` 建置 `dist/` 後部署；不要直接把 Vite 原始碼分支 root 當成 Pages 輸出。

目前玩家進度使用瀏覽器 `localStorage` 保存，不需要後端。
