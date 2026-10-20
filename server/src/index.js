import app from './app.js'
import { setupDatabase } from './db/setup.js'

const PORT = process.env.PORT || 4000

try {
  await setupDatabase()
} catch (err) {
  console.error(`Database setup failed: ${err.message}`)
  process.exit(1)
}

app.listen(PORT, (err) => {
  if (err) {
    console.error(`Failed to start server: ${err.message}`)
    process.exit(1)
  }
  console.log(`Server running on http://localhost:${PORT}`)
})
