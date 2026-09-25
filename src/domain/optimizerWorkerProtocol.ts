import type {
  OptimizationRequest,
  OptimizationResult,
} from './optimizer'
import type { OptimizationSource } from './optimizerModel'
import {
  PlanningUserError,
  type PlanningUserErrorCode,
  type PlanningUserErrorContext,
} from './planningErrors'

export interface OptimizerWorkerWasmRuntimeResponse {
  url: string
  status: number
  contentType: string | null
  magicBytes: number[]
}

export interface OptimizerWorkerRuntimeDiagnostics {
  wasmResponses: OptimizerWorkerWasmRuntimeResponse[]
}

export interface OptimizerWorkerRequest {
  request: OptimizationRequest
  source: OptimizationSource
  collectRuntimeDiagnostics?: boolean
}

export type OptimizerWorkerSerializedError =
  | {
      kind: 'planning'
      code: PlanningUserErrorCode
      context: PlanningUserErrorContext
      message: string
    }
  | {
      kind: 'error'
      message: string
    }

export type OptimizerWorkerResponse =
  | {
      ok: true
      result: OptimizationResult
      runtimeDiagnostics?: OptimizerWorkerRuntimeDiagnostics
    }
  | {
      ok: false
      error: OptimizerWorkerSerializedError
      runtimeDiagnostics?: OptimizerWorkerRuntimeDiagnostics
    }

export function serializeOptimizerWorkerError(
  error: unknown,
): OptimizerWorkerSerializedError {
  if (error instanceof PlanningUserError) {
    return {
      kind: 'planning',
      code: error.code,
      context: error.context,
      message: error.message,
    }
  }

  return {
    kind: 'error',
    message:
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Unknown optimizer worker error',
  }
}

export function deserializeOptimizerWorkerError(
  error: OptimizerWorkerSerializedError,
): Error {
  if (error.kind === 'planning') {
    return new PlanningUserError(
      error.code,
      error.context,
      error.message,
    )
  }
  return new Error(error.message)
}
