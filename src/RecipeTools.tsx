import { useMemo, useState } from 'react'
import { customers } from './data/customers'
import { ingredients } from './data/ingredients'
import {
  recipeIngredientCapabilities,
  type RecipeIngredientRole,
} from './data/recipeIngredientCapabilities'
import {
  customerIsUnlocked,
  ingredientIsAvailable,
} from './domain/availability'
import { recipeCandidateMatchesCustomer } from './domain/matching'
import { evaluateRecipeSequence } from './domain/recipeEvaluator'
import {
  readSavedRecipes,
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
}

const ingredientById = new Map(
  ingredients.map((ingredient) => [ingredient.id, ingredient]),
)

function capabilitiesForRole(role: RecipeIngredientRole) {
  return recipeIngredientCapabilities.filter((capability) =>
    capability.roles.includes(role),
  )
}

const baseCapabilities = capabilitiesForRole('juice-base')
const seasoningCapabilities = capabilitiesForRole('seasoning')

function formatCost(value: number | null): string {
  if (value === null) return '未知'
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function recipeSourceLabel(evaluation: RecipeSequenceEvaluation): string {
  if (!evaluation.valid) return '無法評估'
  return evaluation.candidate.source === 'observed' ? '實測' : '預測'
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
}: RecipeToolsProps) {
  const firstAvailableBase =
    baseCapabilities.find((capability) => {
      const ingredient = ingredientById.get(capability.ingredientId)
      return ingredient
        ? ingredientIsAvailable(ingredient, currentProgress)
        : false
    })?.ingredientId ?? baseCapabilities[0]?.ingredientId ?? ''

  const [ingredientIds, setIngredientIds] = useState<string[]>(() =>
    firstAvailableBase ? [firstAvailableBase] : [],
  )
  const [savedRecipes, setSavedRecipes] = useState<SavedRecipe[]>(() =>
    readSavedRecipes(window.localStorage),
  )
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

  function setBase(ingredientId: string) {
    setIngredientIds((current) => [
      ingredientId,
      ...current.slice(1),
    ])
  }

  function setFirstSeasoning(ingredientId: string) {
    setIngredientIds((current) => {
      const base = current[0]
      if (!base) return ingredientId ? [ingredientId] : []
      if (!ingredientId) return [base]
      return [base, ingredientId]
    })
  }

  function setSecondSeasoning(ingredientId: string) {
    setIngredientIds((current) => {
      const base = current[0]
      const first = current[1]
      if (!base) return []
      if (!first) return [base]
      return ingredientId
        ? [base, first, ingredientId]
        : [base, first]
    })
  }

  function persistSavedRecipes(next: SavedRecipe[]) {
    setSavedRecipes(next)
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
    const nextRecipe: SavedRecipe = {
      ...recipe,
      ...patch,
      name:
        patch.name === undefined
          ? recipe.name
          : patch.name,
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

  const firstSeasoningId = ingredientIds[1] ?? ''
  const secondSeasoningId = ingredientIds[2] ?? ''

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
          目前只支援 1 種果汁基底＋0～2 種不重複調味材料；不模擬果汁調和器或四原料以上配方。
        </p>

        <div className="simulator-inputs">
          <label>
            <span>果汁基底</span>
            <select
              value={ingredientIds[0] ?? ''}
              onChange={(event) => setBase(event.target.value)}
            >
              {baseCapabilities.map((capability) => {
                const ingredient = ingredientById.get(capability.ingredientId)
                if (!ingredient) return null
                const available = ingredientIsAvailable(
                  ingredient,
                  currentProgress,
                )
                return (
                  <option
                    key={ingredient.id}
                    value={ingredient.id}
                    disabled={!available}
                  >
                    {ingredient.name}
                    {!available ? '（尚未解鎖）' : ''}
                  </option>
                )
              })}
            </select>
          </label>

          <label>
            <span>第一調味</span>
            <select
              value={firstSeasoningId}
              onChange={(event) =>
                setFirstSeasoning(event.target.value)
              }
            >
              <option value="">不加入</option>
              {seasoningCapabilities.map((capability) => {
                const ingredient = ingredientById.get(capability.ingredientId)
                if (!ingredient) return null
                const available = ingredientIsAvailable(
                  ingredient,
                  currentProgress,
                )
                return (
                  <option
                    key={ingredient.id}
                    value={ingredient.id}
                    disabled={
                      !available ||
                      ingredient.id === secondSeasoningId
                    }
                  >
                    {ingredient.name}
                    {!available ? '（尚未解鎖）' : ''}
                  </option>
                )
              })}
            </select>
          </label>

          <label>
            <span>第二調味</span>
            <select
              value={secondSeasoningId}
              disabled={!firstSeasoningId}
              onChange={(event) =>
                setSecondSeasoning(event.target.value)
              }
            >
              <option value="">不加入</option>
              {seasoningCapabilities.map((capability) => {
                const ingredient = ingredientById.get(capability.ingredientId)
                if (!ingredient) return null
                const available = ingredientIsAvailable(
                  ingredient,
                  currentProgress,
                )
                return (
                  <option
                    key={ingredient.id}
                    value={ingredient.id}
                    disabled={
                      !available ||
                      ingredient.id === firstSeasoningId
                    }
                  >
                    {ingredient.name}
                    {!available ? '（尚未解鎖）' : ''}
                  </option>
                )
              })}
            </select>
          </label>
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
              placeholder="例如：日常香蕉肉桂"
              onChange={(event) => setSaveName(event.target.value)}
            />
          </label>
          <label>
            <span>備註（選填）</span>
            <input
              value={saveNote}
              placeholder="例如：先糖後薄荷"
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
            還沒有個人配方。先在上方模擬器建立一個序列，再儲存常用名稱與備註。
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
        <strong>目前序列不能用正式模擬器評估</strong>
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
          <strong>{candidate.name}</strong>
          <span>
            {candidate.ingredients.join(' → ')} ·{' '}
            {candidate.source === 'observed' ? '實測' : '預測'}
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
            {formatCost(cost.batchIngredientCost)} / 批 ·{' '}
            {formatCost(cost.unitIngredientCost)} / 杯
          </dd>
        </div>
        <div>
          <dt>售價</dt>
          <dd>
            {candidate.salePrice === null
              ? '未知'
              : candidate.salePrice}
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
                    .map((customer) => customer.name)
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
              <strong>{evaluation.candidate.ingredients.join(' → ')}</strong>
              <span>
                {evaluation.candidate.source === 'observed'
                  ? '實測'
                  : '預測'}
                {' · '}
                {evaluation.availableAtCurrentProgress
                  ? '目前可用'
                  : '目前進度未解鎖'}
              </span>
            </div>
            <span>
              {formatCost(evaluation.cost.batchIngredientCost)} / 批 ·{' '}
              {formatCost(evaluation.cost.unitIngredientCost)} / 杯
            </span>
          </div>
          <p className="saved-recipe-meta">
            {evaluation.candidate.effectAmbiguity
              ? '同分 cutoff 待確認；暫不參與 full-match recommendation / optimizer。'
              : matchingCustomers.length > 0
                ? `完全匹配：${matchingCustomers
                    .map((customer) => customer.name)
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
