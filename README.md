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
- Candidate-2A / PR #62 已建立單一果汁段逐層搜尋；Candidate-2B / PR #68 再加入合法多果汁段搜尋：最多 3 個獨立果汁段、果汁調和深度 2，保留左右順序，並以固定左結合製作樹避免等價樹重複爆炸。Correctness-3 / PR #74 再把搜尋消費語意拆成「第一個可行解（first-feasible）」與「有界完整候選（bounded-exhaustive）」：存在性判定保留提前停止（early stop），顧客完整匹配／推薦與 optimizer 則在既有搜尋預算內比較更深層合法候選。未實測組合仍只推導特性、不推導售價；重複調味後備仍維持單一果汁段。Performance-1 / PR #70 後，配方頁改為每頁最多 50 筆並提供來源／售價篩選，避免 Candidate-2B 候選量造成大量 DOM 卡頓。
- 配方仍顯示「1 份果汁基準單位」的原料成本與單杯原料成本；果汁成品台 1 份果汁可產出 2 杯，但實際一次機器操作可處理 1～5 份，不再把「2 杯」視為一次固定製作批次。
- 「配方工具」已改為有序原料編排：點原料直接加入，可重複調味、四原料以上、逐項刪除／清空；精確原料順序已有實測資料時以實測結果優先，否則顯示推導結果或歧義。
- 個人配方只保存自訂名稱、有序 ingredient IDs、備註與建立時間；effects、cost、equipment、matching 每次由目前 domain 重新計算。
- 「批次規劃」已重構為 production optimizer：可依序指定主要／次要 lexicographic 目標，包含最低成本、最少浪費、**最高原料成本**、最高已知銷售總額、最高已知毛利、最少機器操作與最少果汁罐換裝。Objective-1 / PR #76 後，「最高原料成本」以實際 customer → recipe assignment 所選配方的原料成本計分，不以 production units 灌高成本；它是配方研究目標，不代表最高售價或最高毛利。Phase 1 結果資訊架構已完成：閱讀順序為 **規劃摘要 → 所需物資 → 製作步驟 → 果汁分配 → 販售排程**；水會以免費取得需求顯示。PR #33 後製作步驟以機器為獨立區塊，每次 1～5 份製作拆成各批 slot flow；原料／果汁／水／output 各自用膠囊顯示，`▸` 只代表配方內部順序，`→` 只代表加工／狀態轉換。
- Core model correction 2B 已把 physical jar identity 接進多趟販售 schedule。Phase 2 capacity contract 也已完成：`mjc-inventory` 保存原料、水、clean / used cups、一般架子數、果汁罐架數與每個 physical jar；PR #39 / Phase 5B1 後批次規劃已有實際 Inventory editor，可逐罐設定 recipe identity / servings。`mjc-planner-settings` 現在保存果汁罐攜帶策略 `juiceJarCarryMode`、固定格數 `reservedJuiceJarSlots` 與 used-cup drop opt-in；舊的 `carriedJuiceJarIds`／count 只會遷移成固定格數，不再保留特定實體罐綁定。沒有果汁罐架時，所有持有的實體果汁罐都必須隨身；有果汁罐架後，規劃器可在各趟之間整罐上架／取出，固定模式只固定果汁罐占用格數，自動模式則依每趟需求計算攜帶數。
- Inventory / packing D1～D4 與 Phase 4 cup lifecycle 已建立：`PreparationDemand` 消費 production-unit optimizer 結果，已有 stock offset、single-trip packing 與 physical-jar-aware multi-trip replenishment；販售排程現在會用玩家實際持有的 clean / used cups，逐杯追蹤 clean → used stack transition，不再固定預留 1 slot。PR #32 先把 optimizer `leftoverServings` 保留在同一實體罐；PR #37 再把 sales schedule 的 plan-local 罐號改成 persistent `mjc-inventory` jar ID，並攜帶該罐規劃前的 `recipeId / servings` metadata。剩餘成品仍只能留在同一 physical jar，不允許跨罐倒果汁；果汁罐只能整罐移動，居家放置只使用果汁罐架，不把一般架當果汁罐 storage。
- 特性同分時會先套用已確認的順序規則：**較晚加入原料所提供／最後貢獻的特性排序較高**；只有套用此規則後，cutoff 候選仍同分且最後貢獻位置相同時才保留 ambiguous，且 ambiguous computed candidate 不參與完全匹配推薦。
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
    recipeGenerator.ts # Candidate-2A/2B：建立單一果汁段與合法多果汁段搜尋層，再交由 evaluator 評估
    recipeSearch.ts    # 共用搜尋：first-feasible 保留提前停止；bounded-exhaustive 在既有搜尋預算內收集比較候選，並沿用重複調味後備邊界
    recipeCandidatePool.ts # Candidate-1/2A/2B：依完整有序序列合併來源、保存搜尋層資訊，並提供庫存編輯器的實測／已保存配方集合
    optimizerModel.ts  # optimizer request、customer→recipe eligible matrix 與 gating
    optimizerSolver.ts # 可替換的 async solver adapter contract
    optimizerHighsSolver.ts # HiGHS WASM lexicographic MIP adapter
    optimizer.ts       # recipe production plan / shopping list / metrics normalization
    productionPlan.ts  # shared-prefix production graph / 1～5 stack machine operations
    optimizerUi.ts     # UI 預設需求集合：已解鎖、今日未供應、正式／潛在篩選
    inventoryRules.ts  # 已確認的背包／一般架／果汁罐／罐架／水／乾淨杯具容量常數
    inventoryCapacity.ts # ownership / carried jars / shelf / rack staging 的 capacity summary
    preparationDemand.ts # OptimizationResult → 全天 gross 備料需求
    preparationShortfall.ts # 既有成品／raw inventory → 實際新製作與缺口
    productionLogistics.ts # stock-offset net production → backpack / shelf / machine / water / 指定實體果汁罐接收時序
    planApplicationTransaction.ts # 規劃結果 → 不可變 before / after 交易草稿；不寫 storage
    planApplicationValidation.ts # transaction basis 與目前 canonical 狀態的純 stale / mismatch 比對
    purchaseSources.ts # 已知購買來源、最低價／同價保留 decision
    singleTripPacking.ts # 販售趟 finished-drink jars + clean cups 最小必要 slot / overflow
    multiTripReplenishment.ts # 持久果汁罐 ID、初始內容、多趟販售、實際裝罐時序、leftover 與杯具 policy
    scheduleRouteReadiness.ts # 作息觀察 normalization 與 route-data blockers
  storage/
    plannerState.ts    # localStorage 讀寫、正式顧客與 legacy migration
    savedRecipes.ts    # 個人配方 schema validation / CRUD
    inventoryState.ts  # mjc-inventory schema normalization / storage
    plannerSettings.ts # mjc-planner-settings：persistent carried jar IDs、legacy count migration 與 used-cup drop opt-in
    planApplicationBasis.ts # read-only canonical basis 重建與 stored transaction stale validation
    planApplicationState.ts # inventory + supplied customers 的單一 canonical plan-application storage envelope
    planApplicationCommit.ts # Phase 5C-4：commit 前 stale validation + single-write transaction commit
  types.ts             # 共用 domain / data 型別
  App.tsx              # 顧客／配方／配方工具／批次規劃頁籤
  RecipeTools.tsx      # Recipe Simulator + Personal Recipes UI
  OptimizerTools.tsx   # lazy-load optimizer、控制項與結果 UI
  styles.css
  main.tsx             # React 入口
  **/*.test.ts         # domain / storage regression tests
```

Candidate-2A / PR #62 已把固定深度枚舉改成**單一果汁段漸進搜尋**：不重複原料最多 4 種，重複調味後備最多 6 個總原料；單段每層 2048、總計 4096 candidates。Candidate-2B / PR #68 在同一套 progressive search 上加入**合法多果汁段搜尋**：最多 3 個獨立果汁段、Blender depth 2；兩段總 seasoning depth 0～4，三段 0～2；每個 blend layer 最多 6000、blended unique 總計 11000 candidates。這些數字都是網站搜尋預算，不是遊戲規則。Blender 左右輸入順序保留，三段搜尋只保留與現行 production graph 一致的 left-deep canonical tree；Blender 未解鎖時候選可留在 metadata，但不進目前搜尋。全部 unique structure 都找不到保證完全匹配後，才進 Candidate-2A 的單段 repeated-seasoning fallback。Correctness-3 / PR #74 不修改上述候選產生器／搜尋預算，而是拆分消費端語意：`first-feasible` 用於存在性判定並保留提前停止；`bounded-exhaustive` 讓顧客完整列表、最低成本推薦與 optimizer 在既有搜尋層／預算內持續比較合法候選，不會因較淺層先出現完全匹配就漏掉較深層候選。Candidate-1 / PR #60 的共用候選配方池仍以完整有序原料序列去重並保留實測／已保存／安全推導／仍有歧義等來源。Performance-1 / PR #70 另外把大型配方列表改為分頁＋篩選，並把果汁罐內容選單限制為目前可用的實測／個人已保存配方；未實測組合仍可先在「配方工具」保存後登記為罐內容。

手動配方模擬器使用有序原料順序：重複調味與四原料以上都可評估；每遇到新的需榨汁原料就開始下一個果汁段。兩杯果汁經果汁調和器組合時，網站只做 `front.sequence + back.sequence`，不另造果汁調和器專用配方格式。含多個需榨汁原料的序列至少需要實際程式進度 key `juice-blender-unlocked`，設備需求會包含果汁調和器。UX-1 / PR #66 後，原料選取卡會直接顯示特性與數值；模擬器也可暫選目前已解鎖的目標顧客，顯示 `名字（職業）`、喜好與完全／部分／未匹配狀態。這個目標只存在於本次元件狀態，不會寫入正式顧客、今日供應或個人保存資料；若 computed 成品特性仍有歧義，只顯示目前可確定的匹配程度，並明確標示不能保證完全匹配。

果汁調和器已確認 **1:1:1** 數量模型：果汁 A ×q + 果汁 B ×q → 調和果汁 ×q，q = 1～5；機器為 2 個輸入 + 1 個輸出，共 **3 個機器格位**。兩個輸入已確認只要是果汁類即可。直接實測也支持：完整原料順序串接後，成品特性沿用同名累加、`slotCount`、高值排序與最後貢獻位置優先；仍未知的是果汁調和器通用售價公式，以及同值且同最後貢獻位置時的次級排序規則。現行配方模擬器已能串接完整原料順序；Phase 3 已把多果汁段與果汁調和步驟接入製作圖。

特性預測目前採用實測最支持的模型：

```text
slotCount = min(5, 不重複原料種類數 + 1)
```

同名特性先累加，再依總值取最高欄位；總值同分時，較晚加入原料所提供／最後貢獻的特性優先。若套用這層規則後，截斷位置仍有同分且最後貢獻位置相同的候選，才保留歧義，不自行發明次級排序。推導配方的售價仍維持未知。三原料以上的遊戲內預設名稱已確認為「最高特性 + 隨機詞彙」；完整實測名稱不是穩定識別資訊，因此 repo 以穩定原料順序名稱作網站名稱，截圖實測完整名稱另存實際欄位 `observedDisplayName`，不實作隨機名稱產生器。

未確認的遊戲機制不會直接寫成正式配方或最佳化公式。

## Production optimizer domain

optimizer request 會帶入主線進度、分村滿意度、今日已供應顧客、candidate policy，以及有順序的 lexicographic priorities。domain 自己透過既有 availability / matching gate 過濾顧客與配方，不把正確性只交給 UI。

核心數量單位已從「固定 2 杯 batch」改為 **juice production unit**：

```text
1 份原汁／調製後果汁 + 1 份水
→ 2 份可販售果汁
```

這只是產量換算，不代表一次機器操作。製作設備一次可處理 1～5 份，因此 production graph 會把共享前綴聚合後，再用 `ceil(quantity / 5)` 計算每層機器操作。例如 `AB ×1` 與 `ABC ×2` 會共享 `AB ×3`，而不是各自從頭製作。重複調味如 `A → AB → ABB` 則是兩層不同調味操作。

最佳化模型與製作圖現在已能接受含多個需榨汁原料的候選配方，並把每個果汁段分開榨汁／調味後以 1:1:1 的果汁調和步驟合併，再進果汁成品台；最少機器操作的比較也會正確計入同一調和步驟在單一配方中重複出現的次數。Candidate-2B / PR #68 後，顧客頁與批次最佳化已共用同一套**單段＋多段果汁調和**候選層；Correctness-3 / PR #74 則明確分開消費端語意：存在性檢查可使用 `first-feasible`，顧客完整比較與 optimizer 使用 `bounded-exhaustive`。未知 Blender 售價仍不推導。PR #69 會在剩餘果汁終局容器不足時直接回報「需要幾個可重用果汁罐、目前有幾個、還缺幾個，以及多少罐被既有內容鎖住」。

HiGHS solver 使用真正的 lexicographic repeated solve，不使用隱藏權重。可指定的 criterion 包含：

- `minimum-cost`
- `minimum-waste`
- `maximum-ingredient-cost`
- `maximum-known-revenue`
- `maximum-known-gross-profit`
- `minimum-machine-operations`
- `minimum-jar-switches`

`maximum-ingredient-cost` 是研究／擴充實測配方用 criterion：solver 以實際 customer → recipe 的 assignment 變數乘上所選配方原料成本來計分，不直接最大化 production `x × ingredientCost`。因此額外製作沒有顧客需求的果汁不會提高此目標；主要目標固定後仍沿用既有 lexicographic fallback，優先壓低實際 production cost／production units。此 criterion 不推導售價，也不等同最高已知銷售額或最高已知毛利。

果汁罐換裝定義為「同一罐從一種最終果汁改裝成另一種」；空罐第一次裝入與補裝相同配方不算。Correctness-1 / PR #64 後，optimizer 與販售排程會讀取本日可用的所有實體果汁罐初始 `recipeId / servings`：有果汁罐架時，可在返家後把整罐放回架上並換另一罐出門；未喝空內容仍不能為了降低換裝數而自動倒掉或跨罐轉移。果汁成品台若面對仍有相同配方內容的未滿罐，可以直接補裝，只要補裝後不超過 10 份；不同配方仍必須先讓舊內容合法耗盡。販售排程會依同一份逐罐時序重算換裝數，並與 optimizer 結果檢查一致；`maxJarTypeSwitches` 也使用這套初始內容感知的換裝語意。

收入相關 criterion 不推導 computed 售價。正式顧客若要參與 revenue / gross-profit criterion，只能使用 `salePrice !== null` 的 full-match 配方；潛在顧客仍可依 candidate policy 使用 computed full match，但試喝收入不計入已知銷售額。

solver domain 為 async；UI 只有在玩家按下規劃時才 dynamic import optimizer / HiGHS WASM。UX-1 / PR #66 另外建立 `PlanningUserError` 的穩定錯誤 code + 結構化 context：常見可修正失敗由 UI 產生中文摘要、限制說明與可操作建議；未知 invariant／solver 細節不再直接當主訊息，只保留在可展開的「技術資訊」。直接顯示於製作物流區的 issue 也已改成可讀中文，不再讓裸英文錯誤繞過這個邊界。

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

目前玩家進度使用瀏覽器 `localStorage` 保存，不需要後端。正式顧客使用 `mjc-formal-customers`，與每日重置的 `mjc-supplied-today` 分開保存；個人配方使用 `mjc-saved-recipes`；inventory 使用 `mjc-inventory`；planner capacity settings 使用 `mjc-planner-settings`。這些 storage 只保存 canonical input/state，不保存可由 domain 重算的 optimizer derived result。


## Inventory / packing boundary

D1～D4 已完成既有 inventory / packing foundation：

```text
OptimizationResult
→ PreparationDemand
→ stock offset
→ single-trip packing
→ physical-jar-aware multi-trip replenishment
```

目前正式確認的容量／物流規則：

- 背包：**10 slots**。
- 一般原料／原汁：**5 / stack**。
- 水：**10 / slot**；免費，但搬運與暫存仍占空間。製作區到取水處有一段距離，一次能取多少水由**當下背包可用空間**決定，不是固定只取 1 stack。
- 一般架子：**9 slots / 架**；每個 shelf slot 沿用背包中同類物品的 stack capacity。
- 玩家目前似乎不能主動把物品放地面作 storage；採水或 NPC 回傳 used cup 等外部取得物品在背包滿時造成掉落，與主動地面暫存是不同機制。
- 杯子／乾淨悲劇：**10 / stack**；`cleanCups + usedCups` 代表玩家目前實際持有杯具總數。Phase 4 已把這個實體杯具總數接入販售排程：每趟只帶實際可用的 clean cups，回傳後轉成 used cups；需要跨趟重用時只能清洗目前實際持有的 used cups。
- 果汁罐：**1 罐 = 1 slot / 容量 10 / 同罐不混不同飲料**；每個 `juiceJars[]` item 都代表一個 actual physical jar，空罐也保留 identity。
- 果汁罐架：**5 slots / 架**；`jarRackCount × 5` 是獨立的居家果汁罐容量。若持有罐數超過果汁罐架容量，超出的罐子就是每趟至少必須留在背包的數量；背包 10 格只限制單趟，不再截斷整日可使用的實體果汁罐總數。一般架則為 `shelfCount × 9` slots。

machine slots 與「一次可處理 1～5 份」是兩個不同概念：

- 柑橘榨汁機／榨汁機：1 input + 1 output = **2 slots**。
- 調味器：果汁 input + 調味材料 input + output = **3 slots**。
- 果汁成品台：果汁 input + 水 input + output = **3 slots**。
- 悲劇清洗台：used cup input + 水 input + clean cup output = **3 slots**。
- 果汁調和器：果汁 A input + 果汁 B input + output = **3 slots**，已確認 1:1:1、q = 1～5。

Phase 3 的 production logistics 會從 stock offset 後的實際新製作量建立 net production graph，並驗證 backpack ↔ general shelf ↔ machine 的搬運可行性。現行 inventory 尚未保存每件物品的精確位置，因此 raw ingredient / water 先視為 home supply，再依可用 shelf / backpack slots 做 deterministic feasible placement。machine output 不能直接消失：中間產物必須回到一般 storage，finalizer 成品則必須交給實際存在的 physical juice jar receiver；jar-rack staging 只提供位置，不代表額外擁有果汁罐。

D2 的 single-trip packing 仍只負責單趟 required / overflow 計算；**多趟拆分已由 D4 完成**，不再是「後續 slice」。D3 會先用 `mjc-inventory` 中同 recipe 的既有成品抵 assigned servings，再重算新製作 juice units、原料與 production water，並以 raw ingredient / water / clean cups inventory 抵扣缺口。一般 packing 不重新求解顧客配方分配；只有會影響 final-juice kind selection 的果汁罐換裝條件，才把必要 container summary 回饋給 optimizer。

購買來源只使用目前資料中明確的 seller / shop 價格：若只有一個最低價來源可唯一選擇；同價則保留所有 source records，不加入路線或距離 tie-break。`Ingredient.seller` 與 `shops.ts` 若名稱相同，目前也不自行推定為同一實體商店，等後續 location identity 更完整再處理。


## Multi-trip replenishment boundary

D4 只處理從家出發、賣完回家的**販售趟**。它不加入顧客 schedule、跨村時間或 route objective，也不重新修改 optimizer recipe assignment。

used-cup handling 必須明確選 policy：

- `retain-and-wash`：預設策略；逐杯模擬 clean → used。若某次 used cup 回傳會讓背包超過 10 slots，該趟會在更早位置截斷，回家後可把實際持有的 used cups 清洗成 clean cups 再出發；清洗杯數與等量用水都會記錄。
- `allow-drop-if-full`：persisted **opt-in**；同樣逐杯模擬 clean → used，但 NPC 回傳 used cup 當下若真的沒有空間，才把該杯記為掉落。掉落杯不再供後續趟次使用；這不代表玩家能主動把物品丟地上作 storage。
- 目前選用的 policy 必須產生可行排程；替代 policy 若因容量不可行，只顯示不可行原因，不會反過來讓已選策略整體失敗。兩種 policy 都保留實際 physical cup ownership，並檢查 `final physical cups = initial physical cups - dropped cups`。

Correctness-1 / PR #64 已把「實體果汁罐是哪些」與「背包要留多少果汁罐格」重新拆開。**沒有果汁罐架時，所有持有的實體果汁罐都必須隨身；有果汁罐架時，才允許跨趟上架／換罐。**玩家可以選擇固定果汁罐格數，或交給規劃器逐趟自動計算；固定格數不再綁定特定 persistent jar ID。各趟會記錄真正隨身的實體罐，滿架的一換一交換可用「先取出、再放回」完成，不要求永久額外空一格。

Core model correction 2B 已把 physical jar identity 接進 D4 schedule；Phase 5A / PR #37 再把原本的 plan-local 編號橋接到 persistent `InventoryState.juiceJars[].id`。Phase 5B1 / PR #39 當時加入逐罐庫存編輯與明確常駐實體罐選擇；Correctness-1 / PR #64 已 supersede 這個設定方式，canonical planner settings 改為 slot-based carry policy，舊 persistent ID 選擇只遷移成固定格數。Phase 5B2-1 / PR #44 把既有成品抵扣固定到實際 persistent jar；PR #64 後，**所有持有且可合法存放的實體罐內容**都能納入本日需求，不再只看先前勾選的常駐罐。Phase 5B2-4/5 / PR #47 建立的逐罐裝填事件仍沿用，但現在同配方未空罐可直接補裝至最多 10 份；不同配方仍必須先把舊內容合法耗盡。若一罐已一次裝好 10 份、只是因杯具限制分成兩趟販售，後一趟會標成「沿用罐內成品」，不會虛構第二次補裝。尚未喝空的內容仍不會被自動丟棄或跨罐轉移。

販售 schedule 不重新計算喜好匹配，而是直接沿用 optimizer 的 customer → recipe full-match assignment，再依果汁罐容量把顧客切進對應 jar load；因此 UI 可以直接說明每一罐要服務哪些「完整符合」顧客。若 preparation demand 的 assigned servings 與 customer IDs 數量不一致，schedule 會拒絕產生。

`jarTypeSwitches` 與 `tripCount` 現在都從**同一份可行 physical jar schedule** 取得：換裝數可從 schedule 逐罐重算，趟數就是 schedule 的 trip 數；optimizer UI 會再檢查 downstream schedule 的換裝數與 recipe-assignment solver 回報一致，若漂移則停止顯示結果。兩種 used-cup policy 仍各自建 schedule，因此趟數不同時會分開顯示，不合併成沒有 policy 語意的單一數字。

trip grouping 仍是 deterministic capacity-first feasible planning；它目標是產生可解釋、符合 physical jar ownership / carried-jar / backpack / cup constraints 的共同排程。`jarRackCount × 5` 是獨立 staging capacity，不再作 D4 單趟固定上限；**目前仍不宣稱已做最少趟數的全域最佳化**。


## Next planner corrections

Phase 1｜Planner result information architecture 已於 PR #22 完成；Phase 2｜Inventory / capacity contract 已於 PR #24 完成；Phase 3｜Production logistics 已於 PR #27 完成；Phase 4｜Cup lifecycle / sales trips 已於 PR #30 完成。

Phase 3 已完成：

- stock offset 後會依 `juiceUnitsToPrepare` 重建 **net production plan**；UI 不再把 gross optimizer steps 冒充成實際仍需製作的步驟。
- `productionLogistics.ts` 產生 deterministic feasible trace，分開追蹤一般架、背包、果汁罐占用／預留與 machine input/output slots；input 進機器後會釋放原 storage，operation 失敗時 material / action / fetch counters 會 transactionally rollback。
- 水依當下背包 free slots 取得，可先回到 home storage 再分批製作；沒有 route / seller distance 資料的原料取得只記 acquisition action，不假裝成已知往返趟數。
- 果汁調和器已按 **1:1:1、q = 1～5** 接入製作圖；多個果汁段會分開製作再調和。
- 果汁成品台每次操作產出 **2～10 份偶數成品**；Phase 5B2-4/5 / PR #47 後，成品會依選定的販售排程綁定到明確的實體果汁罐。PR #64 後，接收罐是否隨身不再由固定 persistent ID 決定：沒有果汁罐架時所有罐都隨身；有架時可依趟次換罐。rack 空位只提供存放位置，不會憑空生成實體果汁罐。
- 同一實體果汁罐的裝罐／販售時序會驗證容量上限 10 與配方相容性；相同配方可在未空罐時直接補裝，只要總量不超過 10，不同配方則必須先讓舊內容耗盡。跨多趟販售但仍是同一批罐內成品時不會重複計成補裝。現行 `mjc-inventory` 尚未保存每件製作材料的精確位置，因此 raw / water 仍視為 home supply。Phase 5C-1 / PR #50 已建立**純交易草稿**；Phase 5C-2 / PR #52 已提供交易預覽；Phase 5C-3 / PR #54 已加入**寫入前過期驗證能力**；Phase 5C-4 / PR #56 已加入正式確認套用入口與 single-write commit；Phase 5C-5 / PR #58 已完成套用後刷新與重複套用防護。成功提交後會立即清除舊規劃結果，讓更新後的 inventory／今日已供應狀態成為下一次求解輸入，不會自動背景重跑 HiGHS；同一 transaction draft 再次提交會被 stale validation 拒絕且不新增 storage write。

Phase 4 已完成：

1. 玩家實際持有的 `cleanCups + usedCups` 已成為販售排程的 hard physical constraint；沒有實體杯就不會產生正需求販售排程。
2. 每趟逐杯追蹤 clean → used stack transition；`retain-and-wash` 不再固定預留 1 slot，而是依實際趟中峰值判斷是否需要拆趟。
3. 跨趟重用只會清洗實際持有的 used cups，並記錄清洗杯數／用水；`allow-drop-if-full` 只在 NPC 回傳 used cup 當下無空位時記錄掉落，掉落杯不會被當成後續可用 storage。
4. PR #32 已把 optimizer `leftoverServings` 帶入販售結果：leftover 會保留在該 recipe 最後販售的同一 physical jar；若同一罐無法在不換掉 retained juice 的前提下保存，planner 會明確判定不可行，不會默默丟失或轉移到別罐。
5. PR #33 完成 planner readability / copy consistency：`▸` 無半形空白、顧客／配方／配方工具／批次規劃共用配方名稱與金額 formatter、製作步驟以 machine group + slot-flow pills 呈現。
6. PR #35 完成靜謐噴泉配方研究同步：新增 4 筆實測配方；已確認的特性同分規則改為「同分時較晚加入原料優先」；相同不重複原料集合的調味順序／重複既有原料不提高售價已鎖進研究回歸測試，但推導配方售價仍不推導。
7. PR #37 完成 **Phase 5A persistent jar identity bridge**：sales schedule / leftover result 改用 persistent `mjc-inventory` jar IDs，並保存選中 carried jars 的初始 contents metadata；PR #37 當時仍未處理第一次換裝，也不寫回 inventory。
8. PR #39 完成 **Phase 5B1｜庫存編輯器與明確常駐攜帶果汁罐選擇**：可編輯原料、水、乾淨／用過的杯子、架子／罐架與逐罐內容；`PlannerSettings` 的實際程式欄位改為 `carriedJuiceJarIds`，舊數量設定會一次遷移。
9. PR #42 完成 **Data-0｜果汁調和器實測資料同步**：4 筆直接實測果汁調和器配方已進正式 `recipes`，配方評估器會依完整有序原料序列精確覆蓋推導結果；`observedDisplayName`、實測售價與成品特性已鎖進回歸測試，三個需榨汁原料的多層果汁調和製作圖也已回歸確認。這一步沒有擴張候選配方搜尋，也沒有推導果汁調和器通用售價公式。
10. PR #44 完成 **Phase 5B2-1｜既有成品來源追蹤**：finished stock 已固定到 persistent jar，未選為常駐攜帶的果汁罐不會被視為可直接供應來源。
11. PR #45 完成 **Phase 5B2-2/3｜真實初始罐內容與販售排程**：optimizer 與販售排程都會考慮各常駐罐原本裝著什麼、還有幾份；未喝空的既有內容不能為了換裝而被自動丟棄。
12. PR #47 完成 **Phase 5B2-4/5｜果汁成品台接收罐與同罐容量時序**：選定販售排程會產生逐罐實際裝填事件，果汁成品台輸出綁定指定的持久果汁罐 ID、配方與販售趟次前置條件；同一批罐內成品跨多趟販售時會沿用內容，不虛構補裝。
13. PR #50 完成 **Phase 5C-1｜純交易模型**：由已驗證的 optimizer、備料缺口、製作物流與販售排程建立不可變 before / after transaction draft；原料、水、杯具、實體果汁罐與今日供應顧客都有可重算終局，並保留進度／滿意度／正式顧客／planner settings 基準供後續過期驗證。此步驟不修改 storage。
14. PR #52 完成 **Phase 5C-2｜交易預覽介面**：最佳化結果頁會顯示 transaction draft 的原料、水、乾淨／用過杯具、今日供應顧客與實體果汁罐變更前 → 變更後，並列出持久果汁罐的首次裝填／補裝同種／換裝事件與販售趟次前置條件；製作物流不可行時明確不建立交易草稿。預覽仍沒有正式寫入控制。
15. PR #54 完成 **Phase 5C-3｜寫入前過期驗證**：新增純 basis validator 與 read-only stored-basis reader；可重新取得 inventory、進度、滿意度、正式／今日供應顧客與 planner settings 的 canonical 狀態，並固定回報哪些依賴已漂移。legacy progress / satisfaction / carried-jar count 會依現行 migration 等價規則解析，但驗證過程不寫 migration；顧客集合忽略無意義順序差異，而 physical jar 穩定順序與目前的攜帶模式／固定格數仍視為規劃依賴。
16. PR #56 完成 **Phase 5C-4｜一次性完整寫入**：正式套用會在 commit 前重新執行 5C-3 stored-basis validation；stale 時依類別回報並保持零寫入。basis 有效時，transaction after 的 inventory（原料、水、clean / used cups、持久 physical jar 內容與未改動 shelf / jar-rack 欄位）和今日已供應顧客會寫入單一 `mjc-plan-application-state` canonical envelope，只需一次 `localStorage.setItem()`，避免 inventory / supplied customers 跨 key 寫入中途失敗形成 partial state；其他 basis-only 狀態不覆寫。
17. PR #58 完成 **Phase 5C-5｜寫入後刷新與重複套用防護**：成功 commit 後立即把舊 optimizer result / transaction preview 切回 idle，保留成功提示並讓更新後的 inventory 與今日已供應狀態成為下一次規劃輸入；不自動再次執行 HiGHS。相同 transaction draft 第二次提交會被 stored-basis validation 判定 stale，不會再次扣庫存、重複標記顧客或新增 storage write。
18. PR #60 完成 **Candidate-1｜共用候選配方池**：以完整有序原料序列作去重邊界，保留既有 `RecipeCandidate.id`，同一 entry 可同時帶實測／已保存／安全推導／歧義來源；SavedRecipe 會經 canonical evaluator 與進度檢查，invalid saved rows 不進 pool。App、顧客推薦與批次最佳化共用同一份 current-search candidates；saved-only／future-progress entries 目前只保留 metadata，不提前擴大搜尋。
19. PR #62 完成 **Candidate-2A｜單一果汁段漸進搜尋**：不重複原料由淺到深搜尋；顧客頁與批次最佳化共用同一停止規則；只有不重複候選無法保證完全匹配且重複可能改變特性時，才啟用有界的重複調味後備搜尋。
20. PR #64 完成 **Correctness-1｜跨趟果汁罐交換與同配方直接補裝**：planner settings 從 persistent jar ID 綁定改為 `auto`／`fixed-slots`；無果汁罐架時所有持有罐強制隨身，有架時可跨趟整罐上架／換罐，架上既有成品也會納入今日需求；同配方未空罐可直接補裝至容量 10，不同配方仍禁止直接混裝。
21. PR #66 完成 **UX-1｜配方模擬器與批次規劃可讀性**：原料卡直接顯示特性與數值；模擬器可暫選目標顧客並顯示匹配狀態；批次規劃的常見可修正錯誤改用穩定 code + context，UI 顯示中文摘要、限制原因、可操作建議與次要技術資訊。
22. PR #68 完成 **Candidate-2B｜多層果汁調和搜尋**；PR #69 完成 **Correctness-2｜剩餘果汁終局罐需求診斷**；PR #70 完成 **Performance-1｜配方分頁／篩選與批次規劃 render 降載**；PR #72 完成 **Correctness-2B｜明確允許倒掉既有果汁**；PR #74 完成 **Correctness-3｜候選搜尋 consumer 語意拆分**；PR #76 完成 **Objective-1｜批次規劃「最高原料成本」**。Correctness-3 保留 `first-feasible` 的提前停止，並讓顧客完整列表／最低成本推薦／optimizer 改用既有搜尋預算內的 `bounded-exhaustive`；Objective-1 再以實際 customer → recipe assignment 的配方原料成本作研究目標，不以 production `x × ingredientCost` 灌高成本，也不宣稱最高售價／毛利。Candidate-2A / 2B 的候選產生器、搜尋上限、排序、果汁調和器進度 gate、歧義與未知售價邊界都未改動。下一步是 **UX-2A｜果汁罐內容即時搜尋**，之後依序處理 UX-2B｜配方研究與顧客比較介面 → Candidate-3 → Candidate-4。路線最佳化仍等待跨村移動時間、位置資訊、完整顧客服務時段與商店營業時間資料。


## Schedule / route readiness boundary

D5 目前只做到 **schedule normalization + route-readiness**，不實作 route optimizer，因為 source 尚未提供足夠資料。

目前可安全使用的作息資料只有少數顧客觀察：

- `leave_home`：只代表離開家門，**不等於實際離村時間**。
- `outside_village_by`：只代表到該時間時已在村外，不能反推出精確離村時間。
- `return_village`：保留觀察到的約略返村時間；目前新增傑克（帽匠）約 **15:40** 返村觀察，仍不宣稱每日精準固定。
- `HH:MM` 與 `HH:MM～HH:MM` 可轉成 minutes 作排序／比較，但原始字串仍保留；不支援的文字維持 unparsed。

目前 route optimization 明確被以下 source gaps 阻塞：

- 沒有跨村 travel time。
- 沒有 home / shop / customer 的可計算 location identity／座標。
- 大多數顧客沒有完整 service window；目前有 schedule observation 的也不能直接推成完整可服務區間。
- shop hours 未記錄。

因此任何 route / arrival-time / customer-ordering objective 都必須等資料補齊後再實作；網站不會把離家門時間冒充成離村截止時間。
