import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { Ai } from '@cloudflare/workers-types'

type Bindings = {
  AI: Ai
}

const app = new Hono<{ Bindings: Bindings }>()

const schema = z.object({
  text: z.array(z.string()).nonempty('Text is required'),
  source_lang: z
    .string()
    .optional()
    .default('EN')
    .refine(
      (lang) => !lang || /^[A-Z]{2}$/.test(lang),
      'Source language must be a valid language code or omitted'
    ),
  target_lang: z
    .string()
    .min(2, 'Target language code is required')
    .regex(/^[A-Z]{2}(-[A-Z]{2,4})?$/, 'Target language must be a valid language code'),
})

app.post('/translate', zValidator('json', schema), async (c) => {
  const data = c.req.valid('json')

  let isRateLimited = false

  const translations = await Promise.all(
    data.text.map(async (text) => {
      try {
        const response = await c.env.AI.run(
          '@cf/meta/m2m100-1.2b',
          {
            text: text,
            source_lang: data.source_lang.toLowerCase(),
            target_lang: data.target_lang.toLowerCase(),
          },
          {
            gateway: {
              id: 'translation-app',
            },
          }
        )
        return {
          text: response.translated_text,
        }
      } catch (error: unknown) {
        if (error instanceof Error) {
          if (error.name === 'AiError' && error.message === '2003: Rate limited') {
            isRateLimited = true
          }
          return { error: error.message }
        }
        return { error: 'Unknown error' }
      }
    })
  )
  if (isRateLimited) {
    return c.newResponse('Rate limited', { status: 429 })
  }
  return c.json({ translations })
})

export default app
