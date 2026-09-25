import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const HOST = '127.0.0.1'
const PORT = 4173
const BASE = '/medieval-juice-crafter-planner/'
const SMOKE_URL = `http://${HOST}:${PORT}${BASE}highs-runtime-smoke.html`
const VITE_CLI = resolve('node_modules/vite/bin/vite.js')

async function waitForUrl(url) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, 100),
    )
  }
  throw new Error(`Vite dev server did not become ready: ${url}`)
}

function run(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.once('error', rejectPromise)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      rejectPromise(
        new Error(
          `${command} ${args.join(' ')} failed with code ${String(code)} signal ${String(signal)}`,
        ),
      )
    })
  })
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')

  await Promise.race([
    new Promise((resolvePromise) =>
      child.once('exit', resolvePromise),
    ),
    new Promise((resolvePromise) =>
      setTimeout(resolvePromise, 5_000),
    ),
  ])

  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
  }
}

async function main() {
  const vite = spawn(
    process.execPath,
    [
      VITE_CLI,
      '--force',
      '--host',
      HOST,
      '--port',
      String(PORT),
      '--strictPort',
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  let viteOutput = ''
  vite.stdout.on('data', (chunk) => {
    const message = chunk.toString()
    viteOutput += message
    process.stdout.write(message)
  })
  vite.stderr.on('data', (chunk) => {
    const message = chunk.toString()
    viteOutput += message
    process.stderr.write(message)
  })

  try {
    await waitForUrl(SMOKE_URL)
    await run(process.execPath, [
      'scripts/highs-runtime-smoke.mjs',
      '--url',
      SMOKE_URL,
    ])
  } catch (error) {
    console.error('\n[Vite dev output]\n' + viteOutput)
    throw error
  } finally {
    await stop(vite)
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.stack ?? error.message : error,
  )
  process.exitCode = 1
})
