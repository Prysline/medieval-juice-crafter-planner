# Medieval Juice Crafter Planner

《Medieval Juice Crafter》繁體中文攻略／販售規劃工具。

目前先解決遊玩途中最常用的查詢：

- 依 **主線進度節點** 與地區解鎖顯示目前可用資料。
- 東港村與靜謐噴泉顧客滿意度分開保存，互不影響。
- 搜尋顧客、職業、喜好、配方、原料與特性。
- 顧客只把「全部喜好都滿足」視為完全匹配。
- 顧客列表可依姓名、最佳完全匹配、最高售價排序。
- 配方列表可反查目前已解鎖、且滿意度門檻已達的顧客。
- 三原料配方保留調味順序；四原料以上的重複調味實測不進一般配方列表。
- 舊版 `mjc-stage` / `mjc-satisfaction` localStorage 會保守遷移到新版進度資料。

## 進度模型

攻略文件仍保留「階段一～五」作閱讀章節；runtime availability 使用：

```text
opening
→ seasoner-unlocked
→ juice-jar-unlocked
→ juicer-unlocked
→ tranquil-fountain-unlocked
→ juice-blender-unlocked
```

其中靜謐噴泉是階段四主線的必要中間節點，不會因選到「榨汁機已解鎖」而提前開放。

## 資料邊界

```text
src/
  data/
    customers.ts       # 顧客、喜好、分村滿意度門檻、作息觀察
    ingredients.ts     # 原料價格、效果與 unlockedAt
    equipment.ts       # 設備、價格與 unlockedAt
    progress.ts        # canonical 主線進度節點與順序
    villages.ts        # 地區與 unlockedAt
    shops.ts           # 已確認的地區商店商品
    recipes.ts         # 一般網站顯示的已確認配方（目前最多三原料）
    recipeResearch.ts  # 四原料以上的機制研究實測，不進一般列表
    stages.ts          # 攻略閱讀章節，不作 runtime availability
  domain/
    availability.ts    # 集中式 progress / village / satisfaction availability
    customerList.ts    # 顧客排序與今日供應顯示純函式
    matching.ts        # 完全／部分匹配判定
  storage/
    plannerState.ts    # localStorage 讀寫與 legacy migration
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

GitHub Pages 由 `.github/workflows/pages.yml` 在 `main` 更新後建置 `dist/` 並部署。

目前玩家進度使用瀏覽器 `localStorage` 保存，不需要後端。
