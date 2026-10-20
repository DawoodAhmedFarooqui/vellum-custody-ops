import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DATA_DIR || path.resolve(here, '../../../data')

// Read once at startup; the schedule is configuration shipped with the data.
export const feeSchedule = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'fee-schedule.json'), 'utf8'))
