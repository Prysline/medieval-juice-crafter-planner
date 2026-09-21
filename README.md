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
- 配方仍顯示「1 份果汁基準單位」的原料成本與單杯原料成本；果汁成品台 1 份果汁可產出 2 杯，但實際一次機器操作可處理 1～5 份，不再把「2 杯」視為一次固定製作批次。
- 「配方工具」已改為 ordered sequence builder：點原料直接 append，可重複調味、四原料以上、逐項刪除／清空；observed 精確序列優先，否則顯示 computed / ambiguity。
- 個人配方只保存自訂名稱、有序 ingredient IDs、備註與建立時間；effects、cost、equipment、matching 每次由目前 domain 重新計算。
- 「批次規劃」已重構為 production optimizer：可依序指定主要／次要 lexicographic 目標，包含最低成本、最少浪費、最高已知銷售總額、最高已知毛利、最少機器操作與最少果汁罐換裝；結果按最終果汁分組顧客，並顯示共享中間半成品、1～5 份 stack 操作、原料清單、收入／毛利與 unresolved 顧客。
- Core model correction 2B 已把可用 physical jar 數接進多趟販售 schedule；UI 會分開顯示「保留杯具並回家清洗」與「背包滿時允許丟棄」兩種 policy 的販售趟數與逐罐排程。
- Inventory / packing D1～D4 已建立：`mjc-inventory` 保存原料、水、杯具與果汁罐狀態；`PreparationDemand` 消費 production-unit optimizer 結果，並已有 stock offset、single-trip packing 與 multi-trip replenishment。
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
    optimizer.ts       # recipe production plan / shopping list / metrics normalization
    productionPlan.ts  # shared-prefix production graph / 1～5 stack machine operations
    optimizerUi.ts     # UI 預設需求集合：已解鎖、今日未供應、正式／潛在篩選
    inventoryRules.ts  # 已確認的背包／果汁罐／罐架／水／乾淨杯具容量常數
    preparationDemand.ts # OptimizationResult → 全天 gross 備料需求
    preparationShortfall.ts # 既有成品／raw inventory → 實際新製作與缺口
    purchaseSources.ts # 已知購買來源、最低價／同價保留 decision
    singleTripPacking.ts # 販售趟 finished-drink jars + clean cups 最小必要 slot / overflow
    multiTripReplenishment.ts # physical jar schedule、多趟販售、杯具 policy、jar-rack staging
    scheduleRouteReadiness.ts # 作息觀察 normalization 與 route-data blockers
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

PR 2B generator 仍只**自動枚舉**「1 種果汁基底 + 0～2 種不重複調味材料」，避免候選爆炸；這不再是 simulator/evaluator 的能力上限。

手動 simulator 使用 ordered sequence：重複調味與四原料以上都可評估；每遇到新的 juice-base 就開始下一杯飲料 segment。兩杯飲料經果汁調和器組合時，網站只做 `front.sequence + back.sequence`，不另造 Blender 專用配方格式。多 juice-base sequence 的 unlock 至少為 `juice-blender-unlocked`，equipment 會包含果汁調和器。

果汁調和器的遊戲內精確輸入比例、產量與售價公式仍未確認，因此 blended sequence 只顯示 ordered ingredients / effects / 原料合計，不推導每杯成本或售價。

特性預測目前採用實測最支持的模型：

```text
slotCount = min(5, 不重複原料種類數 + 1)
```

同名特性先累加，再取最高 slot；cutoff 同分但剩餘 slot 不足時保留全部候選、不自行決定 tie-break。computed 配方的售價維持未知。

未確認的遊戲機制不會直接寫成正式配方或最佳化公式。

## Production optimizer domain

optimizer request 會帶入主線進度、分村滿意度、今日已供應顧客、candidate policy，以及有順序的 lexicographic priorities。domain 自己透過既有 availability / matching gate 過濾顧客與配方，不把正確性只交給 UI。

核心數量單位已從「固定 2 杯 batch」改為 **juice production unit**：

```text
1 份原汁／調製後果汁 + 1 份水
→ 2 份可販售果汁
```

這只是產量換算，不代表一次機器操作。製作設備一次可處理 1～5 份，因此 production graph 會把共享前綴聚合後，再用 `ceil(quantity / 5)` 計算每層機器操作。例如 `AB ×1` 與 `ABC ×2` 會共享 `AB ×3`，而不是各自從頭製作。重複調味如 `A → AB → ABB` 則是兩層不同調味操作。

V1 自動 optimizer 暫只接受「一個 juice-base + seasoning chain」的 production-safe 配方；果汁調和器雖已確認 sequence concatenation，但精確輸入比例／產量仍未知，因此多 juice-base 配方不進自動份數最佳化。

HiGHS solver 使用真正的 lexicographic repeated solve，不使用隱藏權重。可指定的 criterion 包含：

- `minimum-cost`
- `minimum-waste`
- `maximum-known-revenue`
- `maximum-known-gross-profit`
- `minimum-machine-operations`
- `minimum-jar-switches`

果汁罐換裝定義為「同一罐從一種最終果汁改裝成另一種」；空罐第一次裝入與補裝同種類不算。忽略既有預裝內容時，若方案有 `K` 種最終果汁、可用 `J` 個果汁罐，最低換裝數為 `max(0, K - J)`。UI 可指定可用果汁罐數與 `maxJarTypeSwitches` hard constraint。

