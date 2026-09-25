# Medieval Juice Crafter Planner

《Medieval Juice Crafter》繁體中文攻略／販售規劃工具。

目前先解決遊玩途中最常用的查詢：

- 依 **主線進度節點** 與地區解鎖顯示目前可用資料。
- 東港村與靜謐噴泉顧客滿意度分開保存，互不影響。
- 搜尋顧客、職業、喜好、配方、原料與特性。
- 顧客只把「全部喜好都滿足」視為完全匹配。
- 顧客列表可依姓名、最佳完全匹配、最高售價排序。
- 正式顧客狀態與「今日已供應」分開保存；東港村會顯示 14 / 17 名主線進度。
- 顧客頁的「最佳完全匹配」可切換**最低成本／最高成本**；最高成本模式會優先只比較**不重複原料**的完整匹配，只有沒有任何不重複配方能滿足該顧客時才回退到重複原料候選。完整匹配清單套用相同規則並依所選原料成本方向排序，預設只顯示前 8 筆，其餘可展開，並分開顯示已實測與允許無歧義預測的最佳解。
- 配方列表可反查目前已解鎖、且滿意度門檻已達的顧客。
- 正式 observed 配方不以原料數量限制；重複調味／長序列若主要用途是機制研究，仍可留在 research，不因「四原料以上」自動排除正式配方。
- Candidate-2A / PR #62 已建立單一果汁段逐層搜尋；Candidate-2B / PR #68 再加入合法多果汁段搜尋：最多 3 個獨立果汁段、果汁調和深度 2，保留左右順序，並以固定左結合製作樹避免等價樹重複爆炸。Correctness-3 / PR #74 再把搜尋消費語意拆成「第一個可行解（first-feasible）」與「有界完整候選（bounded-exhaustive）」：存在性判定保留提前停止（early stop），顧客完整匹配／推薦與 optimizer 則在既有搜尋預算內比較更深層合法候選。未實測組合仍只推導特性、不推導售價；重複調味後備仍維持單一果汁段。Performance-1 / PR #70 後，配方頁改為每頁最多 50 筆並提供來源／售價篩選，避免 Candidate-2B 候選量造成大量 DOM 卡頓。UX-2A / PR #78 再把果汁罐內容改為可搜尋的 combobox：搜尋目前可用的實測、個人已保存與安全推導配方，每次最多 render 8 筆匹配結果；只存在歧義的推導候選不自動進搜尋，既有未知／舊 recipe ID 仍保留可讀與可清空。
- 配方仍顯示「1 份果汁基準單位」的原料成本與單杯原料成本；果汁成品台 1 份果汁可產出 2 杯，但實際一次機器操作可處理 1～5 份，不再把「2 杯」視為一次固定製作批次。
- 「配方工具」已改為有序原料編排：點原料直接加入，可重複調味、四原料以上、逐項刪除／清空；精確原料順序已有實測資料時以實測結果優先，否則顯示推導結果或歧義。UX-2B / PR #80 後，模擬器另外保留並顯示**完整特性累計（截斷前）**，但 matching 仍只使用實際／可確定成品特性；PR #81 再把單一暫選顧客改成 App session 內的多顧客比較，可從顧客列按「＋ 比較」、跨頁保留、逐筆移除或全部清除。
- 個人配方只保存自訂名稱、有序 ingredient IDs、備註與建立時間；effects、cost、equipment、matching 每次由目前 domain 重新計算。UX-2B / PR #80 後，個人配方卡會直接顯示具體成品特性；有 effect ambiguity 時把「確定成品特性」與「可能特性」分開，不把可能值當成已確定結果。
- 「批次規劃」已重構為 production optimizer：可依序指定主要／次要 lexicographic 目標，包含最低成本、最少浪費、**最高原料成本**、最高已知銷售總額、最高已知毛利、最少機器操作與最少果汁罐換裝。Objective-1 / PR #76 後，「最高原料成本」以實際 customer → recipe assignment 所選配方的原料成本計分，不以 production units 灌高成本；它是配方研究目標，不代表最高售價或最高毛利。Phase 1 結果資訊架構已完成：閱讀順序為 **規劃摘要 → 所需物資 → 製作步驟 → 果汁分配 → 販售排程**；水會以免費取得需求顯示。PR #33 後製作步驟以機器為獨立區塊，每次 1～5 份製作拆成各批 slot flow；原料／果汁／水／output 各自用膠囊顯示，`▸` 只代表配方內部順序，`→` 只代表加工／狀態轉換。Workflow-2 / PR #104 後，每個實際 batch 都可獨立勾選完成，支援任意順序、取消、完成數與「全部取消／重新開始」；進度綁定 exact net production plan fingerprint，重新產生相同 plan 可恢復，不同 plan 不會誤套，且 checklist 只寫 `mjc-production-checklist`，不修改 inventory／optimizer／transaction。 Workflow-3 / PR #106、#108、#110 建立逐顧客正式交付 transaction；Inventory-Intermediate I3 / PR #123 後，交付 checkbox 的完成 authority 改為 canonical `suppliedCustomerIds`，不再由規劃趟次或 physical cursor hard-gate。玩家可依實際供應狀況記錄任意規劃趟次的顧客；這種手動 supplied edit 不會假裝重播該趟 physical events，而會清除 stale execution cursor／whole-plan transaction draft 並要求重新規劃。完整 physical execution authority、atomic group transaction、preparation/fill/discard 與 undo/correction 仍留給後續 Delivery-Order Correctness。
- Debug-D Production P4 / PR #117 完成 optimizer production 收尾：任意 priority ordering、非 cost-first、prefilled jar、finite `maxJarTypeSwitches` 與 certificate 未閉合時的 generic exact fallback 已由整合 regression 鎖定；production-scale `juice-blender-unlocked + allow-unambiguous-computed` 仍精確得到 cost 572 / machine 50 / jar switches 19。CI benchmark 顯示大型 exact solve 仍可能需要十多秒，因此 HiGHS 求解已移到 ES-module Web Worker；主 UI 保持可操作並提供「取消規劃」，取消或輸入狀態變更會直接終止 Worker，不寫入半成品結果。Worker 是 UI safety layer，不取代既有 certificate / generic fallback correctness。
- Inventory-Intermediate I1 / PR #119 已建立**中間果汁 identity + storage 基礎**：尚未經果汁成品台的狀態使用獨立 `juice-state:v1:<ordered ingredient IDs>` identity，絕不冒充 final `recipeId`；`mjc-inventory` 新增以 juice units 記錄的 intermediate stock，舊存檔缺欄位會 normalize 成空集合。whole-plan transaction、partial delivery execution、stale validation 與 execution basis fingerprint 都會保留／比較這批庫存，避免未來 I2/I3 接入後被既有 commit path 靜默清空。I1 **尚未**讓 production graph 消費這些庫存，也沒有新增 UI；那分別屬於 I2 / I3。
- Inventory-Intermediate I2 / PR #121 已把既有中間果汁接進 **production graph stock offset**：finalizer 需求會從最深尚未完成的 juice-state 節點反向展開；若 exact intermediate stock 已存在，就在該節點停止上游展開，因此可跳過已完成的榨汁、調味或調和。shared prefix 與 Blender 重複 input 共用同一全域 stock pool，不會把同 1 juice unit 重複使用。`PreparationShortfall` 的 raw ingredient 需求改由 stock-offset net graph 推導，`productionLogistics` 也會把既有 intermediate stock 放進實體一般架／背包材料模型，讓後續機器直接接著做；finalizing 與其用水不會因未 finalizing stock 被跳過。I2 本身仍**不修改持久庫存**。Inventory-Intermediate I3 / PR #123 已接上可搜尋的中間果汁庫存 UI，以及 whole-plan／partial-delivery transaction consumption：兩條路徑共用 I2 已規劃的 stock usage authority 與 per-recipe / per-unit provenance，只扣實際規劃使用量並保留未使用 stock；完整 partial execution 的終局庫存與 whole-plan transaction 已由 regression 鎖定一致。v1 仍不把本次新製作但未使用的 intermediate output 自動持久化。
- Core model correction 2B 已把 physical jar identity 接進多趟販售 schedule。Phase 2 capacity contract 也已完成：`mjc-inventory` 保存原料、水、clean / used cups、一般架子數、果汁罐架數與每個 physical jar；PR #39 / Phase 5B1 後批次規劃已有實際 Inventory editor，可逐罐設定 recipe identity / servings。`mjc-planner-settings` 現在保存果汁罐攜帶策略 `juiceJarCarryMode`、固定格數 `reservedJuiceJarSlots` 與 used-cup drop opt-in；舊的 `carriedJuiceJarIds`／count 只會遷移成固定格數，不再保留特定實體罐綁定。沒有果汁罐架時，所有持有的實體果汁罐都必須隨身；有果汁罐架後，規劃器可在各趟之間整罐上架／取出，固定模式只固定果汁罐占用格數，自動模式則依每趟需求計算攜帶數。
- Inventory / packing D1～D4 與 Phase 4 cup lifecycle 已建立：`PreparationDemand` 消費 production-unit optimizer 結果，已有 stock offset、single-trip packing 與 physical-jar-aware multi-trip replenishment；販售排程現在會用玩家實際持有的 clean / used cups，逐杯追蹤 clean → used stack transition，不再固定預留 1 slot。PR #32 先把 optimizer `leftoverServings` 保留在同一實體罐；PR #37 再把 sales schedule 的 plan-local 罐號改成 persistent `mjc-inventory` jar ID，並攜帶該罐規劃前的 `recipeId / servings` metadata。剩餘成品仍不能跨罐倒果汁；果汁罐只能整罐移動，居家放置只使用果汁罐架。Correctness-2B / PR #72 允許玩家明確 opt-in 時倒掉達成可行性所需的既有內容；Debug-C / PR #86 再把同一 opt-in 擴充到**本次新製作後無法保留的最少殘餘量**。顧客已分配杯數永遠不丟；成品台仍先依合法偶數產量完整裝入實體罐，販售後才在記錄的趟次結束時倒掉殘餘。transaction preview 會分開標示「既有內容」與「本次新製作殘餘」。
- PR #140 完成 terminal leftover correctness 與趟次後置：批次規劃摘要的「剩餘杯」改以實際販售排程的 `totalLeftoverServings` 為 authority；若某實體果汁罐在較早趟次完成最後販售並保留成品，後續趟次即使不再攜帶該罐，期末內容仍會保留並在販售排程明示。排程會另外嘗試把會形成 terminal leftover 的 load 延後，但只有在趟數、丟杯／倒果汁、必要洗杯用水、換罐次數與同一 physical jar 的 load sequence 都不變且 capacity 仍可行時才採用；否則保留原 baseline。
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
    recipes.ts         # 正式已確認配方；直接實測且需依完整有序原料序列覆蓋推導結果即可收錄，不以原料數量限制
    recipeResearch.ts  # 重複調味、長序列與售價／特性規則等機制研究；不以原料數量作分界
    recipeIngredientCapabilities.ts # v1 果汁基底／調味材料能力邊界
    stages.ts          # 攻略閱讀章節，不作 runtime availability
  domain/
    availability.ts    # 集中式 progress / village / satisfaction availability
    customerList.ts    # 顧客排序與今日供應顯示純函式
    customerState.ts   # 正式顧客狀態與分村計數
    customerRecommendation.ts # 單人最佳 full-match recommendation：最低／最高原料成本模式、成本排序
    matching.ts        # 完全／部分匹配；ambiguous computed 不宣稱 full match
    recipeCost.ts      # 批次／單杯原料成本
    recipeEvaluator.ts # 單一有序序列 validation / observed overlay / computed evaluation
    recipeIdentity.ts  # UX-2A：final computed recipe 的 computed:<ordered ingredient IDs> 穩定持久 identity
    juiceStateIdentity.ts # Inventory I1：未 finalizing 的中間果汁狀態 identity；與 final recipeId 明確分離
    recipeGenerator.ts # Candidate-2A/2B：建立單一果汁段與合法多果汁段搜尋層，再交由 evaluator 評估
    recipeSearch.ts    # 共用搜尋：first-feasible／bounded-exhaustive；trusted-only 只讀正式實測＋已確認個人配方，不展開 generated computed search
    recipeCandidatePool.ts # 依完整有序序列合併來源；PR #112 後 authority = observed > personal > computed，並保存 saved provenance / 搜尋層資訊
    listFilters.ts     # UX-2B：顧客／配方研究 filter 的純判定；確定特性與 ambiguity 可能特性分開
    optimizerModel.ts  # optimizer request、recipe→eligible customer reverse index 與 gating；Debug-B 共用 jar-switch lower bound
    optimizerCertificates.ts # Debug-DP1/P2/P3：Stage 1 cost certificate；Stage 2 machine witness helpers；Stage 3 finalizing identity / distinct-kind proof helpers
    jarSwitches.ts      # initial-content-aware optimizer lower bound + PR #98 terminal-aware physical sequence exact planner
    optimizerSolver.ts # 可替換的 async solver adapter contract
    optimizerHighsSolver.ts # HiGHS WASM lexicographic MIP adapter；Debug-DP1 Stage 1 exact cost certificate；DP2 exact machine certificate；DP3 在 cost→machine→jar 且 proof gate 閉合時用 production-unit / finalizing / jar LB=UB certificate + fixed-x verification；其他情況 generic fallback
    optimizerWorkerProtocol.ts # P4：Worker request/result/error 序列化契約；PlanningUserError 可跨執行緒還原
    optimizerWorker.ts # P4：背景執行 optimizeBatchPlan / HiGHS
    optimizerWorkerClient.ts # P4：建立／終止 Worker、AbortSignal 取消與 stale-run 防護
    optimizer.ts       # recipe production plan / shopping list / metrics normalization
    productionPlan.ts  # shared-prefix production graph / 1～5 stack machine operations；Inventory I2 由 finalizer 需求反向套用 deepest-first intermediate stock offset
    optimizerUi.ts     # UI 預設需求集合：已解鎖、今日未供應、正式／潛在篩選
    inventoryRules.ts  # 已確認的背包／一般架／果汁罐／罐架／水／乾淨杯具容量常數
    inventoryCapacity.ts # ownership / carried jars / shelf / rack staging 的 capacity summary
    preparationDemand.ts # OptimizationResult → 全天 gross 備料需求
    preparationShortfall.ts # 既有成品／raw / intermediate inventory → 實際新製作與缺口；Inventory I2 的原料需求由 stock-offset net graph 推導
    productionLogistics.ts # stock-offset net production → backpack / shelf / machine / water / 指定實體果汁罐接收時序；Inventory I2 會把既有 intermediate stock 作為實體起始材料
    planApplicationTransaction.ts # 規劃結果 → 不可變 before / after 交易草稿；Inventory I3 依 PreparationShortfall.intermediateStockUsage 扣除 planned intermediate stock 並保留未使用量；不寫 storage
    planApplicationValidation.ts # transaction basis 與目前 canonical 狀態的純 stale / mismatch 比對
    purchaseSources.ts # 已知購買來源、最低價／同價保留 decision
    singleTripPacking.ts # 販售趟 finished-drink jars + clean cups 最小必要 slot / overflow
    multiTripReplenishment.ts # 持久果汁罐 ID、初始內容、多趟販售、實際裝罐時序、leftover / discard 與杯具 policy；PR #96 initial-match preservation；PR #98 以 terminal-aware exact sequence plan 驅動多配方 physical jar queue
    deliveryExecution.ts # Workflow-3A：physical sales plan → partial execution trace；Inventory I3 依既有 per-unit provenance 在實際 preparation 時消耗 planned intermediate stock，同一 prepared trip 不重複扣除
    scheduleRouteReadiness.ts # 作息觀察 normalization 與 route-data blockers
  storage/
    plannerState.ts    # localStorage 讀寫、正式顧客與 legacy migration
    savedRecipes.ts    # 個人配方 schema validation / CRUD；PR #112 可選保存玩家確認的 final-effect snapshot
    inventoryState.ts  # mjc-inventory schema normalization / storage；Inventory I1 保存 canonical intermediate juice units，legacy 缺欄位 → {}
    plannerSettings.ts # mjc-planner-settings：persistent carried jar IDs、legacy count migration 與 used-cup drop opt-in
    productionChecklist.ts # Workflow-2：mjc-production-checklist；exact production-plan fingerprint + batch completion progress，純玩家進度、不改 domain state
    planApplicationBasis.ts # read-only canonical basis 重建與 stored transaction stale validation
    planApplicationState.ts # Workflow-3B 後為 plan-application-state-v2：inventory + supplied customers + plan-bound delivery execution cursor 的單一 canonical envelope；仍可讀 v1
    planApplicationCommit.ts # Phase 5C-4：full-plan commit 前 stale validation + single-write transaction commit
    deliveryExecutionCommit.ts # Workflow-3B：partial delivery atomic single-write；Inventory I1 後 intermediate stock 也納入 canonical basis fingerprint
  types.ts             # 共用 domain / data 型別
  App.tsx              # 顧客／配方／配方工具／批次規劃頁籤；UX-2B shared customer comparison + research filters
  RecipeTools.tsx      # Recipe Simulator + Personal Recipes UI；UX-2B 完整特性累計／多顧客比較；PR #112 個人實測確認
  OptimizerTools.tsx   # 批次規劃控制項／結果 UI；PR #112 預設 trusted-only；Workflow-2 production checklist；Workflow-3C 個別顧客 delivery checklist / partial replan；PR #114 配方標題群組 checkbox；PR #117 以 Worker 背景求解並可取消
  styles.css
  main.tsx             # React 入口
  **/*.test.ts         # domain / storage regression tests
```

Candidate-2A / PR #62 已把固定深度枚舉改成**單一果汁段漸進搜尋**：不重複原料最多 4 種，重複調味後備最多 6 個總原料；單段每層 2048、總計 4096 candidates。Candidate-2B / PR #68 在同一套 progressive search 上加入**合法多果汁段搜尋**：最多 3 個獨立果汁段、Blender depth 2；兩段總 seasoning depth 0～4，三段 0～2；每個 blend layer 最多 6000、blended unique 總計 11000 candidates。這些數字都是網站搜尋預算，不是遊戲規則。Blender 左右輸入順序保留，三段搜尋只保留與現行 production graph 一致的 left-deep canonical tree；Blender 未解鎖時候選可留在 metadata，但不進目前搜尋。全部 unique structure 都找不到保證完全匹配後，才進 Candidate-2A 的單段 repeated-seasoning fallback。Correctness-3 / PR #74 不修改上述候選產生器／搜尋預算，而是拆分消費端語意：`first-feasible` 用於存在性判定並保留提前停止；`bounded-exhaustive` 讓顧客完整列表、最低成本推薦與 optimizer 在既有搜尋層／預算內持續比較合法候選，不會因較淺層先出現完全匹配就漏掉較深層候選。Candidate-1 / PR #60 的共用候選配方池仍以完整有序原料序列去重；PR #112 再把來源 authority 明確拆成 **正式實測 observed > 玩家已確認 personal > computed**。個人配方單純「已保存」不等於可信證據：只有玩家明確確認目前顯示的最終成品特性與遊戲一致後，才保存 `confirmedResult` snapshot 並以 `personal` 參與 trusted planning；舊 saved recipe 沒有 snapshot 仍保留但不自動升格。同序列若已有正式 observed，正式資料一定覆蓋 personal snapshot。Performance-1 / PR #70 先把大型配方列表改為分頁＋篩選，並暫時把果汁罐內容限制為目前可用的實測／個人已保存配方。UX-2A / PR #78 已取代這個暫時限制：果汁罐內容改為 searchable combobox，可即時搜尋實測、已保存與安全推導配方，單次最多顯示 8 筆；完整名稱／完整原料序列／完整 ID 精確命中優先，避免短配方被大量較長候選擠出結果。只存在 `ambiguous-computed` 的未保存候選不自動列入；既有未知／legacy jar content 不會被清掉，仍以原 recipe ID 顯示並可由玩家明確清空。安全推導配方的持久 identity 明確固定為 `computed:<ordered ingredient IDs>`，只依 canonical 有序原料 ID，不依 generator layer、搜尋排序、budget 或顯示名稱，因此既有 inventory schema 不需 migration。

手動配方模擬器使用有序原料順序：重複調味與四原料以上都可評估；每遇到新的需榨汁原料就開始下一個果汁段。兩杯果汁經果汁調和器組合時，網站只做 `front.sequence + back.sequence`，不另造果汁調和器專用配方格式。含多個需榨汁原料的序列至少需要實際程式進度 key `juice-blender-unlocked`，設備需求會包含果汁調和器。UX-2B / PR #80 後，`RecipeSequenceEvaluation` 另外保存完整有序原料在 slot cutoff 前的全部 effect totals，供研究與配方改良比較；這些總值**不會回灌 `candidate.effects`、matching 或 optimizer**。PR #81 把目標顧客改成 App-level session comparison，可同時比較多位顧客並跨主頁籤保留，但不寫入 localStorage。PR #82 再加入顧客村落／喜好原料／喜好特性與全部／任一喜好條件篩選，以及配方原料總數／具體原料／確定特性／可能特性／來源／售價篩選；村落仍是硬範圍，全部／任一只套用喜好條件。

果汁調和器已確認 **1:1:1** 數量模型：果汁 A ×q + 果汁 B ×q → 調和果汁 ×q，q = 1～5；機器為 2 個輸入 + 1 個輸出，共 **3 個機器格位**。兩個輸入已確認只要是果汁類即可。直接實測也支持：完整原料順序串接後，成品特性沿用同名累加、`slotCount`、高值排序與最後貢獻位置優先；仍未知的是果汁調和器通用售價公式，以及同值且同最後貢獻位置時的次級排序規則。現行配方模擬器已能串接完整原料順序；Phase 3 已把多果汁段與果汁調和步驟接入製作圖。

特性預測目前採用實測最支持的模型：

```text
slotCount = min(5, 不重複原料種類數 + 1)
```

同名特性先累加，再依總值取最高欄位；總值同分時，較晚加入原料所提供／最後貢獻的特性優先。若套用這層規則後，截斷位置仍有同分且最後貢獻位置相同的候選，才保留歧義，不自行發明次級排序。推導配方的售價仍維持未知。三原料以上的遊戲內預設名稱已確認為「最高特性 + 隨機詞彙」；完整實測名稱不是穩定識別資訊，因此 repo 以穩定原料順序名稱作網站名稱，截圖實測完整名稱另存實際欄位 `observedDisplayName`，不實作隨機名稱產生器。

未確認的遊戲機制不會直接寫成正式配方或最佳化公式。

## Production optimizer domain

optimizer request 會帶入主線進度、分村滿意度、今日已供應顧客、candidate policy，以及有順序的 lexicographic priorities。domain 自己透過既有 availability / matching gate 過濾顧客與配方，不把正確性只交給 UI。PR #112 後批次規劃 UI 預設為 `trusted-only`：**只使用正式實測配方＋已確認個人配方，不展開 generated computed candidate search**；第二個模式才使用「正式實測＋已確認個人配方＋無歧義預測」。舊 `observed-only` contract 仍保留給既有 caller / regression。

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

Phase 3 的 production logistics 會從 stock offset 後的實際新製作量建立 net production graph，並驗證 backpack ↔ general shelf ↔ machine 的搬運可行性。Workflow-1 / PR #102 後，單次規劃 trace 內已改成 **location-aware material state**：一般架與背包各自保存 material state，物品只有經過明確 movement action 才能在兩者之間移動；機器 intermediate output 一律先「機器 → 背包」，只有容量真的需要時才透過明確「背包 → 一般架」動作暫存。raw ingredient / water 仍因現行 inventory 不保存跨 session 的每件物品精確位置，而在規劃起點視為 home supply、以 shelf-first deterministic placement 初始化。能一次裝進背包的本輪 primary inputs 會先 batch preload；容量不足時才分輪補貨，並保留先把已備妥 machine input 裝入機器、騰格後再取得下一 input 的可行操作。finalizer 成品仍直接交給實際存在的 physical juice jar receiver；jar-rack staging 只提供位置，不代表額外擁有果汁罐。

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
- `productionLogistics.ts` 產生 deterministic feasible trace；Workflow-1 / PR #102 後，一般架與背包 material state 已真正分離，並新增「一般架 → 背包」「背包 → 一般架」明確 movement。machine intermediate output 先進背包，不再由 snapshot 事後自動歸到架子；input 進機器後會釋放原背包 storage，operation 失敗時 shelf / backpack / action / fetch counters 會 transactionally rollback。
- 能容納時，raw ingredients 與 production water 會在第一個 machine operation 前 batch preload；容量不足時才分輪補貨。水仍依當下背包 free slots 取得；沒有 route / seller distance 資料的原料取得只記 acquisition action，不假裝成已知往返趟數。
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
22. PR #68 完成 **Candidate-2B｜多層果汁調和搜尋**；PR #69 完成 **Correctness-2｜剩餘果汁終局罐需求診斷**；PR #70 完成 **Performance-1｜配方分頁／篩選與批次規劃 render 降載**；PR #72 完成 **Correctness-2B｜明確允許倒掉既有果汁**；PR #74 完成 **Correctness-3｜候選搜尋 consumer 語意拆分**；PR #76 完成 **Objective-1｜批次規劃「最高原料成本」**；PR #78 完成 **UX-2A｜果汁罐內容即時搜尋**；PR #80～#82 完成 **UX-2B｜配方研究與顧客比較介面**；PR #84～#86 完成 **Batch-Debug A～C**。Debug-A 修正原料庫存 availability；Debug-B 收斂 jar-switch lower bound / physical schedule authority 並補 internal error；Debug-C 讓明確 discard opt-in 也可處理無終局容器的新製作殘餘，且 transaction preview 區分來源。
23. PR #89 完成 **Debug-D Production P1｜Stage 1 exact cost certificate**：optimizer eligibility 改為 recipe→customer reverse index；HiGHS stage 只建立 objective / fix 真正需要的結構；minimum-cost 為第一層且沒有 identity-sensitive jar hard feasibility 時，先做 strict-cost dominance，再以每個 service set 的最低成本代表解 Stage 1，固定成本後恢復 equal-cost 真實 recipe identities。production-scale regression 鎖定 9,253 matched recipes → 4,996 strict frontier → 539 representatives、minimum cost = 572、48 / 48 reconstruction；不符合 certificate gate 時保留 generic fallback。
24. PR #91 完成 **Debug-D Production P2｜Stage 2 exact machine certificate**：只有 P1 exact cost certificate 已成功、目前 sole fix 為 cost、下一 objective 為 machine operations，且 continuation frontier 足夠大時才嘗試。三個互斥子問題提供 through-seasoning 20 + blending 9 + finalizing 21 = **50** 的 exact lower bound；same-service-set + same-cost recipe-unit transfer 只作 witness search，最後必須回完整 binary-assignment / all-edge / fixed-x model 驗證 objective = 50、48 / 48 reconstruction 才接受。certificate 未閉合或模型較小時維持 generic exact solver；grouped / relaxed assignment 不全域啟用。CI #482：40 test files / 306 tests passed、production build success。
25. PR #93 完成 **Debug-D Production P3｜Stage 3 exact jar certificate**：只在 P1 / P2 certificate 都成功、active fixes 恰為 cost → machine、初始果汁罐全空且沒有 finite jar-switch hard limit時嘗試。production-unit lower-bound probe 證明 cost 572 下只能有 24 production units（要求至少 25 時 relaxed lower bound cost = 581）；P2 finalizing LB = 21，加上 continuation recipes 的 finalizing edge 與 final recipe identity 一對一，推出至少 21 種 final recipe kinds。jar LB 再交給既有 `jarSwitches.ts` authority；本 fixture 兩個空罐得到 **19**，而 P2 verified witness 的 jar UB 也是 **19**。最後完整 binary-assignment / all-edge / fixed-x Stage 3 驗證 optimal = 19、48 / 48 reconstruction。prefilled jar、proof 未閉合或其他 unsupported sequence 均 generic fallback；不把「兩個空罐」硬編成全域規則。PR CI #486：40 test files / 309 tests passed、production build success；main CI #487 同樣 40 / 309 與 build success。
26. PR #95 完成 **顧客最佳完全匹配 hotfix**：推薦從固定「最低成本完全匹配」改為「最佳完全匹配」，可切換最低／最高原料成本；完整匹配清單按同一成本方向排序，預設顯示前 8 筆並可展開其餘配方，清單同時顯示原料成本與已知售價。預設仍是最低成本；不改候選搜尋、matching、optimizer 或售價推導規則。CI #491：40 test files / 311 tests passed、production build success。
27. PR #96 完成 **果汁罐 initial-match 排程第一階段 hotfix**：physical jar allocator 先保留仍有需求的初始同配方匹配，並為 terminal leftover recipe 優先保留同配方實體罐；這修掉部分 greedy recipe-order 額外切換，但後續實測仍出現 expected 12 / realized 14，證明舊的 initial-content-aware formula 本身在 prefilled + terminal leftover 情境只是一個 lower bound，不是全域可實現 minimum。CI #493：40 test files / 313 tests passed、production build success。
28. PR #98 完成 **terminal-aware physical jar scheduling correctness hotfix**：既有成品仍先抵銷顧客需求，但同配方多個實體罐改為優先清空杯數較少的罐，最大化可重用 physical jar。新增 exact physical sequence planner：matching current type／空罐可取得 switch-free first recipe；terminal leftover recipe 必須是該 physical jar 最後一種配方；planner 直接產生全局 sequence 與 exact minimum，再由 multi-trip scheduler 轉成 chunks / trips。physical consistency 現在比較 terminal-aware exact minimum，不再把舊 initial-content-aware lower bound 當全域 exact authority。最小反例已鎖定：prefilled A/B、A/B 都成為 terminal leftover、另需 C 時，舊 lower bound = 1，但 exact physical minimum = 2。舊 lower-bound function 仍保留給 optimizer / 已證明 applicability 的 certificate；P3 的 all-empty-jar proof gate 不受影響。CI #497：41 test files / 317 tests passed、production build success。
29. PR #100 完成 **2026-09-23 實測配方資料同步**：依直接截圖新增 7 筆 observed recipes：香蕉▸薄荷（35）、檸檬▸糖▸肉桂（42）、香蕉▸薄荷▸糖（47）、梨▸薄荷▸糖▸肉桂（70）、橙子▸糖▸薄荷▸肉桂（67）、紅蘿蔔▸薄荷▸糖▸肉桂（66）、香蕉▸薄荷▸糖▸肉桂（73）。杯中圖示依直接實測規則「由下往上＝由早到晚加入」還原；列表型截圖依原料欄左→右記錄。實測售價、完整成品特性與 `observedDisplayName` 均已鎖進 data / evaluator regression；不新增 computed sale-price 公式。CI #501：41 test files / 319 tests passed、production build success。
30. PR #102 完成 **Workflow-1｜製作物流物理化**：`productionLogistics.ts` 將一般架／背包 material state 正式拆開；新增顯式架上取物／放回架子 movement；machine intermediate output 固定先回背包；能裝下時 raw ingredients + production water 於第一個 machine operation 前 batch preload，容量不足才分輪補貨。保留 machine input 先裝入後騰背包格、finalizer → physical jar receiver、transactional rollback 等既有物理規則。CI #506：41 test files / 322 tests passed、`productionLogistics.test.ts` 13 tests、production build success。
31. PR #104 完成 **Workflow-2｜製作步驟 checkbox**：新增 `mjc-production-checklist` 純進度 storage；exact net production plan canonical payload 直接作 stable fingerprint，不使用可能 collision 的短 hash；每個 machine batch 以 `step.key#batchIndex` 作 operation identity，可任意順序勾選／取消、顯示完成進度並全部重置。相同 plan 重新產生後可恢復；不同 plan 不套用舊完成狀態。checkbox persistence 與 `mjc-inventory`、`mjc-plan-application-state`、optimizer result / transaction 完全分離。CI #513：42 test files / 329 tests passed；`productionChecklist.test.ts` 6 tests、`OptimizerTools.test.tsx` 8 tests、production build success（1.78 s）。
32. PR #106 完成 **Workflow-3A｜partial delivery execution trace**：把既有 physical sales plan 轉成可逐步執行的純 domain trace。每趟第一次正式交付前才套用該趟需要的 initial-juice discard、production fills、對應原料／production water 與洗杯；每位顧客各自消耗指定 physical jar 1 杯與 1 個 clean cup，並依同一 backpack capacity 規則逐杯決定 clean → used 或 drop；本趟最後一位完成後才執行 trip-end new-production discard。**趟次必須依序；同一 active trip 內未交付顧客可任意順序。**完整執行後的 inventory 已用 regression 證明與現行 whole-plan transaction 終態一致；另鎖定「上一趟賣空後、下一趟同配方仍是 refill-same-type」的歷史 recipe edge。CI #519：43 test files / 334 tests passed；`deliveryExecution.test.ts` 5 tests、production build success（1.24 s）。
33. PR #108 完成 **Workflow-3B｜atomic partial commit**：`mjc-plan-application-state` 升級為 v2 canonical envelope，單一 key 同時保存 inventory、`suppliedCustomerIds` 與 plan-bound delivery execution cursor；仍可讀既有 v1。每次 partial delivery 只做一次 canonical `setItem`，cursor 同時保存當下 inventory + supplied customers 的 basis fingerprint；下一次提交若 canonical state 已漂移即拒絕。從其他 UI 手動改 inventory／今日已供應會清除 in-flight cursor；部分送貨後若重新求解，新 plan 只有在 basis 精確等於目前 canonical state 且使用 initial cursor 時才能接管舊 session，不重播已提交事件。CI #524：44 test files / 343 tests passed；`deliveryExecutionCommit.test.ts` 9 tests、production build success（1.83 s）。
34. PR #110 完成 **Workflow-3C｜delivery checklist UI / partial replan**：`果汁分配` 改為逐顧客正式交付 checkbox。只有目前 active trip 的未交付顧客可提交，同趟可任意順序；後續趟維持可見但 disabled。已正式提交顧客顯示 checked + disabled，不能用取消 checkbox 逆轉 physical transaction；顧客頁「今日已供應」與此處共用同一 canonical supplied-customer authority。每次勾選直接走 Workflow-3B atomic commit，同步 inventory、physical jar、cup lifecycle、`suppliedCustomerIds` 與 execution cursor；partial commit 自己造成的 parent/local canonical 同步由 bounded guard 接受，其他手動／外部 canonical 變更仍使舊 plan 失效。第一筆 partial delivery 後舊 whole-plan apply draft 立即失效，避免重複扣物資；可按「依目前狀態重新規劃剩餘顧客」，由新 plan 從目前 canonical state 建立 initial cursor 並接管 execution session。CI #530：44 test files / 348 tests passed；`OptimizerTools.test.tsx` 13 tests、production build success（1.50 s）；冗餘 delivery dynamic-import 警告已清除。
35. PR #112 完成 **Trusted Personal Recipes｜正式實測＋已確認個人配方**：`SavedRecipe` 可選保存玩家明確確認的 `confirmedResult` final-effect snapshot；舊 saved recipe 不需 migration，也不會因已保存就自動升格為可信 optimizer evidence。候選 authority 固定為 `observed > personal > computed`；同序列正式實測永遠優先。批次規劃預設新增 `trusted-only`，只使用正式實測＋已確認個人配方，完全不展開 generated computed search；第二個模式才加入無歧義預測。含 effect ambiguity 的預測不能用確認捷徑升格。CI #536：44 test files / 352 tests passed、production build success（1.93 s），既有 production-scale optimizer certificate regression 全數維持通過。
36. PR #114 完成 **Delivery UI Minimal｜配方群組 checkbox**：`果汁分配` 每個配方標題前新增群組 checkbox，個別顧客 checkbox 保留。群組全部已提交時 checked + disabled；部分完成時顯示 mixed；若該配方目前所有尚未交付顧客都符合既有 individual delivery gate，可一次提交目前未交付顧客。單人／群組操作共用同一 commit path。**本切片刻意不解除 `nextTripNumber` hard gate、不做跨趟自由送客、不做 undo、不新增單一 write 的 atomic group transaction，也不重構 trip-bound preparation / fill / discard authority。**若同一配方仍有後續趟顧客被現行 gate 擋住，群組 checkbox 暫時 disabled。CI #540 retry：44 test files / 356 tests passed、`OptimizerTools.test.tsx` 17 tests、production build success（1.90 s）；第一次 #540 為既有 optimizer 5 秒 timeout，同一 head 未改碼重跑即全綠。
37. PR #116 完成 **顧客最高成本不重複原料優先**：`maximum` 推薦與完整匹配清單先只比較不重複原料的 full match；只有該顧客在目前 policy 下完全沒有不重複 full match 時，才保留 repeated-ingredient fallback。最低成本、候選生成器、repeat fallback 本身與批次 optimizer 語意不變。新增 regression 鎖住「更貴的重複配方不得壓過可用 unique full match」與「無 unique full match 時仍可 fallback」。
38. PR #117 完成 **Debug-D Production P4｜ordering / fallback / benchmark / cleanup**：整合 solver regression 鎖住 jar-first 等任意 priority ordering，不會暗中強制 cost-first；另以 4,000-recipe synthetic fixture 驗證 machine certificate 無法閉合時會安全回到 generic exact model。production-scale Blender workload 維持精確 cost = 572、machine operations = 50、jar switches = 19；CI #552 中 production solve 約 13.8 秒、synthetic generic fallback 約 20.4 秒。因這種 exact solve 仍足以阻塞瀏覽器事件迴圈，PR #117 只把 `optimizeBatchPlan` / HiGHS 搬到 ES-module Web Worker，後續 preparation / physical jar scheduling / logistics / transaction 仍沿既有主流程；UI 可取消，設定變更／unmount 會終止 stale Worker，且 `PlanningUserError` 會跨 Worker 邊界還原。46 test files / 363 tests passed，production build success（Vite 1.51 s）；build 已實際輸出獨立 optimizer Worker chunk 與 HiGHS WASM。PR #88 仍只作 profiling / prototype archive，不直接 merge。
39. PR #119 完成 **Inventory-Intermediate I1｜canonical juice-state identity + storage**：新增 `juice-state:v1:<ordered ingredient IDs>` 表示尚未 finalizing 的果汁狀態，與 final `recipeId` 分離；`InventoryState.intermediateJuiceUnits` / `mjc-inventory` 以 juice units 保存這些庫存，legacy 缺欄位會 normalize 成 `{}`， malformed / non-canonical identity 不會進 canonical state。whole-plan transaction 與 partial-delivery execution 都會保留 intermediate stock，plan stale validation 與 delivery execution basis fingerprint 也會把它視為 inventory authority。CI #561：47 test files / 368 tests passed、production build success；squash merge 後 main CI #562 success、Pages #166 build + deploy success。I1 刻意不做 production graph stock offset、UI 或實際消耗。
40. PR #121 完成 **Inventory-Intermediate I2｜production graph stock offset**：以 finalizer demand 反向展開 production graph，exact intermediate stock 會優先滿足最深已完成節點，只有不足量才繼續展開 producer edge；因此可跳過已完成的 juicing / seasoning / blending。shared-prefix stock 與 Blender 重複 input 使用單一全域 allocation，不會 double-consume。`PreparationShortfall` raw ingredient shortfall 改由 net graph 推導；`productionLogistics` 會把現有 intermediate stock 放入 home-material physical state，讓後續 operation 直接接續。finalizing / water 仍保留。初版 CI #565 暴露「無 intermediate stock 也強制重建 graph」會破壞 legacy fake-fixture boundary，修正為只有實際有正數 intermediate stock 時啟用 I2 path；未增加 timeout。final-head CI #567：47 test files / 376 tests passed、production build success；squash merge 後 main CI #568 success、Pages #168 build + deploy success。I2 刻意不做 UI 與 intermediate stock transaction consumption。
41. PR #124 完成 **2026-09-24 實測配方資料同步**：依 9 張直接遊戲截圖還原 ordered ingredient sequence；單一直排由下往上，多直排則從最底層橫列起、每列由右往左後再逐列往上。新增 8 筆 canonical observed recipes：梨→肉桂（35）、橙子→香蕉（31）、梨→香蕉（34）、梨→紅蘿蔔（28）、橙子→香蕉→檸檬（46）、梨→紅蘿蔔→檸檬（42）、梨→肉桂→檸檬（49）、梨→香蕉→紅蘿蔔→薄荷（73）；售價、成品特性與畫面實測名稱均保存。第 9 張為既有 `檸檬→紅蘿蔔→薄荷→糖→梨`，再次確認售價 80 與相同特性，但隨機詞從既有「衝擊」變成「慶典」，因此不新增第二個 recipe identity，也不覆蓋既有 `observedDisplayName`。新實測同時顯示：已入選且同值的特性在畫面中的次級排列仍可能與目前 prediction 排列不同；只把實測 overlay 當 exact authority，不據此發明未知的次級排序公式。
42. PR #123 完成 **Inventory-Intermediate I3｜UI + transaction**：批次規劃新增可搜尋的中間果汁庫存編輯；whole-plan transaction 依 `PreparationShortfall.intermediateStockUsage` 扣除既有 intermediate stock，partial-delivery 使用 I2 已固定的 per-recipe / per-unit provenance，在實際 preparation 時只扣一次同一 planned allocation。regression 鎖定只消耗規劃使用量、保留未使用 remainder，以及完整 partial execution／whole-plan 終局庫存一致。交付 checkbox 改以 canonical `suppliedCustomerIds` 作完成 authority；manual supplied edit 會使舊 physical execution cursor / transaction draft 失效而非重播趟次。prepared physical jar load 不得跨 sales trips 拆分；`maximum-ingredient-cost` eligibility 也排除 repeated-ingredient candidate，避免以重複同一原料灌高研究成本。PR-head CI #614 成功後 squash merge 為 `615c98bacef2594a85b993fbd5df41f3a7f9e2bd`。
43. Stage 6 實測資料同步：丹尼爾喜好確認為奶香／保護心臟／促進消化；階段六門檻確認為東港村滿意度 525 + 靜謐噴泉滿意度 25，達標後寄信給爺爺並在收到回信後解鎖「高級悲劇清洗台」。木匠售價 1000，信中直接說明一次可清洗 5 個杯子。這次曾在一大早寄信後約 15:00 收到回信，但因任務曾延遲一天才完成，回信等待時間仍標記未確認，不寫成固定同日／隔日規則；高級清洗台實際清洗水量也尚未確認。本次只同步 progression / customer / equipment data，不改既有杯具物流與清洗計算。
44. Stage 7 實測資料同步：階段七門檻確認為東港村顧客 29 + 靜謐噴泉顧客 15，達標後寄信給爺爺並在收到回信後解鎖「高級柑橘榨汁機」。木匠售價 1200；信件只明確說明新設備可節省柑橘榨汁時間，實際每批容量、處理時間與效率倍率尚未確認，因此不修改現有柑橘榨汁 production rule。回信時間目前有兩次接近 6 小時的觀察：08:4X→14:00、09:XX→15:00；「約 6 小時後回信」先記為強烈推測，太晚寄信是否會順延到隔天仍待直接跨日實測。
45. 新增直接實測配方 **護心 暗影**：依既有杯中圖示讀序規則（多直排從最底層橫列開始、每列由右往左，再逐列往上）還原為 `橙子 → 糖 → 薄荷 → 肉桂 → 梨`。售價 92；成品特性為保護心臟 5、甜味 5、促進消化 4、調節血糖 4、芳香 4。因序列同時含橙子與梨，作為果汁調和器 canonical observed recipe；同步 exact overlay regression，不外推 Blender 通用售價公式。
46. 補上靜謐噴泉顧客 **奧克塔維烏斯（領主）**的直接實測喜好：肉桂、改善視力、煥亮肌膚。`肉桂` 以 ingredient preference 保存，另外兩項以 effect preference 保存；原本 `preferences: null` 改為 canonical observed data，並新增 regression。

**Inventory-Intermediate I1～I3 已完成。**目前下一步是 **Delivery-Order Correctness**；其後依序 Candidate-3 → Candidate-4 → Phase 6 → Candidate-5。PR #88 維持 Draft prototype-only，不直接 merge。路線最佳化仍等待跨村移動時間、位置資訊、完整顧客服務時段與商店營業時間資料。


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
