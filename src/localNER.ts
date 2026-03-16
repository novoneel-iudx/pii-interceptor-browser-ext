import { pipeline, env } from "@xenova/transformers"

let nerPipeline: any = null

// disable remote downloads
env.allowRemoteModels = false
env.allowLocalModels = true

// reduce memory usage
env.backends.onnx.wasm.numThreads = 1

const MAX_CHARS = 600

export async function loadNER() {

  if (nerPipeline) return nerPipeline

  const modelPath = chrome.runtime.getURL("dist/models/bert-ner")

  nerPipeline = await pipeline(
    "token-classification",
    modelPath,
    {
      quantized: true
    }
  )

  return nerPipeline
}

export async function runNER(text: string) {

  const ner = await loadNER()

  // clamp input size to avoid ONNX overflow
  const safeText = text.slice(0, MAX_CHARS)

  const output = await ner(safeText, {
    aggregation_strategy: "simple"
  })

  return output
}