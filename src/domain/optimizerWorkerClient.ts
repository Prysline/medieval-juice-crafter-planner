import type {
  OptimizationRequest,
  OptimizationResult,
} from './optimizer'
import type { OptimizationSource } from './optimizerModel'
import {
  deserializeOptimizerWorkerError,
  type OptimizerWorkerRequest,
  type OptimizerWorkerResponse,
} from './optimizerWorkerProtocol'

export class OptimizerWorkerCancelledError extends Error {
  constructor() {
    super('Optimizer worker cancelled')
    this.name = 'OptimizerWorkerCancelledError'
  }
}

export function isOptimizerWorkerCancelledError(
  error: unknown,
): error is OptimizerWorkerCancelledError {
  return error instanceof OptimizerWorkerCancelledError
}

function runOptimizerWorkerRaw(
  request: OptimizationRequest,
  source: OptimizationSource,
  signal: AbortSignal | undefined,
  collectRuntimeDiagnostics: boolean,
): Promise<OptimizerWorkerResponse> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new OptimizerWorkerCancelledError())
      return
    }

    const worker = new Worker(
      new URL('./optimizerWorker.ts', import.meta.url),
      { type: 'module' },
    )
    let settled = false

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', handleAbort)
      worker.terminate()
      callback()
    }

    const handleAbort = () => {
      finish(() => reject(new OptimizerWorkerCancelledError()))
    }

    worker.onmessage = (
      event: MessageEvent<OptimizerWorkerResponse>,
    ) => {
      finish(() => resolve(event.data))
    }

    worker.onerror = (event) => {
      finish(() =>
        reject(
          new Error(
            event.message || 'Optimizer worker failed unexpectedly',
          ),
        ),
      )
    }

    signal?.addEventListener('abort', handleAbort, { once: true })

    const payload: OptimizerWorkerRequest = {
      request,
      source,
      collectRuntimeDiagnostics,
    }
    worker.postMessage(payload)
  })
}

export async function runOptimizerInWorker(
  request: OptimizationRequest,
  source: OptimizationSource,
  signal?: AbortSignal,
): Promise<OptimizationResult> {
  const response = await runOptimizerWorkerRaw(
    request,
    source,
    signal,
    false,
  )

  if (response.ok) return response.result
  throw deserializeOptimizerWorkerError(response.error)
}

export function runOptimizerRuntimeSmokeInWorker(
  request: OptimizationRequest,
  source: OptimizationSource,
  signal?: AbortSignal,
): Promise<OptimizerWorkerResponse> {
  return runOptimizerWorkerRaw(request, source, signal, true)
}
