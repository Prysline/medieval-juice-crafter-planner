import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { createServer } from 'vite'
import viteConfig from '../vite.config.ts'

const DRIVER_PORT = 9517
const BASE = '/medieval-juice-crafter-planner/'
const profileIt = process.env.CI ? it : it.skip

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

async function waitForDriver() {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${DRIVER_PORT}/status`)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('ChromeDriver did not start')
}

async function webdriver(pathname, method = 'GET', body) {
  const response = await fetch(
    `http://127.0.0.1:${DRIVER_PORT}${pathname}`,
    {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    },
  )
  const payload = await response.json()
  if (!response.ok || payload.value?.error) {
    throw new Error(
      `WebDriver ${method} ${pathname} failed: ${JSON.stringify(payload)}`,
    )
  }
  return payload.value
}

function execute(sessionId, script, args = []) {
  return webdriver(
    `/session/${sessionId}/execute/sync`,
    'POST',
    { script, args },
  )
}

function executeAsync(sessionId, script, args = []) {
  return webdriver(
    `/session/${sessionId}/execute/async`,
    'POST',
    { script, args },
  )
}

async function waitFor(sessionId, script, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await execute(sessionId, script)
    if (result) return result
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Browser condition timed out: ${script}`)
}

async function setProductionScaleState(sessionId) {
  await execute(
    sessionId,
    `
      const select = document.querySelector('.progress-settings select')
      if (!select) throw new Error('progress select missing')
      Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        'value',
      ).set.call(select, 'juice-blender-unlocked')
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    `,
  )

  const recipeAuthorityCount = await waitFor(
    sessionId,
    `
      const text = document.querySelectorAll('.tabs button')[1]
        ?.querySelector('span')?.textContent ?? ''
      const count = Number(text.replace(/[^0-9]/g, ''))
      return count > 10000 ? count : 0
    `,
    30_000,
  )

  await execute(
    sessionId,
    `
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      ).set
      for (const input of document.querySelectorAll(
        '.progress-settings input[type="number"]',
      )) {
        setter.call(input, '9999')
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }
      return true
    `,
  )
  await new Promise((resolve) => setTimeout(resolve, 250))
  return recipeAuthorityCount
}

async function setCustomerQuery(sessionId, value, expectedRowCount = null) {
  return executeAsync(
    sessionId,
    `
      const [value, expectedRowCount] = arguments
      const done = arguments[arguments.length - 1]
      const input = document.querySelector('input[aria-label="搜尋"]')
      const table = document.querySelector('.customer-table')
      if (!(input instanceof HTMLInputElement) || !table) {
        done({ error: 'customer search input/table missing' })
        return
      }
      const rowCount = () =>
        table.querySelectorAll(':scope > .customer-row-shell:not([hidden]) > .table-row').length
      const before = rowCount()
      const startedAt = performance.now()
      let frame = 0
      let finished = false
      const finish = (timedOut) => {
        if (finished) return
        finished = true
        clearTimeout(timeout)
        cancelAnimationFrame(frame)
        done({
          before,
          after: rowCount(),
          ms: performance.now() - startedAt,
          timedOut,
        })
      }
      const check = () => {
        const current = rowCount()
        const reachedExpected =
          expectedRowCount === null
            ? current !== before
            : current === expectedRowCount
        if (reachedExpected) {
          finish(false)
          return
        }
        frame = requestAnimationFrame(check)
      }
      const timeout = setTimeout(() => finish(true), 5000)
      frame = requestAnimationFrame(check)
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      ).set.call(input, value)
      input.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: value ? 'insertText' : 'deleteContentBackward',
          data: value || null,
        }),
      )
    `,
    [value, expectedRowCount],
  )
}

async function measureCustomerClearExpansion(
  sessionId,
  expectedRowCount,
) {
  return executeAsync(
    sessionId,
    `
      const [expectedRowCount] = arguments
      const done = arguments[arguments.length - 1]
      const input = document.querySelector('input[aria-label="搜尋"]')
      const table = document.querySelector('.customer-table')
      if (!(input instanceof HTMLInputElement) || !table) {
        done({ error: 'customer search input/table missing' })
        return
      }

      const rowCount = () =>
        table.querySelectorAll(':scope > .customer-row-shell:not([hidden]) > .table-row').length
      const elementCount = () =>
        table.querySelectorAll('*').length
      const beforeRows = rowCount()
      const beforeElements = elementCount()
      const startedAt = performance.now()
      let firstMutationMs = null
      let lastMutationMs = null
      let mutationRecords = 0
      let addedElements = 0
      let frame = 0
      let finished = false

      const observer = new MutationObserver((records) => {
        const now = performance.now() - startedAt
        if (firstMutationMs === null) firstMutationMs = now
        lastMutationMs = now
        mutationRecords += records.length
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              addedElements +=
                1 + node.querySelectorAll('*').length
            }
          }
        }
      })
      observer.observe(table, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['hidden'],
      })

      const finish = (timedOut) => {
        if (finished) return
        finished = true
        clearTimeout(timeout)
        cancelAnimationFrame(frame)
        observer.disconnect()
        done({
          beforeRows,
          afterRows: rowCount(),
          rowsAdded: rowCount() - beforeRows,
          beforeElements,
          afterElements: elementCount(),
          elementsAddedByFinalCount: elementCount() - beforeElements,
          observedAddedElements: addedElements,
          mutationRecords,
          firstMutationMs,
          lastMutationMs,
          resultCommitMs: performance.now() - startedAt,
          timedOut,
        })
      }

      const check = () => {
        if (rowCount() === expectedRowCount) {
          requestAnimationFrame(() => finish(false))
          return
        }
        frame = requestAnimationFrame(check)
      }

      const timeout = setTimeout(() => finish(true), 5000)
      frame = requestAnimationFrame(check)
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      ).set.call(input, '')
      input.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'deleteContentBackward',
          data: null,
        }),
      )
    `,
    [expectedRowCount],
  )
}

describe('customer search clear responsiveness profile', () => {
  profileIt(
    'measures the DOM expansion cost when clearing a narrow customer search',
    async () => {
      const server = await createServer({
        ...viteConfig,
        configFile: false,
        logLevel: 'silent',
        server: {
          ...viteConfig.server,
          host: '127.0.0.1',
          port: 0,
          strictPort: false,
        },
      })
      const driver = spawn(
        'chromedriver',
        [`--port=${DRIVER_PORT}`, '--silent'],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      )
      let driverStderr = ''
      driver.stderr.on('data', (chunk) => {
        driverStderr += chunk.toString()
      })
      let sessionId

      try {
        await server.listen()
        const address = server.httpServer?.address()
        if (!address || typeof address === 'string') {
          throw new Error('Vite server did not expose a TCP port')
        }

        await waitForDriver()
        const session = await webdriver('/session', 'POST', {
          capabilities: {
            alwaysMatch: {
              browserName: 'chrome',
              'goog:chromeOptions': {
                args: [
                  '--headless=new',
                  '--no-sandbox',
                  '--disable-dev-shm-usage',
                  '--disable-background-networking',
                ],
              },
            },
          },
        })
        sessionId = session.sessionId

        await webdriver(`/session/${sessionId}/url`, 'POST', {
          url: `http://127.0.0.1:${address.port}${BASE}`,
        })
        await waitFor(
          sessionId,
          `return Boolean(document.querySelector('input[aria-label="搜尋"]'))`,
        )
        const recipeAuthorityCount =
          await setProductionScaleState(sessionId)

        const allRows = await waitFor(
          sessionId,
          `
            const table = document.querySelector('.customer-table')
            const count = table?.querySelectorAll(
              ':scope > .table-row',
            ).length ?? 0
            return count > 50 ? count : 0
          `,
        )

        const samples = []
        const narrowSamples = []
        for (let index = 0; index < 3; index += 1) {
          const narrow = await setCustomerQuery(
            sessionId,
            '奧克塔維烏斯',
          )
          expect(narrow.error).toBeUndefined()
          expect(narrow.timedOut).toBe(false)
          expect(narrow.after).toBeLessThan(allRows)
          narrowSamples.push(narrow)

          const clear = await measureCustomerClearExpansion(
            sessionId,
            allRows,
          )
          expect(clear.error).toBeUndefined()
          expect(clear.timedOut).toBe(false)
          expect(clear.afterRows).toBe(allRows)
          expect(clear.rowsAdded).toBeGreaterThan(40)
          samples.push(clear)
        }

        console.log('[customer-search-clear-profile]', {
          recipeAuthorityCount,
          allRows,
          narrowMedianMs: median(
            narrowSamples.map((item) => item.ms),
          ),
          clear: {
            firstMutationMedianMs: median(
              samples.map((item) => item.firstMutationMs),
            ),
            resultCommitMedianMs: median(
              samples.map((item) => item.resultCommitMs),
            ),
            rowsAddedMedian: median(
              samples.map((item) => item.rowsAdded),
            ),
            elementsAddedMedian: median(
              samples.map(
                (item) => item.elementsAddedByFinalCount,
              ),
            ),
            observedAddedElementsMedian: median(
              samples.map((item) => item.observedAddedElements),
            ),
            mutationRecordsMedian: median(
              samples.map((item) => item.mutationRecords),
            ),
          },
          samples,
        })

        expect(recipeAuthorityCount).toBeGreaterThan(10_000)
      } finally {
        if (sessionId) {
          try {
            await webdriver(`/session/${sessionId}`, 'DELETE')
          } catch {}
        }
        driver.kill('SIGTERM')
        await server.close()
        if (driver.exitCode && driver.exitCode !== 0) {
          console.error(driverStderr)
        }
      }
    },
    90_000,
  )
})
