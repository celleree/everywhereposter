import { VoiceProfileSnapshot } from '@gitroom/nestjs-libraries/dtos/copy-generation/generate.media.copy.response';

export type KnowledgeDocumentStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'READY'
  | 'FAILED';

export interface KnowledgeDocumentResponse {
  id: string;
  title: string;
  sourceType: 'TRANSCRIPT';
  inputMethod: 'PASTE' | 'UPLOAD';
  status: KnowledgeDocumentStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  errorMessage?: string | null;
  normalizedCharacterCount: number;
  chunkCount: number;
  factCount: number;
}

export interface VoiceProfileResponse extends VoiceProfileSnapshot {
  id: string;
  version: number;
  isActive: boolean;
  sourceDocumentCount: number;
  approvedFacts: string[];
  updatedAt: string;
}

export interface KnowledgeBaseSummaryResponse {
  documents: KnowledgeDocumentResponse[];
  activeVoiceProfile?: VoiceProfileResponse;
}
