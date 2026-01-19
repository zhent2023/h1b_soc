'use client';

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';

export type TranscriptEntry = {
  id: string;
  name?: string;
  status: string | null;
  message?: string;
  error?: string;
  uploadStartedAt?: number;
  uploadEndedAt?: number;
  parseStartedAt?: number;
  parseEndedAt?: number;
  parseUsedPath?: 'pdf_text' | 'ocr' | 'multimodal' | null;
  scoreStartedAt?: number;
  scoreEndedAt?: number;
  scoreStatus?: 'done' | 'failed' | 'skipped';
  scoreEvidenceCount?: number;
  scoreDebug?: TranscriptScoreDebug;
};

export type TranscriptScoreDebugCourse = {
  courseKey: string;
  title: string;
  status: 'matched' | 'no_match' | 'skipped';
  reason?: string;
  maxScore?: number;
  matchCount?: number;
  thresholdUsed?: 'primary' | 'fallback' | 'best' | 'none';
  topSkill?: { skillId: string; name: string; taxonomyType: string };
};

export type TranscriptScoreDebug = {
  totalCourses: number;
  eligibleCourses: number;
  scoredCourses: number;
  courses: TranscriptScoreDebugCourse[];
};

type TranscriptState = {
  transcripts: TranscriptEntry[];
  setTranscripts: Dispatch<SetStateAction<TranscriptEntry[]>>;
};

const TranscriptStateContext = createContext<TranscriptState | null>(null);

export function TranscriptStateProvider({ children }: { children: ReactNode }) {
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const value = useMemo(() => ({ transcripts, setTranscripts }), [transcripts]);

  return (
    <TranscriptStateContext.Provider value={value}>
      {children}
    </TranscriptStateContext.Provider>
  );
}

export function useTranscriptState(): TranscriptState {
  const context = useContext(TranscriptStateContext);
  if (!context) {
    throw new Error('useTranscriptState must be used within TranscriptStateProvider.');
  }
  return context;
}
