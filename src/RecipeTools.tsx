import { useMemo, useState } from 'react'
import { customers } from './data/customers'
import { ingredients } from './data/ingredients'
import { recipeIngredientCapabilities } from './data/recipeIngredientCapabilities'
import {
  customerIsUnlocked,
  ingredientIsAvailable,
} from './domain/availability'
import { recipeCandidateMatchesCustomer } from './domain/matching'
import {
  combineRecipeSequences,
  evaluateRecipeSequence,
} from './domain/recipeEvaluator'
import {
  formatMoney,
  formatRecipeDisplayName,
  formatRecipeIngredientCost,
  formatRecipeSequence,
} from './domain/displayFormat'
import {
  removeSavedRecipe,
  upsertSavedRecipe,
  writeSavedRecipes,
} from './storage/savedRecipes'
import type {
  ProgressMilestoneId,
  RecipeSequenceEvaluation,
  SavedRecipe,
  SatisfactionByVillage,
} from './types'

interface RecipeToolsProps {
  currentProgress: ProgressMilestoneId
  satisfactionByVillage: SatisfactionByVillage
  savedRecipes: SavedRecipe[]
  onSavedRecipesChange: (recipes: SavedRecipe[]) => void
}

const ingredientById = new Map(
  ingredients.map((ingredient) => [ingredient.id, ingredient]),
)
const capabilityByIngredientId = new Map(
  recipeIngredientCapabilities.map((capability) => [
    capability.ingredientId,
    capability,
  ]),
)

function recipeSourceLabel(evaluation: RecipeSequenceEvaluation): string {
  if (!evaluation.valid) return '無法評估'
  return evaluation.candidate.source === 'observed' ? '實測' : '預測'
}

function ingredientSequenceLabel(ingredientIds: string[]): string {
  if (ingredientIds.length === 0) return '尚未設定'
  return formatRecipeSequence(
    ingredientIds.map((id) => ingredientById.get(id)?.name ?? id),
  )
}

function ingredientRoleLabel(ingredientId: string): string {
  const capability = capabilityByIngredientId.get(ingredientId)
  if (!capability) return ''
  if (capability.roles.includes('juice-base')) return '果汁'
  if (capability.roles.includes('seasoning')) return '調味'
  return ''
}

