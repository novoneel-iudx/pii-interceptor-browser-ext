export type PiiType = 'EMAIL' | 'PHONE' | 'SSN' | 'CREDIT_CARD' | 'PERSON_NAME';

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
}

export interface RuntimeMessage {
  type: 'UNMASK_SELECTION_REQUEST' | 'UNMASK_SELECTION_RESULT';
  payload?: {
    success?: boolean;
    restoredCount?: number;
    message?: string;
  };
}
