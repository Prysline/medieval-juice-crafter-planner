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

export function runOptimizerInWorker(
  request: OptimizationRequest,
  source: OptimizationSource,
  signal?: AbortSignal,
): Promise<OptimizationResult> {
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
      finish(() => {
        if (event.data.ok) {
          resolve(event.data.result)
          return
        }
        reject(deserializeOptimizerWorkerError(event.data.error))
      })
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

    const payload: OptimizerWorkerRequest = { request, source }
    worker.postMessage(payload)
  })
}
