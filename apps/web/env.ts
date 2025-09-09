import { createEnv } from '@t3-oss/env-nextjs'
import { z } from 'zod'

export const env = createEnv({
  server: {
    OPEN_AI_API_KEY: z.string().min(1),
    GOOGLE_API_KEY: z.string().min(1),
  },
  client: {},
  // For Next.js >= 13.4.4, you only need to destructure client variables:
  experimental__runtimeEnv: {},
})
