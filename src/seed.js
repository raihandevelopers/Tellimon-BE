import 'dotenv/config'
import connectDB from './config/db.js'
import { ensureSeedData } from './utils/seedData.js'

async function seed() {
  await connectDB()
  await ensureSeedData()
  console.log('Seed complete — login with demo@tellimon.com / demo123')
  process.exit(0)
}

seed().catch((err) => {
  console.error('Seed failed:', err.message)
  console.error('\nMake sure MongoDB is running. Options:')
  console.error('  • Local: mongod')
  console.error('  • Docker: docker run -d --name tellimon-mongo -p 27017:27017 mongo:7')
  console.error('  • Atlas: set MONGODB_URI in .env')
  process.exit(1)
})