function makeSavedRecipeId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }
  return `saved-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function RecipeTools({
  currentProgress,
  satisfactionByVillage,
  savedRecipes,
  onSavedRecipesChange,
}: RecipeToolsProps) {
  const [ingredientIds, setIngredientIds] = useState<string[]>([])
  const [blenderFrontIds, setBlenderFrontIds] = useState<string[]>([])
  const [blenderBackIds, setBlenderBackIds] = useState<string[]>([])
  const [saveName, setSaveName] = useState('')
  const [saveNote, setSaveNote] = useState('')

  const evaluation = useMemo(
    () => evaluateRecipeSequence(ingredientIds, currentProgress),
    [ingredientIds, currentProgress],
  )

  const matchingCustomers = useMemo(() => {
    if (
      !evaluation.valid ||
      !evaluation.availableAtCurrentProgress ||
      evaluation.candidate.effectAmbiguity
    ) {
      return []
    }

    return customers
      .filter((customer) =>
        customerIsUnlocked(
          customer,
          currentProgress,
          satisfactionByVillage,
        ),
      )
      .filter((customer) =>
        recipeCandidateMatchesCustomer(
          evaluation.candidate,
          customer,
        ),
      )
  }, [evaluation, currentProgress, satisfactionByVillage])

  function appendIngredient(ingredientId: string) {
    setIngredientIds((current) => [...current, ingredientId])
  }

  function removeIngredientAt(index: number) {
    setIngredientIds((current) =>
      current.filter((_, currentIndex) => currentIndex !== index),
    )
  }

  function persistSavedRecipes(next: SavedRecipe[]) {
    onSavedRecipesChange(next)
    writeSavedRecipes(window.localStorage, next)
  }

  function saveCurrentRecipe() {
    const name = saveName.trim()
    if (!name || !evaluation.valid) return

    const recipe: SavedRecipe = {
      id: makeSavedRecipeId(),
      name,
      ingredientIds: [...evaluation.ingredientIds],
      note: saveNote.trim() || undefined,
      createdAt: new Date().toISOString(),
    }

    persistSavedRecipes(upsertSavedRecipe(savedRecipes, recipe))
    setSaveName('')
    setSaveNote('')
  }

  function updateSavedMetadata(
    recipe: SavedRecipe,
    patch: Pick<Partial<SavedRecipe>, 'name' | 'note'>,
  ) {
    if (patch.name !== undefined && !patch.name.trim()) return

    const nextRecipe: SavedRecipe = {
      ...recipe,
      ...patch,
      name: patch.name === undefined ? recipe.name : patch.name,
      note:
        patch.note === undefined
          ? recipe.note
          : patch.note || undefined,
    }
    persistSavedRecipes(upsertSavedRecipe(savedRecipes, nextRecipe))
  }

  function deleteSavedRecipe(recipeId: string) {
    persistSavedRecipes(removeSavedRecipe(savedRecipes, recipeId))
  }

  function loadSavedRecipe(recipe: SavedRecipe) {
    setIngredientIds([...recipe.ingredientIds])
    setSaveName(recipe.name)
    setSaveNote(recipe.note ?? '')
  }

  function captureBlenderSide(side: 'front' | 'back') {
    if (!evaluation.valid) return
    const sequence = [...evaluation.ingredientIds]
    if (side === 'front') {
      setBlenderFrontIds(sequence)
    } else {
      setBlenderBackIds(sequence)
    }
  }

  function blendSequences() {
    if (blenderFrontIds.length === 0 || blenderBackIds.length === 0) return
    setIngredientIds(
      combineRecipeSequences(blenderFrontIds, blenderBackIds),
    )
  }

  return (
    <section className="recipe-tools" aria-label="配方工具">
      <div className="tool-panel simulator-panel">
        <div className="tool-heading">
          <div>
            <p className="tool-kicker">Recipe Simulator</p>
            <h2>配方模擬器</h2>
          </div>
          <span className="tool-badge">{recipeSourceLabel(evaluation)}</span>
        </div>

        <p className="tool-description">
          直接點原料建立有序配方；重複調味與四原料以上都可評估。第二個果汁基底會形成新的飲料段，整體序列需要果汁調和器。
        </p>

        <div className="sequence-builder">
          <div className="sequence-builder-heading">
            <strong>目前配方順序</strong>
            <span>{ingredientIds.length} 項</span>
          </div>

          {ingredientIds.length === 0 ? (
            <p className="sequence-empty">點下方原料開始建立配方。</p>
          ) : (
            <div className="sequence-strip" aria-label="目前配方順序">
              {ingredientIds.map((ingredientId, index) => {
                const ingredient = ingredientById.get(ingredientId)
                return (
                  <button
                    type="button"
                    className="sequence-chip"
                    key={`${ingredientId}-${index}`}
                    onClick={() => removeIngredientAt(index)}
                    title="點擊移除此項"
                  >
                    <span>{ingredient?.name ?? ingredientId}</span>
                    <small>{index + 1}</small>
                    <b>×</b>
                  </button>
                )
              })}
            </div>
          )}

          <div className="ingredient-palette">
            {ingredients.map((ingredient) => {
              const available = ingredientIsAvailable(
                ingredient,
                currentProgress,
              )
              return (
                <button
                  type="button"
                  key={ingredient.id}
                  disabled={!available}
                  onClick={() => appendIngredient(ingredient.id)}
                >
                  <strong>{ingredient.name}</strong>
                  <span>
                    {ingredientRoleLabel(ingredient.id)}
                    {!available ? ' · 尚未解鎖' : ''}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="sequence-actions">
            <button
              type="button"
              disabled={ingredientIds.length === 0}
              onClick={() =>
                setIngredientIds((current) => current.slice(0, -1))
              }
            >
              移除最後一項
            </button>
            <button
              type="button"
              disabled={ingredientIds.length === 0}
              onClick={() => setIngredientIds([])}
            >
              清空
            </button>
          </div>
        </div>

        <div className="blender-panel">
          <div className="section-title">
            <strong>果汁調和器</strong>
            <span>前方飲料 + 後方飲料</span>
          </div>
          <p>
            先在上方點出一杯飲料，存到前方或後方槽；調和時只做序列串接，後方飲料的原料順序完整接在前方後面。
          </p>

          <div className="blender-slots">
            <div>
              <span>前方飲料</span>
              <strong>{ingredientSequenceLabel(blenderFrontIds)}</strong>
              <button
                type="button"
                disabled={!evaluation.valid}
                onClick={() => captureBlenderSide('front')}
              >
                使用目前序列
              </button>
            </div>
            <div>
              <span>後方飲料</span>
              <strong>{ingredientSequenceLabel(blenderBackIds)}</strong>
              <button
                type="button"
                disabled={!evaluation.valid}
                onClick={() => captureBlenderSide('back')}
              >
                使用目前序列
              </button>
            </div>
          </div>

          <div className="blender-actions">
            <button
              type="button"
              disabled={
                blenderFrontIds.length === 0 ||
                blenderBackIds.length === 0
              }
              onClick={() => {
                setBlenderFrontIds(blenderBackIds)
                setBlenderBackIds(blenderFrontIds)
              }}
            >
              交換前後
            </button>
            <button
              type="button"
              className="primary"
              disabled={
                blenderFrontIds.length === 0 ||
                blenderBackIds.length === 0
              }
              onClick={blendSequences}
            >
              調和為目前序列
            </button>
          </div>
        </div>

        <EvaluationPanel
          evaluation={evaluation}
          matchingCustomers={matchingCustomers}
        />

        <div className="save-recipe-form">
          <label>
            <span>個人配方名稱</span>
            <input
              value={saveName}
              placeholder="例如：檸檬糖＋橙薄荷"
              onChange={(event) => setSaveName(event.target.value)}
            />
          </label>
          <label>
            <span>備註（選填）</span>
            <input
              value={saveNote}
              placeholder="例如：先檸檬糖，再接橙薄荷"
              onChange={(event) => setSaveNote(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={!evaluation.valid || !saveName.trim()}
            onClick={saveCurrentRecipe}
          >
            儲存為個人配方
          </button>
        </div>
      </div>

      <div className="tool-panel saved-recipes-panel">
        <div className="tool-heading">
          <div>
            <p className="tool-kicker">Personal Recipes</p>
            <h2>個人配方</h2>
          </div>
          <span className="tool-badge">{savedRecipes.length} 筆</span>
        </div>

        {savedRecipes.length === 0 ? (
          <p className="empty-tool-state">
            還沒有個人配方。先在上方點出一個序列，再儲存常用名稱與備註。
          </p>
        ) : (
          <div className="saved-recipe-list">
            {savedRecipes.map((recipe) => (
              <SavedRecipeRow
                key={recipe.id}
                recipe={recipe}
                currentProgress={currentProgress}
                satisfactionByVillage={satisfactionByVillage}
                onLoad={() => loadSavedRecipe(recipe)}
                onDelete={() => deleteSavedRecipe(recipe.id)}
                onUpdate={(patch) =>
                  updateSavedMetadata(recipe, patch)
                }
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function EvaluationPanel({
  evaluation,
  matchingCustomers,
}: {
  evaluation: RecipeSequenceEvaluation
  matchingCustomers: typeof customers
}) {
  if (!evaluation.valid) {
    return (
      <div className="evaluation-panel evaluation-invalid">
        <strong>目前序列無法評估</strong>
        <ul>
          {evaluation.issues.map((issue, index) => (
            <li key={`${issue.code}-${issue.ingredientId ?? index}`}>
              {issue.message}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const { candidate, cost } = evaluation

  return (
    <div className="evaluation-panel">
      <div className="evaluation-title">
        <div>
          <strong>{formatRecipeDisplayName(candidate.name)}</strong>
          <span>
            {formatRecipeSequence(candidate.ingredients)} ·{' '}
            {candidate.source === 'observed' ? '實測' : '預測'}
            {evaluation.usesBlender
              ? ` · 調和 ${evaluation.drinkSegmentCount} 段`
              : ''}
          </span>
        </div>
        <span
          className={
            evaluation.availableAtCurrentProgress
              ? 'availability-pill available'
              : 'availability-pill unavailable'
          }
        >
          {evaluation.availableAtCurrentProgress
            ? '目前可用'
            : '目前進度未解鎖'}
        </span>
      </div>

      <dl className="evaluation-grid">
        <div>
          <dt>原料成本</dt>
          <dd>
            {evaluation.usesBlender
              ? `${formatMoney(cost.batchIngredientCost)} 原料合計 · 每杯成本未確認`
              : formatRecipeIngredientCost(
                  cost.batchIngredientCost,
                  cost.unitIngredientCost,
                )}
          </dd>
        </div>
        <div>
          <dt>售價</dt>
          <dd>
            {candidate.salePrice === null
              ? '未知'
              : formatMoney(candidate.salePrice)}
          </dd>
        </div>
        <div>
          <dt>設備</dt>
          <dd>{candidate.equipment.join(' → ')}</dd>
        </div>
        <div>
          <dt>完全匹配顧客</dt>
          <dd>
            {candidate.effectAmbiguity
              ? '同分 cutoff 待確認，暫不判定'
              : matchingCustomers.length > 0
                ? matchingCustomers
                    .map(
                      (customer) =>
                        `${customer.name}（${customer.occupation}）`,
                    )
                    .join('、')
                : '目前沒有'}
          </dd>
        </div>
      </dl>

      <div className="evaluation-effects">
        <strong>
          {candidate.source === 'observed'
            ? '成品特性（實測）'
            : '成品特性（預測）'}
        </strong>
        <div className="tags">
          {candidate.effects.map((effect) => (
            <span className="tag" key={effect.name}>
              {effect.name}（{effect.value}）
            </span>
          ))}
        </div>
      </div>

      {candidate.effectAmbiguity && (
        <div className="ambiguity-box">
          <strong>
            同分候選：剩 {candidate.effectAmbiguity.remainingSlots} 格
          </strong>
          <div className="tags">
            {candidate.effectAmbiguity.candidates.map((effect) => (
              <span className="tag" key={effect.name}>
                {effect.name}（{effect.value}）
              </span>
            ))}
          </div>
          <small>
            tie-break 尚未確認；此配方可以保存，但不宣稱 full match。
          </small>
        </div>
      )}
    </div>
  )
}

function SavedRecipeRow({
  recipe,
  currentProgress,
  satisfactionByVillage,
  onLoad,
  onDelete,
  onUpdate,
}: {
  recipe: SavedRecipe
  currentProgress: ProgressMilestoneId
  satisfactionByVillage: SatisfactionByVillage
  onLoad: () => void
  onDelete: () => void
  onUpdate: (patch: Pick<Partial<SavedRecipe>, 'name' | 'note'>) => void
}) {
  const evaluation = useMemo(
    () => evaluateRecipeSequence(recipe.ingredientIds, currentProgress),
    [recipe.ingredientIds, currentProgress],
  )

  const matchingCustomers = useMemo(() => {
    if (
      !evaluation.valid ||
      !evaluation.availableAtCurrentProgress ||
      evaluation.candidate.effectAmbiguity
    ) {
      return []
    }

    return customers
      .filter((customer) =>
        customerIsUnlocked(
          customer,
          currentProgress,
          satisfactionByVillage,
        ),
      )
      .filter((customer) =>
        recipeCandidateMatchesCustomer(
          evaluation.candidate,
          customer,
        ),
      )
  }, [evaluation, currentProgress, satisfactionByVillage])

  return (
    <article className="saved-recipe-card">
      <div className="saved-recipe-fields">
        <label>
          <span>名稱</span>
          <input
            value={recipe.name}
            onChange={(event) =>
              onUpdate({ name: event.target.value })
            }
          />
        </label>
        <label>
          <span>備註</span>
          <input
            value={recipe.note ?? ''}
            placeholder="無"
            onChange={(event) =>
              onUpdate({ note: event.target.value })
            }
          />
        </label>
      </div>

      {evaluation.valid ? (
        <>
          <div className="saved-recipe-summary">
            <div>
              <strong>{formatRecipeSequence(evaluation.candidate.ingredients)}</strong>
              <span>
                {evaluation.candidate.source === 'observed'
                  ? '實測'
                  : '預測'}
                {' · '}
                {evaluation.availableAtCurrentProgress
                  ? '目前可用'
                  : '目前進度未解鎖'}
                {evaluation.usesBlender ? ' · 果汁調和器' : ''}
              </span>
            </div>
            <span>
              {evaluation.usesBlender
                ? `${formatMoney(evaluation.cost.batchIngredientCost)} 原料合計 · 每杯成本未確認`
                : formatRecipeIngredientCost(
                    evaluation.cost.batchIngredientCost,
                    evaluation.cost.unitIngredientCost,
                  )}
            </span>
          </div>
          <p className="saved-recipe-meta">
            {evaluation.candidate.effectAmbiguity
              ? '同分 cutoff 待確認；暫不參與 full-match recommendation / optimizer。'
              : matchingCustomers.length > 0
                ? `完全匹配：${matchingCustomers
                    .map(
                      (customer) =>
                        `${customer.name}（${customer.occupation}）`,
                    )
                    .join('、')}`
                : '目前沒有已解鎖的完全匹配顧客。'}
          </p>
        </>
      ) : (
        <div className="saved-recipe-invalid">
          此筆個人配方仍保留，但目前 domain 無法評估：
          {evaluation.issues.map((issue) => issue.message).join('；')}
        </div>
      )}

      <div className="saved-recipe-actions">
        <button
          type="button"
          disabled={!evaluation.valid}
          onClick={onLoad}
        >
          載回模擬器
        </button>
        <button
          type="button"
          className="danger-button"
          onClick={onDelete}
        >
          刪除
        </button>
      </div>
    </article>
  )
}

export default RecipeTools
