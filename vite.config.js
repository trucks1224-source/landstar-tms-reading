import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { processRoadMilesRequest } from './api/road-miles.js'
import { processDatRateRequest, getDatConfig } from './api/dat-rate.js'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  for (const key of ['GOOGLE_MAPS_API_KEY', 'DAT_USERNAME', 'DAT_PASSWORD', 'DAT_USER_USERNAME', 'DAT_AUTH_BASE', 'DAT_RATECAST_URL']) {
    if (!process.env[key] && env[key]) {
      process.env[key] = env[key]
    }
  }

  return {
    server: {
      host: '127.0.0.1'
    },
    plugins: [
      react(),
      {
        name: 'road-miles-api',
        configureServer(server) {
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