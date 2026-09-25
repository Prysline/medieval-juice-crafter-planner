import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'

const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d]
const DEFAULT_BASE = '/medieval-juice-crafter-planner/'
const DRIVER_PORT = 9515

function parseArgs(argv) {
  const args = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    if (!current.startsWith('--')) continue
    const next = argv[index + 1]
    if (next && !next.startsWith('--')) {
      args.set(current, next)
      index += 1
    } else {
      args.set(current, true)
    }
  }
  return args
}

function normalizedBase(value) {
  const leading = value.startsWith('/') ? value : `/${value}`
  return leading.endsWith('/') ? leading : `${leading}/`
}

function contentType(pathname) {
  const extension = extname(pathname)
  if (extension === '.html') return 'text/html; charset=utf-8'
  if (extension === '.js') return 'text/javascript; charset=utf-8'
  if (extension === '.css') return 'text/css; charset=utf-8'
  if (extension === '.wasm') return 'application/wasm'
  if (extension === '.json') return 'application/json; charset=utf-8'
  return 'application/octet-stream'
}

async function createPagesLikeServer(directory, base) {
  const root = resolve(directory)
  const indexBytes = await readFile(join(root, 'index.html'))

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (!url.pathname.startsWith(base)) {
      response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
      response.end(indexBytes)
      return
    }

    const relativePath = decodeURIComponent(url.pathname.slice(base.length))
    const requestedPath = relativePath || 'index.html'
    const filePath = resolve(root, normalize(requestedPath))

    if (!filePath.startsWith(root)) {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('invalid path')
      return
    }

    try {
      const fileStat = await stat(filePath)
      if (!fileStat.isFile()) throw new Error('not a file')
      const bytes = await readFile(filePath)
      response.writeHead(200, { 'content-type': contentType(filePath) })
      response.end(bytes)
    } catch {
      // Match the production failure mode: a wrong asset URL returns HTML,
      // which must fail the worker's WASM response checks instead of being
      // hidden by a file-existence-only smoke.
      response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
      response.end(indexBytes)
    }
  })

  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(0, '127.0.0.1', () => resolvePromise())
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Pages-like server did not expose a TCP port')
  }

  return {
    server,
    smokeUrl: `http://127.0.0.1:${address.port}${base}highs-runtime-smoke.html`,
  }
}

async function waitForDriver() {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${DRIVER_PORT}/status`)
      if (response.ok) return
    } catch {
      // Driver is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
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

async function readBrowserLogs(sessionId) {
  let lastError
  for (const pathname of [
    `/session/${sessionId}/se/log`,
    `/session/${sessionId}/log`,
  ]) {
    try {
      return await webdriver(pathname, 'POST', { type: 'browser' })
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

function assertActualWasmResponse(payload) {
  const wasmResponses = payload?.wasmResponses
  if (!Array.isArray(wasmResponses) || wasmResponses.length === 0) {
    throw new Error(
      `Optimizer solved but worker did not report its actual WASM response: ${JSON.stringify(payload)}`,
    )
  }

  const wasmResponse = wasmResponses.at(-1)
  if (
    typeof wasmResponse?.url !== 'string' ||
    !wasmResponse.url.includes('.wasm')
  ) {
    throw new Error(
      `Worker reported an invalid WASM request URL: ${JSON.stringify(wasmResponse)}`,
    )
  }

  if (wasmResponse.status !== 200) {
    throw new Error(
      `Actual worker WASM request returned HTTP ${String(wasmResponse.status)}: ${wasmResponse.url}`,
    )
  }

  if (
    typeof wasmResponse.contentType !== 'string' ||
    !wasmResponse.contentType.toLowerCase().includes('application/wasm')
  ) {
    throw new Error(
      `Actual worker WASM response has unexpected content-type ${String(wasmResponse.contentType)}: ${wasmResponse.url}`,
    )
  }

  if (
    !Array.isArray(wasmResponse.magicBytes) ||
    wasmResponse.magicBytes.length !== WASM_MAGIC.length ||
    wasmResponse.magicBytes.some(
      (byte, index) => byte !== WASM_MAGIC[index],
    )
  ) {
    throw new Error(
      `Actual worker WASM response has invalid magic bytes ${JSON.stringify(wasmResponse.magicBytes)}: ${wasmResponse.url}`,
    )
  }

  return wasmResponse
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const directory = args.get('--dir')
  const providedUrl = args.get('--url')
  const base = normalizedBase(
    typeof args.get('--base') === 'string'
      ? args.get('--base')
      : DEFAULT_BASE,
  )

  if (!directory && !providedUrl) {
    throw new Error(
      'Pass either --dir <production-dist> or --url <deployed-smoke-url>',
    )
  }
  if (directory && providedUrl) {
    throw new Error('Use only one of --dir or --url')
  }

  let localServer
  let smokeUrl
  if (directory) {
    const local = await createPagesLikeServer(directory, base)
    localServer = local.server
    smokeUrl = local.smokeUrl
  } else {
    smokeUrl = providedUrl
  }

  const driver = spawn('chromedriver', [`--port=${DRIVER_PORT}`, '--silent'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let driverStderr = ''
  driver.stderr.on('data', (chunk) => {
    driverStderr += chunk.toString()
  })

  let sessionId
  try {
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
          'goog:loggingPrefs': {
            browser: 'ALL',
          },
        },
      },
    })
    sessionId = session.sessionId

    await webdriver(`/session/${sessionId}/url`, 'POST', {
      url: smokeUrl,
    })

    const deadline = Date.now() + 45_000
    let smokeState = 'running'
    let smokeText = ''
    while (Date.now() < deadline) {
      const status = await webdriver(
        `/session/${sessionId}/execute/sync`,
        'POST',
        {
          script:
            "return {state: document.documentElement.dataset.runtimeSmoke || 'running', text: document.getElementById('runtime-smoke-status')?.textContent || ''}",
          args: [],
        },
      )
      smokeState = status.state
      smokeText = status.text
      if (smokeState !== 'running') break
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 150))
    }

    let payload
    try {
      payload = JSON.parse(smokeText)
    } catch {
      payload = { rawText: smokeText }
    }

    if (smokeState !== 'passed') {
      const browserLogs = await readBrowserLogs(sessionId)
      throw new Error(
        [
          `Optimizer worker runtime smoke ended in state ${smokeState}`,
          `Worker payload: ${JSON.stringify(payload)}`,
          `Browser logs: ${JSON.stringify(browserLogs)}`,
        ].join('\n'),
      )
    }

    const wasmResponse = assertActualWasmResponse(payload)

    console.log(
      JSON.stringify(
        {
          smokeUrl,
          optimizerWorker: 'solved',
          wasmRequestUrl: wasmResponse.url,
          httpStatus: wasmResponse.status,
          contentType: wasmResponse.contentType,
          magicBytes: wasmResponse.magicBytes.map((byte) =>
            byte.toString(16).padStart(2, '0'),
          ),
        },
        null,
        2,
      ),
    )
  } finally {
    if (sessionId) {
      try {
        await webdriver(`/session/${sessionId}`, 'DELETE')
      } catch {
        // Best-effort cleanup.
      }
    }
    driver.kill('SIGTERM')
    if (localServer) {
      await new Promise((resolvePromise) => localServer.close(resolvePromise))
    }
    if (driver.exitCode && driver.exitCode !== 0) {
      console.error(driverStderr)
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exitCode = 1
})
