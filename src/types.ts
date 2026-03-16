export type PiiType = 
  | 'EMAIL'
  | 'PHONE'
  | 'SSN'
  | 'CREDIT_CARD'
  | 'PERSON_NAME'
  | 'ORG'
  | 'LOCATION'
  | 'ADDRESS';

export type Confidence = 'high' | 'medium' | 'low';

export interface Detection {
  id: string;
  type: PiiType;
  start: number;
  end: number;
  text: string;
  normalized: string;
  confidence: Confidence;
}

export interface MaskDecision {
  detectionId: string;
  accepted: boolean;
}

export interface TabMappingState {
  tokenToOriginal: Map<string, string>;
  originalToToken: Map<string, string>;
  countersByType: Record<PiiType, number>;
}

export interface ExtensionSettings {
  enabledTypes: Record<PiiType, boolean>;
  maxPasteSize: number;
  maskOnType: boolean;
  nerMinConfidence: number;
}

export type NerEntityGroup = 'PER' | 'ORG' | 'LOC' | 'MISC' | 'ADDRESS' | string;

export interface NerEntity {
  entity_group: NerEntityGroup;
  start: number;
  end: number;
  score: number;
}

export interface Suggestion {
  id: string;
  type: 'MASK' | 'UNMASK';
  piiType?: PiiType;
  original: string;
  replacement: string;
  normalized?: string;
  confidence?: Confidence;
  start: number;
  end: number;
}

export interface RuntimeMessage {
  type:
    | 'UNMASK_SELECTION_REQUEST'
    | 'UNMASK_SELECTION_RESULT'
    | 'NER_REQUEST'
    | 'NER_RESPONSE';
  payload?: {
    success?: boolean;
    restoredCount?: number;
    message?: string;

    text?: string;
    entities?: NerEntity[];
    error?: string;
  };
}
