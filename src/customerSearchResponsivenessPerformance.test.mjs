import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { createServer } from 'vite'
import viteConfig from '../vite.config.ts'

const DRIVER_PORT = 9518
const BASE = '/medieval-juice-crafter-planner/'
const performanceIt = process.env.CI ? it : it.skip

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

async function measureCustomerQuery(sessionId, value, expectedVisibleRows) {
  return executeAsync(
    sessionId,
    `
      const [value, expectedVisibleRows] = arguments
      const done = arguments[arguments.length - 1]
      const input = document.querySelector('input[aria-label="搜尋"]')
      const table = document.querySelector('.customer-table')
      if (!(input instanceof HTMLInputElement) || !table) {
        done({ error: 'customer search input/table missing' })
        return
      }

      const visibleRows = () =>
        table.querySelectorAll(
          ':scope > .customer-row-shell:not([hidden]) > .table-row',
        ).length
      const totalElements = () => table.querySelectorAll('*').length
      const beforeVisibleRows = visibleRows()
      const beforeElements = totalElements()
      const startedAt = performance.now()
      let frame = 0
      let finished = false

      const finish = (timedOut) => {
        if (finished) return
        finished = true
        clearTimeout(timeout)
        cancelAnimationFrame(frame)
        done({
          beforeVisibleRows,
          afterVisibleRows: visibleRows(),
          beforeElements,
          afterElements: totalElements(),
          resultCommitMs: performance.now() - startedAt,
          timedOut,
        })
      }

      const check = () => {
        if (visibleRows() === expectedVisibleRows) {
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
      ).set.call(input, value)
      input.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: value ? 'insertText' : 'deleteContentBackward',
          data: value || null,
        }),
      )
    `,
    [value, expectedVisibleRows],
  )
}

describe('customer search responsiveness performance', () => {
  performanceIt(
    'keeps production-scale search set/clear responsive without remounting rows',
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
        const recipeAuthorityCount = await setProductionScaleState(sessionId)

        const allRows = await waitFor(
          sessionId,
          `
            const table = document.querySelector('.customer-table')
            const count = table?.querySelectorAll(
              ':scope > .customer-row-shell > .table-row',
            ).length ?? 0
            return count > 50 ? count : 0
          `,
        )

        const firstName = await execute(
          sessionId,
          `
            return document.querySelector(
              '.customer-row-shell .primary-cell strong',
            )?.textContent?.trim() || ''
          `,
        )
        expect(firstName).not.toBe('')

        const narrowTimes = []
        const clearTimes = []
        for (let index = 0; index < 3; index += 1) {
          const narrow = await measureCustomerQuery(
            sessionId,
            firstName,
            1,
          )
          expect(narrow.error).toBeUndefined()
          expect(narrow.timedOut).toBe(false)
          expect(narrow.afterVisibleRows).toBe(1)
          expect(narrow.afterElements).toBe(narrow.beforeElements)
          narrowTimes.push(narrow.resultCommitMs)

          const clear = await measureCustomerQuery(
            sessionId,
            '',
            allRows,
          )
          expect(clear.error).toBeUndefined()
          expect(clear.timedOut).toBe(false)
          expect(clear.afterVisibleRows).toBe(allRows)
          expect(clear.afterElements).toBe(clear.beforeElements)
          clearTimes.push(clear.resultCommitMs)
        }

        const narrowMedianMs = median(narrowTimes)
        const clearMedianMs = median(clearTimes)

        console.log('[customer-search-responsiveness]', {
          recipeAuthorityCount,
          allRows,
          narrowMedianMs,
          clearMedianMs,
          narrowTimes,
          clearTimes,
        })

        expect(recipeAuthorityCount).toBeGreaterThan(10_000)
        expect(narrowMedianMs).toBeLessThan(80)
        expect(clearMedianMs).toBeLessThan(120)
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
