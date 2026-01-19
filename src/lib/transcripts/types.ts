export type ParsedCourse = {
  title: string;
  credits?: number;
  grade?: string;
  passStatus?: 'pass' | 'fail' | 'unknown';
  summary?: string;
  hasSkillEvidence?: boolean;
  rawLine?: string;
};

export type TranscriptParseResult = {
  courses: ParsedCourse[];
  confidence: number;
  usedPath: 'pdf_text' | 'ocr' | 'multimodal';
  pageCount?: number;
  parserVersion?: string;
};

export interface TranscriptParserProvider {
  providerId: string;
  version: string;
  parseFromUrl(storageUrl: string): Promise<TranscriptParseResult>;
}
