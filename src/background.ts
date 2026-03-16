import { env, pipeline } from '@xenova/transformers'
import type { NerEntity, RuntimeMessage } from './types'

let nerPipeline: any = null
let nerFailed = false

// hard local-only policy
env.allowRemoteModels = false
env.allowLocalModels = true

// reduce memory usage
env.backends.onnx.wasm.numThreads = 1

const MAX_NER_CHARS = 1200

async function loadNER() {
  if (nerPipeline || nerFailed) return nerPipeline

  try {
    console.log('[PII] Loading NER model')

    nerPipeline = await pipeline(
      'token-classification',
      chrome.runtime.getURL('dist/models/bert-ner'),
      {
        local_files_only: true,
        quantized: true
      }
    )

    console.log('[PII] NER ready')
    return nerPipeline
  } catch (e) {
    console.error('[PII] NER failed', e)
    nerFailed = true
    return null
  }
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type !== 'NER_REQUEST') return

  void (async () => {
    const text = message.payload?.text ?? ''

    if (!text) {
      sendResponse({
        type: 'NER_RESPONSE',
        payload: {
          entities: []
        }
      } satisfies RuntimeMessage)
      return
    }

    try {
      const ner = await loadNER()
      if (!ner) {
        sendResponse({
          type: 'NER_RESPONSE',
          payload: {
            entities: [],
            error: 'NER unavailable'
          }
        } satisfies RuntimeMessage)
        return
      }

      const safeText = text.slice(0, MAX_NER_CHARS)
      const output = await ner(safeText, { aggregation_strategy: 'simple' })

      const entities: NerEntity[] = (output ?? []).map((e: any) => ({
        entity_group: e.entity_group,
        start: e.start,
        end: e.end,
        score: e.score
      }))

      sendResponse({
        type: 'NER_RESPONSE',
        payload: {
          entities
        }
      } satisfies RuntimeMessage)
    } catch (e: any) {
      console.error('[PII] NER runtime error', e)
      sendResponse({
        type: 'NER_RESPONSE',
        payload: {
          entities: [],
          error: String(e?.message ?? e)
        }
      } satisfies RuntimeMessage)
    }
  })()

  return true
})