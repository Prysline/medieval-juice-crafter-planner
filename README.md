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
- 「批次規劃」已重構為 production optimizer：可依序指定主要／次要 lexicographic 目標，包含最低成本、最少浪費、最高已知銷售總額、最高已知毛利、最少機器操作與最少果汁罐換裝。Phase 1 結果資訊架構已完成：閱讀順序為 **規劃摘要 → 所需物資 → 製作步驟 → 果汁分配 → 販售排程**；水會以免費取得需求顯示，製作步驟按機器分組並拆出 machine slots / 每次 1～5 份操作。
- Core model correction 2B 已把 physical jar identity 接進多趟販售 schedule。Phase 2 capacity contract 也已完成：`mjc-inventory` 會保存一般架子數、果汁罐架數與每個 physical jar；`mjc-planner-settings` 另保存常駐攜帶果汁罐數與「接受背包滿時 used cup 可能掉落」opt-in。常駐攜帶罐會固定占背包 slot，ownership、carrying 與 jar-rack staging 不再混成同一個數字。
- Inventory / packing D1～D4 已建立：`PreparationDemand` 消費 production-unit optimizer 結果，已有 stock offset、single-trip packing 與 multi-trip replenishment；現行 `retain-and-wash` 固定預留 1 slot 仍是 approximation，Phase 4 才會改成實際 clean / used cup lifecycle。
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
    inventoryRules.ts  # 已確認的背包／一般架／果汁罐／罐架／水／乾淨杯具容量常數
    inventoryCapacity.ts # ownership / carried jars / shelf / rack staging 的 capacity summary
    preparationDemand.ts # OptimizationResult → 全天 gross 備料需求
    preparationShortfall.ts # 既有成品／raw inventory → 實際新製作與缺口
    purchaseSources.ts # 已知購買來源、最低價／同價保留 decision
    singleTripPacking.ts # 販售趟 finished-drink jars + clean cups 最小必要 slot / overflow
    multiTripReplenishment.ts # physical jar schedule、多趟販售、常駐攜帶 jar slot 與杯具 policy
    scheduleRouteReadiness.ts # 作息觀察 normalization 與 route-data blockers
  storage/
    plannerState.ts    # localStorage 讀寫、正式顧客與 legacy migration
    savedRecipes.ts    # 個人配方 schema validation / CRUD
    inventoryState.ts  # mjc-inventory schema normalization / storage
    plannerSettings.ts # mjc-planner-settings：常駐攜帶罐數與 used-cup drop opt-in
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

果汁調和器已確認 **1:1:1** 數量模型：果汁 A ×q + 果汁 B ×q → 調和果汁 ×q，q = 1～5；機器為 2 個 input + 1 個 output，共 **3 slots**。目前仍未確認的是可接受果汁類型的完整限制、調和後特性與售價規則。現行 simulator 已能做 sequence concatenation，但 automatic production planner 尚未把這個 quantity model 接入 production graph。

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

V1 自動 optimizer 目前仍只接受「一個 juice-base + seasoning chain」的 production-safe 配方。這是**現行實作缺口**，不是遊戲規則未知：果汁調和器已確認 sequence concatenation 與 1:1:1、q = 1～5 的 quantity model；下一輪要把 blending edge 正式接入 production graph 後，才能讓多 juice-base 配方進自動份數最佳化。

HiGHS solver 使用真正的 lexicographic repeated solve，不使用隱藏權重。可指定的 criterion 包含：

- `minimum-cost`
- `minimum-waste`
- `maximum-known-revenue`
- `maximum-known-gross-profit`
- `minimum-machine-operations`
- `minimum-jar-switches`

果汁罐換裝定義為「同一罐從一種最終果汁改裝成另一種」；空罐第一次裝入與補裝同種類不算。忽略既有預裝內容時，若方案有 `K` 種最終果汁、規劃中有 `J` 個**常駐攜帶 physical jars**，最低換裝數為 `max(0, K - J)`。Phase 2 後 UI 會分開設定「實際持有果汁罐」與「常駐攜帶果汁罐」；optimizer 只接收 ownership / backpack capacity 正規化後的 effective carried jar count，另可指定 `maxJarTypeSwitches` hard constraint。

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
- 杯子／乾淨悲劇：**10 / stack**；`cleanCups + usedCups` 代表玩家目前實際持有杯具總數，但「實際持有杯數」何時限制全天／單趟服務量仍留到 Phase 4。
- 果汁罐：**1 罐 = 1 slot / 容量 10 / 同罐不混不同飲料**；每個 `juiceJars[]` item 都代表一個 actual physical jar，空罐也保留 identity。
- 果汁罐架：**5 slots / 架**；Phase 2 已改為 `jarRackCount × 5` staging capacity，與 physical jar 持有數、常駐攜帶數分開。一般架則為 `shelfCount × 9` slots。

machine slots 與「一次可處理 1～5 份」是兩個不同概念：

- 柑橘榨汁機／榨汁機：1 input + 1 output = **2 slots**。
- 調味器：果汁 input + 調味材料 input + output = **3 slots**。
- 果汁成品台：果汁 input + 水 input + output = **3 slots**。
- 悲劇清洗台：used cup input + 水 input + clean cup output = **3 slots**。
- 果汁調和器：果汁 A input + 果汁 B input + output = **3 slots**，已確認 1:1:1、q = 1～5。

