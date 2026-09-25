import { runOptimizerRuntimeSmokeInWorker } from './domain/optimizerWorkerClient'
import type {
  OptimizationRequest,
  OptimizationSource,
} from './domain/optimizerModel'
import type { Customer, RecipeCandidate } from './types'

const statusElement = document.querySelector<HTMLElement>(
  '#runtime-smoke-status',
)

function setStatus(
  state: 'running' | 'passed' | 'failed',
  payload: unknown,
) {
  document.documentElement.dataset.runtimeSmoke = state
  if (statusElement) {
    statusElement.dataset.state = state
    statusElement.textContent = JSON.stringify(payload, null, 2)
  }
}

const customer: Customer = {
  id: 'runtime-smoke-customer',
  name: 'Runtime Smoke Customer',
  occupation: '測試',
  villageId: 'east-harbor',
  satisfactionRequired: 0,
  preferences: [{ kind: 'effect', value: '甜味' }],
}

const recipe: RecipeCandidate = {
  id: 'runtime-smoke-recipe',
  name: 'Runtime Smoke Recipe',
  source: 'observed',
  unlockedAt: 'seasoner-unlocked',
  salePrice: 10,
  ingredients: ['檸檬', '糖'],
  effects: [{ name: '甜味', value: 5 }],
  equipment: [],
}

const request: OptimizationRequest = {
  customerIds: [customer.id],
  currentProgress: 'seasoner-unlocked',
  suppliedCustomerIds: [],
  satisfactionByVillage: {
    'east-harbor': 999,
    'tranquil-fountain': 999,
  },
  formalCustomerIds: [customer.id],
  candidatePolicy: 'observed-only',
  objective: 'minimum-cost',
}

const source: OptimizationSource = {
  customers: [customer],
  candidates: [recipe],
}

setStatus('running', { ok: false, stage: 'starting-worker' })

try {
  const response = await runOptimizerRuntimeSmokeInWorker(
    request,
    source,
  )
  const wasmResponses =
    response.runtimeDiagnostics?.wasmResponses ?? []

  if (!response.ok) {
    setStatus('failed', {
      ok: false,
      stage: 'optimizer-error',
      error: response.error,
      wasmResponses,
    })
  } else if (
    response.result.assignments.length !== 1 ||
    response.result.assignments[0]?.customerId !== customer.id ||
    response.result.assignments[0]?.recipeId !== recipe.id
  ) {
    setStatus('failed', {
      ok: false,
      stage: 'unexpected-solution',
      assignments: response.result.assignments,
      wasmResponses,
    })
  } else {
    setStatus('passed', {
      ok: true,
      stage: 'optimizer-solved',
      assignments: response.result.assignments.length,
      totalIngredientCost: response.result.totalIngredientCost,
      wasmResponses,
    })
  }
} catch (error) {
  const message =
    error instanceof Error ? error.stack ?? error.message : String(error)
  setStatus('failed', {
    ok: false,
    stage: 'worker-error',
    error: message,
    wasmResponses: [],
  })
}
