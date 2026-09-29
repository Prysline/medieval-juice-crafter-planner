import type {
  OptimizationRequest,
  OptimizationResult,
} from './optimizer'
import type { OptimizationSource } from './optimizerModel'
import { OptimizerWorkerRuntimeError } from './planningErrors'
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

function runtimeTechnicalMessage(
  error: unknown,
  fallback: string,
): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }
  return fallback
}

function workerErrorEventTechnicalMessage(
  event: ErrorEvent,
): string {
  const message =
    event.message?.trim() ||
    'Optimizer worker failed unexpectedly'
  if (!event.filename) return message

  const line =
    typeof event.lineno === 'number' && event.lineno > 0
      ? `:${event.lineno}`
      : ''
  const column =
    typeof event.colno === 'number' && event.colno > 0
      ? `:${event.colno}`
      : ''
  return `${message}\nSource: ${event.filename}${line}${column}`
}

export function isOptimizerWorkerResponse(
  value: unknown,
): value is OptimizerWorkerResponse {
  if (typeof value !== 'object' || value === null) return false

  const response = value as {
    ok?: unknown
    result?: unknown
    error?: unknown
  }

  if (response.ok === true) {
    return 'result' in response
  }

  if (
    response.ok !== false ||
    typeof response.error !== 'object' ||
    response.error === null
  ) {
    return false
  }

  const error = response.error as {
    kind?: unknown
    code?: unknown
    context?: unknown
    message?: unknown
  }
  if (typeof error.message !== 'string') return false
  if (error.kind === 'error') return true
  if (error.kind !== 'planning') return false

  return (
    typeof error.code === 'string' &&
    typeof error.context === 'object' &&
    error.context !== null
  )
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

    let worker: Worker
    try {
      worker = new Worker(
        new URL('./optimizerWorker.ts', import.meta.url),
        { type: 'module' },
      )
    } catch (error) {
      reject(
        new OptimizerWorkerRuntimeError(
          'worker-start',
          runtimeTechnicalMessage(
            error,
            'Optimizer worker could not start',
          ),
        ),
      )
      return
    }

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
      if (!isOptimizerWorkerResponse(event.data)) {
        finish(() =>
          reject(
            new OptimizerWorkerRuntimeError(
              'worker-protocol',
              'Optimizer worker returned an invalid response envelope',
            ),
          ),
        )
        return
      }
      finish(() => resolve(event.data))
    }

    worker.onmessageerror = () => {
      finish(() =>
        reject(
          new OptimizerWorkerRuntimeError(
            'worker-message-error',
            'Optimizer worker response could not be decoded',
          ),
        ),
      )
    }

    worker.onerror = (event) => {
      event.preventDefault()
      finish(() =>
        reject(
          new OptimizerWorkerRuntimeError(
            'worker-error-event',
            workerErrorEventTechnicalMessage(event),
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
    try {
      worker.postMessage(payload)
    } catch (error) {
      finish(() =>
        reject(
          new OptimizerWorkerRuntimeError(
            'worker-post-message',
            runtimeTechnicalMessage(
              error,
              'Optimizer worker request could not be sent',
            ),
          ),
        ),
      )
    }
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
