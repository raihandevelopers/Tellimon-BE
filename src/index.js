import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import connectDB from './config/db.js'
import { ensureSeedData } from './utils/seedData.js'
import authRoutes from './routes/auth.js'
import buyerRoutes from './routes/buyers.js'
import campaignRoutes from './routes/campaigns.js'
import blockedRoutes from './routes/blockedContacts.js'
import dashboardRoutes from './routes/dashboard.js'
import callRoutes from './routes/calls.js'
import activityLogRoutes from './routes/activityLogs.js'

const app = express()
const PORT = process.env.PORT || 5000

const DEFAULT_CLIENT_URL =
  'http://localhost:5173,https://tellimon-fe.vercel.app,https://hitechpbxworld.com,https://www.hitechpbxworld.com'

function normalizeOrigin(origin) {
  return origin?.trim().replace(/\/$/, '') || ''
}

const allowedOrigins = new Set(
  (process.env.CLIENT_URL || DEFAULT_CLIENT_URL)
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean)
)

function isAllowedOrigin(origin) {
  if (!origin) return true
  const normalized = normalizeOrigin(origin)
  if (allowedOrigins.has(normalized)) return true
  if (/^https:\/\/[\w.-]+\.vercel\.app$/.test(normalized)) return true
  return false
}

app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        callback(null, true)
      } else {
        callback(new Error(`CORS blocked: ${origin}`))
      }
    },
    credentials: true,
  })
)
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'tellimon-backend' })
})

app.use('/api/auth', authRoutes)
app.use('/api/buyers', buyerRoutes)
app.use('/api/campaigns', campaignRoutes)
app.use('/api/blocked-contacts', blockedRoutes)
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/calls', callRoutes)
app.use('/api/activity-logs', activityLogRoutes)

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' })
})

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})

async function start() {
  await connectDB()
  await ensureSeedData()
  app.listen(PORT, () => {
    console.log(`Tellimon API running on http://localhost:${PORT}`)
  })
}

start().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