D2 的 single-trip packing 仍只負責單趟 required / overflow 計算；**多趟拆分已由 D4 完成**，不再是「後續 slice」。D3 會先用 `mjc-inventory` 中同 recipe 的既有成品抵 assigned servings，再重算新製作 juice units、原料與 production water，並以 raw ingredient / water / clean cups inventory 抵扣缺口。一般 packing 不重新求解顧客配方分配；只有會影響 final-juice kind selection 的果汁罐換裝條件，才把必要 container summary 回饋給 optimizer。

購買來源只使用目前資料中明確的 seller / shop 價格：若只有一個最低價來源可唯一選擇；同價則保留所有 source records，不加入路線或距離 tie-break。`Ingredient.seller` 與 `shops.ts` 若名稱相同，目前也不自行推定為同一實體商店，等後續 location identity 更完整再處理。


## Multi-trip replenishment boundary

D4 只處理從家出發、賣完回家的**販售趟**。它不加入顧客 schedule、跨村時間或 route objective，也不重新修改 optimizer recipe assignment。

used-cup handling 必須明確選 policy：

- `retain-and-wash`：預設策略；現行 runtime 每趟固定預留 1 slot 給 used-cup stack，非最後一趟回家後洗回 clean cups 再重用。這仍是 **packing approximation**，不是最終杯具物理模型。
- `allow-drop-if-full`：Phase 2 已改成 persisted **opt-in**；departure 可使用完整 10 slots，背包滿時只接受 used cups **可能掉落**。這不代表玩家能主動把物品丟地上作 storage。
- 目前選用的 policy 必須產生可行排程；替代 policy 若因容量不可行，只顯示不可行原因，不會反過來讓已選策略整體失敗。

Phase 2 也把「physical jar ownership」「常駐攜帶數」「jar-rack staging」拆開。常駐攜帶 `X` 個果汁罐時，**每一趟都固定占 X 個背包 slots**，即使某趟只有部分罐實際裝果汁；因此多帶空罐可能減少換裝，卻同時壓縮杯具／其他搬運空間。jar rack staging capacity 則獨立為 `jarRackCount × 5`。

Core model correction 2B 已把 physical jar identity 接進 D4 schedule。每個 load 都記錄實際果汁罐編號、optimizer 已通過 full-match gate 的顧客 IDs，以及「首次裝填／補裝同種／換裝」狀態；同一 physical jar 在同一趟只會出現一次。當果汁種類多於**常駐攜帶罐數**時，新增果汁種類會串到既有 jar queue 上，讓 schedule 實際實現 `max(0, 果汁種類數 - 常駐攜帶罐數)` 的最低換裝數；當攜帶罐數足夠時，額外空罐可平行承擔同一種果汁的多個容量 10 load，而不製造假換裝。

販售 schedule 不重新計算喜好匹配，而是直接沿用 optimizer 的 customer → recipe full-match assignment，再依果汁罐容量把顧客切進對應 jar load；因此 UI 可以直接說明每一罐要服務哪些「完整符合」顧客。若 preparation demand 的 assigned servings 與 customer IDs 數量不一致，schedule 會拒絕產生。

`jarTypeSwitches` 與 `tripCount` 現在都從**同一份可行 physical jar schedule** 取得：換裝數可從 schedule 逐罐重算，趟數就是 schedule 的 trip 數；optimizer UI 會再檢查 downstream schedule 的換裝數與 recipe-assignment solver 回報一致，若漂移則停止顯示結果。兩種 used-cup policy 仍各自建 schedule，因此趟數不同時會分開顯示，不合併成沒有 policy 語意的單一數字。

trip grouping 仍是 deterministic capacity-first feasible planning；它目標是產生可解釋、符合 physical jar ownership / carried-jar / backpack / cup constraints 的共同排程。`jarRackCount × 5` 是獨立 staging capacity，不再作 D4 單趟固定上限；**目前仍不宣稱已做最少趟數的全域最佳化**。


## Next planner corrections

Phase 1｜Planner result information architecture 已於 PR #22 完成；Phase 2｜Inventory / capacity contract 已於 PR #24 完成。

Phase 2 已完成：

- `mjc-inventory` 新增 `shelfCount`、`jarRackCount`，physical jars 仍以逐罐 identity 保存；clean + used cups 可得目前實際杯具總數。
- 一般架 capacity = `shelfCount × 9`；果汁罐架 staging = `jarRackCount × 5`；兩者都不與背包／machine slots 相加成單一 capacity。
- `mjc-planner-settings` 保存「常駐攜帶果汁罐」與 used-cup drop opt-in；常駐攜帶數受 physical jar ownership 限制。
- 常駐果汁罐會永久占用背包 slots；D4 不再把「單一 5-slot rack」當每趟 jar 上限。
- used-cup drop 預設關閉；選用策略必須可行，替代策略可以只顯示「目前不可行」。
- optimizer 先提供最小 capacity controls；完整原料／杯具／罐內容 inventory editor 仍留到 Phase 5。

接下來從 **Phase 3｜Production logistics** 繼續，不先做 route optimizer：

1. 建立 **背包 ↔ 一般架子 ↔ machine input/output slots** 的 deterministic feasible logistics sequence；三者不能簡單相加成總 slot。
2. 把取水納入搬運：水源有距離、取得量受當下背包空間限制，可先搬回一般架子，再分批製作。
3. production step 驗證 input 搬入 machine 後釋放原 storage、output 產生後重新占 machine / backpack / shelf 空間。
4. 把已確認的 Blender **1:1:1、q = 1～5** 正式接入 production graph。
5. Phase 4 再用實際 clean → used cup transition 取代固定 1-slot approximation；Phase 5 / 6 再做完整 inventory UI、Apply Plan 與 profiles。


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
