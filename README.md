# Medieval Juice Crafter Planner

《Medieval Juice Crafter》繁體中文攻略／販售規劃工具。

目前先解決遊玩途中最常用的查詢：

- 依 **主線進度節點** 與地區解鎖顯示目前可用資料。
- 東港村與靜謐噴泉顧客滿意度分開保存，互不影響。
- 搜尋顧客、職業、喜好、配方、原料與特性。
- 顧客只把「全部喜好都滿足」視為完全匹配。
- 顧客列表可依姓名、最佳完全匹配、最高售價排序。
- 正式顧客狀態與「今日已供應」分開保存；東港村會顯示 14 / 17 名主線進度。
- 顧客可查看最低原料成本 full-match 建議，並分開顯示已實測與允許無歧義預測的最低解。
- 配方列表可反查目前已解鎖、且滿意度門檻已達的顧客。
- 三原料配方保留調味順序；四原料以上的重複調味實測不進一般配方列表。
- 三種以下有效序列會自動產生候選：既有實測配方優先，未實測組合只顯示預測特性，不推導售價。
- 配方同時顯示批次原料成本與單杯原料成本；目前每批固定產出 2 杯。
- 「配方工具」可用目前正式支援的 V1 製作鏈即時模擬有序原料序列；observed 配方優先，否則顯示 computed / ambiguity。
- 個人配方只保存自訂名稱、有序 ingredient IDs、備註與建立時間；effects、cost、equipment、matching 每次由目前 domain 重新計算。
- 「批次規劃」頁籤已接入 optimizer domain：可切全部／潛在／正式顧客、observed-only／allow computed、最低成本／最少浪費，並顯示批次、分配、原料清單、成本、剩餘杯與 unresolved 顧客。
- Inventory foundation 已建立：`mjc-inventory` 保存原料數量、水、乾淨／用過杯具與果汁罐狀態；`PreparationDemand` 將 optimizer 結果轉成全天 gross 備料需求，尚未開始 backpack packing。
- 預測若在 effect cutoff 出現未確認同分 tie，會明確標示 ambiguous，且不參與完全匹配推薦。
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
    recipes.ts         # 已確認配方；generator 會用相同有序原料序列作 observed overlay
    recipeResearch.ts  # 四原料以上的機制研究實測，不進一般列表
    recipeIngredientCapabilities.ts # v1 果汁基底／調味材料能力邊界
    stages.ts          # 攻略閱讀章節，不作 runtime availability
  domain/
    availability.ts    # 集中式 progress / village / satisfaction availability
    customerList.ts    # 顧客排序與今日供應顯示純函式
    customerState.ts   # 正式顧客狀態與分村計數
    customerRecommendation.ts # 單人最低成本 full-match recommendation
    matching.ts        # 完全／部分匹配；ambiguous computed 不宣稱 full match
    recipeCost.ts      # 批次／單杯原料成本
    recipeEvaluator.ts # 單一有序序列 validation / observed overlay / computed evaluation
    recipeGenerator.ts # 只枚舉 V1 合法候選，再交由 evaluator 評估
    optimizerModel.ts  # optimizer request、customer→recipe eligible matrix 與 gating
    optimizerSolver.ts # 可替換的 async solver adapter contract
    optimizerHighsSolver.ts # HiGHS WASM lexicographic MIP adapter
    optimizer.ts       # batch plan / shopping list / unresolved result normalization
    optimizerUi.ts     # UI 預設需求集合：已解鎖、今日未供應、正式／潛在篩選
    inventoryRules.ts  # 已確認的背包／果汁罐／罐架／水／乾淨杯具容量常數
    preparationDemand.ts # OptimizationResult → 全天 gross 備料需求
  storage/
    plannerState.ts    # localStorage 讀寫、正式顧客與 legacy migration
    savedRecipes.ts    # 個人配方 schema validation / CRUD
    inventoryState.ts  # mjc-inventory schema normalization / storage
  types.ts             # 共用 domain / data 型別
  App.tsx              # 顧客／配方／配方工具／批次規劃頁籤
  RecipeTools.tsx      # Recipe Simulator + Personal Recipes UI
  OptimizerTools.tsx   # lazy-load optimizer、控制項與結果 UI
  styles.css
  main.tsx             # React 入口
  **/*.test.ts         # domain / storage regression tests
```

PR 2B generator 第一版只處理「1 種果汁基底 + 0～2 種不重複調味材料」。果汁調和器的兩種果汁混合規則尚未確認，因此不在此 generator 自動組合兩個果汁基底。

特性預測目前採用實測最支持的模型：

```text
slotCount = min(5, 不重複原料種類數 + 1)
```

同名特性先累加，再取最高 slot；cutoff 同分但剩餘 slot 不足時保留全部候選、不自行決定 tie-break。computed 配方的售價維持未知。

未確認的遊戲機制不會直接寫成正式配方或最佳化公式。

## Batch optimizer domain

optimizer request 會帶入主線進度、分村滿意度、今日已供應顧客與 candidate policy。domain 自己透過既有 availability / matching gate 過濾顧客與配方，不把正確性只交給 UI。

V1 solver 使用 `@bubblyworld/highs-ts@1.3.0`（HiGHS WASM），並隔離在 solver adapter 後。objective 不使用隱藏權重：

- `minimum-cost`：原料成本 → 批數／剩餘杯 → 配方種類數。
- `minimum-waste`：批數／剩餘杯 → 原料成本 → 配方種類數。

solver domain 為 async；「批次規劃」UI 只有在玩家按下「產生批次規劃」時才 dynamic import optimizer。Vite production build 會拆出約 22.84 kB optimizer JS、42.44 kB HiGHS glue 與 3.65 MB WASM（gzip 約 1.10 MB），避免首頁 initial bundle eager-load solver。

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

目前玩家進度使用瀏覽器 `localStorage` 保存，不需要後端。正式顧客使用 `mjc-formal-customers`，與每日重置的 `mjc-supplied-today` 分開保存；個人配方使用 `mjc-saved-recipes`；inventory foundation 使用 `mjc-inventory`。個人配方與 inventory 都只保存自己的 canonical input/state，不保存可由 domain 重算的 optimizer derived result。


## Inventory / packing boundary

D1 只建立 inventory state 與全天 PreparationDemand：

```text
OptimizationResult
→ PreparationDemand
→ inventory / packing（後續）
```

目前正式鎖定的容量規則只有：背包 10 slot、果汁罐 1 slot / 容量 10 / 同罐不混飲料、果汁罐架 5 slot、水 stack 10、乾淨杯具 stack 10。一般原料／原汁 stack 5 仍待再驗證，因此沒有進入 D1 / D2 的正式 packing constraint。
