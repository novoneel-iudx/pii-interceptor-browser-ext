import { detectPII } from "./detector"
import { runNER } from "./localNER"
import type { Detection, ExtensionSettings } from "./types"

function mapType(label: string) {

  switch (label) {

    case "PER":
      return "PERSON_NAME"

    case "LOC":
      return "LOCATION"

    case "ORG":
      return "ORG"

    default:
      return "UNKNOWN"
  }
}

function confidenceFromScore(score: number) {

  if (score > 0.9) return "high"
  if (score > 0.75) return "medium"

  return "low"
}

function convertNER(text: string, entities: any[]): Detection[] {

  return entities.map((e, idx) => ({

    id: `NER_${idx}`,

    type: mapType(e.entity_group) as any,

    start: e.start,

    end: e.end,

    text: text.slice(e.start, e.end),

    normalized: text.slice(e.start, e.end),

    confidence: confidenceFromScore(e.score) as any

  }))
}

export async function detectPIIAdvanced(
  text: string,
  settings: ExtensionSettings
): Promise<Detection[]> {

  const regexDetections = detectPII(text, settings)

  const nerEntities = await runNER(text)

  const nerDetections = convertNER(text, nerEntities)

  return [...regexDetections, ...nerDetections]
}