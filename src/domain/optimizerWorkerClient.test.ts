import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OptimizationRequest } from './optimizer'
import type { OptimizationSource } from './optimizerModel'
import {
  OptimizerWorkerExecutionError,
  OptimizerWorkerRuntimeError,
  PlanningUserError,
} from './planningErrors'
import { runOptimizerInWorker } from './optimizerWorkerClient'

class FakeWorker {
  static latest: FakeWorker | null = null

  onmessage:
    | ((event: MessageEvent<unknown>) => void)
    | null = null
  onmessageerror:
    | ((event: MessageEvent<unknown>) => void)
    | null = null
  onerror: ((event: ErrorEvent) => void) | null = null

  constructor() {
    FakeWorker.latest = this
  }

  postMessage(_message: unknown) {}

  terminate() {}
}

function startWorkerRun() {
  vi.stubGlobal('Worker', FakeWorker)
  const promise = runOptimizerInWorker(
    {} as OptimizationRequest,
    {} as OptimizationSource,
  )
  const worker = FakeWorker.latest
  if (!worker) throw new Error('Fake Worker was not created')
  return { promise, worker }
}

afterEach(() => {
  FakeWorker.latest = null
  vi.unstubAllGlobals()
})

describe('optimizer worker runtime boundary', () => {
  it('classifies Worker onerror as a runtime failure and keeps the original message', async () => {
    const { promise, worker } = startWorkerRun()
    const preventDefault = vi.fn()

    worker.onerror?.({
      message: 'WASM runtime crashed',
      filename: 'optimizerWorker.js',
      lineno: 42,
      colno: 7,
      preventDefault,
    } as unknown as ErrorEvent)

    await expect(promise).rejects.toMatchObject({
      name: 'OptimizerWorkerRuntimeError',
      phase: 'worker-error-event',
      message:
        'WASM runtime crashed\nSource: optimizerWorker.js:42:7',
    })
    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('uses the fallback only when Worker onerror has no message', async () => {
    const { promise, worker } = startWorkerRun()

    worker.onerror?.({
      message: '',
      filename: '',
      lineno: 0,
      colno: 0,
      preventDefault() {},
    } as unknown as ErrorEvent)

    await expect(promise).rejects.toMatchObject({
      name: 'OptimizerWorkerRuntimeError',
      phase: 'worker-error-event',
      message: 'Optimizer worker failed unexpectedly',
    })
  })

  it('classifies message-channel decode failure separately', async () => {
    const { promise, worker } = startWorkerRun()

    worker.onmessageerror?.({} as MessageEvent<unknown>)

    await expect(promise).rejects.toEqual(
      expect.objectContaining<Partial<OptimizerWorkerRuntimeError>>({
        name: 'OptimizerWorkerRuntimeError',
        phase: 'worker-message-error',
        message: 'Optimizer worker response could not be decoded',
      }),
    )
  })

  it('rejects malformed Worker response envelopes as protocol runtime failures', async () => {
    const { promise, worker } = startWorkerRun()

    worker.onmessage?.({
      data: { unexpected: true },
    } as MessageEvent<unknown>)

    await expect(promise).rejects.toMatchObject({
      name: 'OptimizerWorkerRuntimeError',
      phase: 'worker-protocol',
    })
  })

  it('keeps solver PlanningUserError distinct from Worker runtime failure', async () => {
    const { promise, worker } = startWorkerRun()

    worker.onmessage?.({
      data: {
        ok: false,
        error: {
          kind: 'planning',
          code: 'optimizer-no-solution',
          context: { solverStatus: 'infeasible' },
          message: 'solver infeasible',
        },
      },
    } as MessageEvent<unknown>)

    await expect(promise).rejects.toBeInstanceOf(PlanningUserError)
  })

  it('classifies a normally returned unexpected optimizer exception as execution error', async () => {
    const { promise, worker } = startWorkerRun()

    worker.onmessage?.({
      data: {
        ok: false,
        error: {
          kind: 'error',
          message: 'unexpected invariant',
        },
      },
    } as MessageEvent<unknown>)

    await expect(promise).rejects.toBeInstanceOf(
      OptimizerWorkerExecutionError,
    )
  })
})
