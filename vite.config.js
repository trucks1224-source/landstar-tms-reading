import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { processRoadMilesRequest } from './api/road-miles.js'
import { processDatRateRequest, getDatConfig } from './api/dat-rate.js'
import { handleParamountEmail } from './api/_lib/gmailThread.js'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  for (const key of ['GOOGLE_MAPS_API_KEY', 'DAT_USERNAME', 'DAT_PASSWORD', 'DAT_USER_USERNAME', 'DAT_AUTH_BASE', 'DAT_RATECAST_URL',
    'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) {
    if (!process.env[key] && env[key]) {
      process.env[key] = env[key]
    }
  }

  return {
    server: {
      host: '127.0.0.1',
      watch: {
        ignored: (file) => file.includes('browser-profile')
      }
    },
    plugins: [
      react(),
      {
        name: 'road-miles-api',
        configureServer(server) {
          // "Bot off" light in the TMS header -> starts the upload bot in its own window.
          // Only this computer's TMS can call it (the dev server listens on 127.0.0.1 and
          // requests from other web pages are refused by the Origin check).
          let lastBotStart = 0
          // "Helper off" light -> starts the helper bot (bot/helper.js) in its own window.
          let lastHelperStart = 0
          server.middlewares.use('/api/helper/start', async (req, res) => {
            const reply = (status, body) => {
              res.statusCode = status
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(body))
            }
            if (req.method !== 'POST') return reply(405, { error: 'Use POST.' })
            const origin = req.headers.origin
            if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
              return reply(403, { error: 'Only the TMS on this computer can start the helper bot.' })
            }
            if (process.platform !== 'win32') return reply(501, { error: 'Starting the helper bot only works on Windows.' })
            if (Date.now() - lastHelperStart < 30_000) return reply(200, { ok: true, starting: true })
            lastHelperStart = Date.now()
            const botDir = path.resolve(process.cwd(), 'bot')
            const launcher = path.join(botDir, 'Start Helper Bot.bat')
            try {
              const child = spawn('cmd.exe', ['/c', `start "Landstar Helper Bot" "${launcher}"`], {
                cwd: botDir, detached: true, stdio: 'ignore', windowsVerbatimArguments: true
              })
              child.on('error', error => console.error('Could not start the helper bot:', error))
              child.unref()
              reply(200, { ok: true, started: true })
            } catch (error) {
              console.error('Could not start the helper bot:', error)
              lastHelperStart = 0
              reply(500, { error: 'The helper bot could not be started. Double-click Start Helper Bot.bat in the bot folder.' })
            }
          })

          server.middlewares.use('/api/bot/start', async (req, res) => {
            const reply = (status, body) => {
              res.statusCode = status
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(body))
            }
            if (req.method !== 'POST') return reply(405, { error: 'Use POST.' })
            const origin = req.headers.origin
            if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
              return reply(403, { error: 'Only the TMS on this computer can start the bot.' })
            }
            if (process.platform !== 'win32') return reply(501, { error: 'Starting the bot from the TMS only works on Windows.' })
            try {
              const running = await fetch('http://127.0.0.1:47615/status', { signal: AbortSignal.timeout(1000) })
              if (running.ok) return reply(200, { ok: true, alreadyRunning: true })
            } catch { /* not running */ }
            if (Date.now() - lastBotStart < 30_000) return reply(200, { ok: true, starting: true })
            lastBotStart = Date.now()
            const botDir = path.resolve(process.cwd(), 'bot')
            const launcher = path.join(botDir, 'Start Landstar Bot.bat')
            try {
              const child = spawn('cmd.exe', ['/c', `start "Landstar Bot" "${launcher}"`], {
                cwd: botDir,
                detached: true,
                stdio: 'ignore',
                windowsVerbatimArguments: true
              })
              child.on('error', error => console.error('Could not start the Landstar bot:', error))
              child.unref()
              reply(200, { ok: true, started: true })
            } catch (error) {
              console.error('Could not start the Landstar bot:', error)
              lastBotStart = 0
              reply(500, { error: 'The bot could not be started. Double-click Start Landstar Bot.bat in the bot folder.' })
            }
          })

          // Paramount tracking emails (reply-all on the rate confirmation thread, and
          // replies to watch for). Only this computer's TMS can call it.
          server.middlewares.use('/api/paramount-email', async (req, res) => {
            const reply = (status, body) => {
              res.statusCode = status
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(body))
            }
            if (req.method !== 'POST') return reply(405, { error: 'Use POST.' })
            const origin = req.headers.origin
            if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
              return reply(403, { error: 'Only the TMS on this computer can send these emails.' })
            }
            let body = ''
            for await (const chunk of req) {
              body += chunk
              if (body.length > 65_536) return reply(413, { error: 'The email is too large.' })
            }
            try {
              const result = await handleParamountEmail(JSON.parse(body || '{}'))
              reply(result.status, result.body)
            } catch (error) {
              console.error('Paramount email request failed:', error.message)
              reply(502, { error: error.message || 'The Gmail request failed.' })
            }
          })

          server.middlewares.use('/api/road-miles', async (req, res) => {
            let body = ''
            try {
              for await (const chunk of req) {
                body += chunk
                if (body.length > 16_384) {
                  res.statusCode = 413
                  res.end(JSON.stringify({ error: 'The road-miles request is too large.' }))
                  return
                }
              }

              const result = await processRoadMilesRequest({
                method: req.method,
                body: body || null
              }, process.env.GOOGLE_MAPS_API_KEY)
              res.statusCode = result.status
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(result.body))
            } catch (error) {
              console.error('Local road-miles request failed:', error)
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'The road-miles request could not be processed.' }))
            }
          })

          server.middlewares.use('/api/dat-rate', async (req, res) => {
            let body = ''
            try {
              for await (const chunk of req) {
                body += chunk
                if (body.length > 16_384) {
                  res.statusCode = 413
                  res.end(JSON.stringify({ error: 'The DAT rate request is too large.' }))
                  return
                }
              }

              const result = await processDatRateRequest({
                method: req.method,
                body: body || null
              }, getDatConfig())
              res.statusCode = result.status
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(result.body))
            } catch (error) {
              console.error('Local DAT rate request failed:', error)
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'The DAT rate request could not be processed.' }))
            }
          })
        }
      }
    ]
  }
})