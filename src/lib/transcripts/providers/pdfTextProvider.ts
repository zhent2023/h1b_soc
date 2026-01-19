import pdfParse from 'pdf-parse';

import { createStorageProviderFromEnv } from '../../storage';
import { parseCoursesFromText } from '../llmCourseParser';
import type { TranscriptParserProvider } from '../types';

export const pdfTextProvider: TranscriptParserProvider = {
  providerId: 'pdf_text',
  version: 'pdf-parse@1.1.1',
  async parseFromUrl(storageUrl: string) {
    const storage = createStorageProviderFromEnv();
    const buffer = await storage.readObject(storageUrl);
    const parsed = await pdfParse(buffer);
    const text = parsed.text ?? '';
    const parsedCourses = await parseCoursesFromText(text);
    return {
      courses: parsedCourses.courses,
      confidence: parsedCourses.confidence,
      usedPath: 'pdf_text',
      parserVersion: parsedCourses.model,
      pageCount: parsed.numpages,
    };
  },
};