收入相關 criterion 不推導 computed 售價。正式顧客若要參與 revenue / gross-profit criterion，只能使用 `salePrice !== null` 的 full-match 配方；潛在顧客仍可依 candidate policy 使用 computed full match，但試喝收入不計入已知銷售額。

solver domain 為 async；UI 只有在玩家按下規劃時才 dynamic import optimizer / HiGHS WASM。

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

目前正式鎖定的容量規則：背包 10 slot、果汁罐 1 slot / 容量 10 / 同罐不混飲料、果汁罐架 5 slot、水 stack 10、乾淨杯具 stack 10、一般原料／原汁 stack 5。D1/D2 最初建立時尚未使用一般原料／原汁 stack 5；規則現已確認，production optimizer 已使用它計算機器操作。

D2 的 single-trip packing 目前只處理**販售趟**：把已分配給顧客的成品按 recipe 分裝進果汁罐，並計算乾淨杯具 stack。optimizer 產生但未分配的 leftover 不帶出門。若完整需求超過 10 slot，只回報 required / overflow slots，不自行決定要犧牲哪位顧客；多趟拆分留到後續 slice。

D3 是 **post-optimizer stock offset**：先用 `mjc-inventory` 中同 recipe 的既有成品抵掉 assigned servings，再重算真正需要的新製作 juice units、原料與 production water；接著用 raw ingredient / water / clean cups inventory 抵扣缺口。一般 packing 仍不重新求解顧客分配；只有「最少／最大果汁罐換裝」會把必要的可用果汁罐摘要回饋給 optimizer。

購買來源只使用目前資料中明確的 seller / shop 價格：若只有一個最低價來源可唯一選擇；同價則保留所有 source records，不加入路線或距離 tie-break。`Ingredient.seller` 與 `shops.ts` 若名稱相同，目前也不自行推定為同一實體商店，等後續 location identity 更完整再處理。


## Multi-trip replenishment boundary

D4 只處理從家出發、賣完回家的**販售趟**。它不加入顧客 schedule、跨村時間或 route objective，也不重新修改 optimizer recipe assignment。

used-cup handling 必須明確選 policy：

- `retain-and-wash`：每趟 departure load 只允許使用 9 / 10 slots，預留 1 slot 給第一個 used-cup stack；每趟（最後一趟除外）回家後把該趟 used cups 全部洗回 clean cups，再供下一趟重用。這個「預留 1 slot」是網站 packing policy，不是額外宣稱遊戲 UI 規則。
- `allow-drop-if-full`：departure 可使用完整 10 slots；若 10 slots 全滿，網站只標示 used cups **可能掉落**，不假裝它們一定能回收，也不假設跨趟重用。

每趟同時可用的果汁罐數會取 **玩家可用 physical jar 數、果汁罐架 5 slots、背包／杯具 policy 可容納量** 的共同限制。規劃採「一次 staging 一趟」的模型；若未來確認遊戲允許不經罐架同時準備更多罐，這項 constraint 再另行調整。

Core model correction 2B 已把 physical jar identity 接進 D4 schedule。每個 load 都記錄實際果汁罐編號，以及「首次裝填／補裝同種／換裝」狀態；同一 physical jar 在同一趟只會出現一次。當果汁種類多於可用罐數時，新增果汁種類會串到既有 jar queue 上，讓 schedule 實際實現 `max(0, 果汁種類數 - 可用果汁罐數)` 的最低換裝數；當罐數足夠時，額外空罐可平行承擔同一種果汁的多個容量 10 load，而不製造假換裝。

`jarTypeSwitches` 與 `tripCount` 現在都從**同一份可行 physical jar schedule** 取得：換裝數可從 schedule 逐罐重算，趟數就是 schedule 的 trip 數；optimizer UI 會再檢查 downstream schedule 的換裝數與 recipe-assignment solver 回報一致，若漂移則停止顯示結果。兩種 used-cup policy 仍各自建 schedule，因此趟數不同時會分開顯示，不合併成沒有 policy 語意的單一數字。

trip grouping 仍是 deterministic capacity-first feasible planning；它目標是產生可解釋、符合 physical jar / rack / backpack / cup constraints 的共同排程，**不宣稱已做最少趟數的全域最佳化**。


## Schedule / route readiness boundary

D5 目前只做到 **schedule normalization + route-readiness**，不實作 route optimizer，因為 source 尚未提供足夠資料。

目前可安全使用的作息資料只有少數顧客觀察：

- `leave_home`：只代表離開家門，**不等於實際離村時間**。
- `outside_village_by`：只代表到該時間時已在村外，不能反推出精確離村時間。
- `return_village`：保留觀察到的約略返村時間。
- `HH:MM` 與 `HH:MM～HH:MM` 可轉成 minutes 作排序／比較，但原始字串仍保留；不支援的文字維持 unparsed。

目前 route optimization 明確被以下 source gaps 阻塞：

- 沒有跨村 travel time。
- 沒有 home / shop / customer 的可計算 location identity／座標。
- 大多數顧客沒有完整 service window；目前有 schedule observation 的也不能直接推成完整可服務區間。
- shop hours 未記錄。

因此任何 route / arrival-time / customer-ordering objective 都必須等資料補齊後再實作；網站不會把離家門時間冒充成離村截止時間。
