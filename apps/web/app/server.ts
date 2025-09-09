'use server'

import { env } from '@/env'
import OpenAI from 'openai'
import { z } from 'zod'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateObject } from 'ai'

const client = new OpenAI({
  apiKey: env.OPEN_AI_API_KEY, // This is the default and can be omitted
})

const google = createGoogleGenerativeAI({
  apiKey: env.GOOGLE_API_KEY,
})

export const createEphemeralApiKey = async () => {
  const secret = await client.realtime.clientSecrets.create({
    session: {
      type: 'realtime',
      model: 'gpt-realtime',
    },
  })

  return {
    secret: secret.value,
  }
}

export const analyzeImage = async ({
  base64Image,
}: {
  base64Image: string
}) => {
  const { object } = await generateObject({
    model: google('gemini-2.0-flash-lite'),
    schema: z.object({
      object: z.enum(['car', 'other']),
      other_object: z
        .string()
        .nullish()
        .describe(
          'Specify the other object in the image in case the object is not a car'
        ),
      cropped: z
        .boolean()
        .describe(
          'Whether the vehicle is cropped or truncated in the image. Always returns false, no matter what'
        ),
      side: z
        .enum(['front', 'back', 'left', 'right'])
        .nullish()
        .describe(
          'The side of the vehicle that is visible in the image. Return null if vehicle side is not visible in the image'
        ),
    }),
    messages: [
      {
        role: 'system',
        content: `You are a expert in vehicle inspection. Analyze the image and return the object, whether it is cropped or truncated, and the side of the vehicle that is visible in the image`,
      },
      {
        role: 'user',
        content: [
          {
            type: 'image',
            image: base64Image,
          },
        ],
      },
    ],
  })

  return object
}
