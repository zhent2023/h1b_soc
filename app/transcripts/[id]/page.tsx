'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

import styles from '../../page.module.css';
import { type TranscriptScoreDebug } from '../../transcript-state';
type TranscriptConflict = {
  courseKey: string;
  title: string;
  grade: string | null;
  passStatus: string | null;
  rawLine: string | null;
  reason: string | null;
};

type TranscriptCourse = {
  courseKey: string;
  title: string;
  credits: number | null;
  grade: string | null;
  passStatus: string | null;
  summary?: string | null;
  hasSkillEvidence?: boolean | null;
  rawLine: string | null;
  conflictReason?: string | null;
};

type TranscriptDocument = {
  storageUrl: string | null;
  pageCount: number | null;
  deletedAt: string | null;
};

type TranscriptRecord = {
  id: string;
  status: string;
  parseConfidence: number | null;
  createdAt: string;
  updatedAt: string;
  document: TranscriptDocument | null;
  courses: TranscriptCourse[];
  conflicts?: TranscriptConflict[];
};

type EditableCourse = {
  id: string;
  title: string;
  credits: string;
  grade: string;
  summary: string;
  hasSkillEvidence: boolean | null;
  passStatus: string | null;
  rawLine: string;
  conflictReason?: string | null;
};

function formatStatus(status: string) {
  return status.replace(/_/g, ' ').toLowerCase();
}

function formatDebugScore(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toFixed(3);
}

function formatDebugReason(reason?: string) {
  if (!reason) return '';
  switch (reason) {
    case 'no_skill_evidence':
      return 'No skill evidence from model';
    case 'no_embedding':
      return 'Missing embedding';
    case 'generic_title':
      return 'Generic course title';
    case 'failed_course':
      return 'Failed by grade rule';
    default:
      return reason;
  }
}

export default function TranscriptPage() {
  const params = useParams();
  const router = useRouter();
  const transcriptId = typeof params?.id === 'string' ? params.id : '';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [transcript, setTranscript] = useState<TranscriptRecord | null>(null);
  const [courses, setCourses] = useState<EditableCourse[]>([]);
  const [showExcluded, setShowExcluded] = useState(false);
  const [computeDebug, setComputeDebug] = useState<TranscriptScoreDebug | null>(null);

  const statusLabel = useMemo(() => {
    if (!transcript) return 'unknown';
    return formatStatus(transcript.status);
  }, [transcript]);

  const excludedCount = useMemo(
    () => courses.filter((course) => course.hasSkillEvidence === false).length,
    [courses],
  );

  const loadTranscript = useCallback(async () => {
    if (!transcriptId) return;
    setLoading(true);
    setError('');
    setMessage('');
    setComputeDebug(null);
    try {
      const res = await fetch(`/api/v1/transcripts/${transcriptId}`, {
        credentials: 'include',
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.error ?? 'Failed to load transcript.');
      }
      const record = payload?.transcript as TranscriptRecord;
      const conflictMap = new Map(
        (record.conflicts ?? []).map((conflict) => [conflict.courseKey, conflict.reason]),
      );
      setTranscript(record);
      const editable = (record.courses ?? []).map((course) => ({
        id: course.courseKey,
        title: course.title ?? '',
        credits: course.credits !== null && course.credits !== undefined ? String(course.credits) : '',
        grade: course.grade ?? '',
        summary: course.summary ?? '',
        hasSkillEvidence:
          typeof course.hasSkillEvidence === 'boolean' ? course.hasSkillEvidence : null,
        passStatus: course.passStatus ?? null,
        rawLine: course.rawLine ?? '',
        conflictReason: conflictMap.get(course.courseKey) ?? null,
      }));
      setCourses(editable);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load transcript.');
    } finally {
      setLoading(false);
    }
  }, [transcriptId]);

  useEffect(() => {
    loadTranscript();
  }, [loadTranscript]);

  const updateCourse = (id: string, field: keyof EditableCourse, value: string) => {
    setCourses((prev) =>
      prev.map((course) => (course.id === id ? { ...course, [field]: value } : course)),
    );
  };

  const addCourse = () => {
    const id = `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setCourses((prev) => [
      ...prev,
      {
        id,
        title: '',
        credits: '',
        grade: '',
        summary: '',
        hasSkillEvidence: null,
        passStatus: null,
        rawLine: '',
      },
    ]);
  };

  const removeCourse = (id: string) => {
    setCourses((prev) => prev.filter((course) => course.id !== id));
  };

  const saveCourses = useCallback(
    async (options?: { silent?: boolean; reload?: boolean }) => {
      if (!transcriptId) return false;
      setSaving(true);
      if (!options?.silent) {
        setError('');
        setMessage('');
      }

      try {
        const payload = {
          courses: courses
            .map((course) => ({
              title: course.title.trim(),
              credits: course.credits.trim()
                ? Number(course.credits.trim())
                : null,
              grade: course.grade.trim() ? course.grade.trim() : null,
              summary: course.summary.trim() ? course.summary.trim() : null,
              hasSkillEvidence:
                typeof course.hasSkillEvidence === 'boolean'
                  ? course.hasSkillEvidence
                  : null,
              rawLine: course.rawLine.trim() ? course.rawLine.trim() : null,
            }))
            .filter((course) => course.title.length > 0),
        };

        const res = await fetch(`/api/v1/transcripts/${transcriptId}/courses/update`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error ?? 'Failed to save courses.');
        }
        if (!options?.silent) {
          setMessage('Courses saved.');
        }
        if (options?.reload !== false) {
          await loadTranscript();
        }
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save courses.');
        return false;
      } finally {
        setSaving(false);
      }
    },
    [courses, loadTranscript, transcriptId],
  );

  const handleSave = async () => {
    await saveCourses();
  };

  const handleReprocess = async () => {
    if (!transcriptId) return;
    setProcessing(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch(`/api/v1/transcripts/${transcriptId}/process`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? 'Failed to re-run parsing.');
      }
      setMessage(`Parsing complete. ${data?.courseCount ?? 0} courses detected.`);
      await loadTranscript();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to re-run parsing.');
    } finally {
      setProcessing(false);
    }
  };

  const handleComputeSkills = async () => {
    if (!transcriptId) return;
    setComputing(true);
    setError('');
    setMessage('');
    setComputeDebug(null);
    try {
      const saved = await saveCourses({ silent: true, reload: false });
      if (!saved) {
        return;
      }
      const res = await fetch(`/api/v1/transcripts/${transcriptId}/compute-ska?debug=1`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? 'Failed to compute skills.');
      }
      setMessage(`Skills computed. Evidence count: ${data?.evidenceCount ?? 0}.`);
      if (data?.debug) {
        setComputeDebug(data.debug as TranscriptScoreDebug);
      }
      await loadTranscript();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to compute skills.');
    } finally {
      setComputing(false);
    }
  };

  const handleBack = () => {
    router.push('/');
  };

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>Transcript Review</h1>
            <p className={styles.subtitle}>
              Review extracted courses, edit if needed, and compute skills.
            </p>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.secondaryButton} onClick={handleBack}>
              Back
            </button>
          </div>
        </header>

        <section className={styles.card}>
          <div className={styles.cardHeaderRow}>
            <h2 className={styles.cardTitle}>Transcript Status</h2>
            <span className={styles.pill}>Status: {statusLabel}</span>
          </div>
          <div className={styles.transcriptMeta}>
            <div>
              <span className={styles.transcriptLabel}>Transcript ID:</span> {transcriptId}
            </div>
            <div>
              <span className={styles.transcriptLabel}>Parsed confidence:</span>{' '}
              {transcript?.parseConfidence !== null && transcript?.parseConfidence !== undefined
                ? transcript.parseConfidence.toFixed(2)
                : '—'}
            </div>
            <div>
              <span className={styles.transcriptLabel}>Pages:</span>{' '}
              {transcript?.document?.pageCount ?? '—'}
            </div>
          </div>
          <div className={styles.transcriptMetaLinks}>
            {transcript?.document?.storageUrl ? (
              <a
                className={styles.transcriptLink}
                href={`/api/v1/transcripts/${transcriptId}/download`}
                target="_blank"
                rel="noreferrer"
              >
                Open original PDF
              </a>
            ) : (
              <span className={styles.transcriptMetaNote}>Source file removed after parsing.</span>
            )}
          </div>
        </section>

        {error ? <div className={styles.error}>{error}</div> : null}
        {message ? <div className={styles.success}>{message}</div> : null}
        <section className={styles.card}>
          <div className={styles.cardHeaderRow}>
            <h2 className={styles.cardTitle}>Courses</h2>
            <div className={styles.cardHeaderActions}>
              {excludedCount > 0 ? (
                <button
                  type="button"
                  className={styles.ghostButton}
                  onClick={() => setShowExcluded((prev) => !prev)}
                >
                  {showExcluded ? 'Hide' : 'Show'} excluded ({excludedCount})
                </button>
              ) : null}
              <button type="button" className={styles.ghostButton} onClick={addCourse}>
                Add course
              </button>
            </div>
          </div>

          {loading ? (
            <div className={styles.transcriptEmpty}>Loading transcript...</div>
          ) : courses.length === 0 ? (
            <div className={styles.transcriptEmpty}>No courses detected yet.</div>
          ) : (
            <div className={styles.transcriptTableWrapper}>
              <table className={styles.transcriptTable}>
                <thead>
                  <tr>
                    <th>Course title</th>
                    <th>Credits</th>
                    <th>Grade</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {courses
                    .filter((course) => course.hasSkillEvidence !== false || showExcluded)
                    .map((course) => {
                      const rowClass = course.conflictReason
                        ? styles.transcriptConflictRow
                        : course.hasSkillEvidence === false
                          ? styles.transcriptExcludedRow
                          : '';
                      return (
                        <Fragment key={course.id}>
                          <tr className={`${styles.transcriptMainRow} ${rowClass}`.trim()}>
                            <td>
                              <input
                                className={styles.input}
                                value={course.title}
                                onChange={(event) =>
                                  updateCourse(course.id, 'title', event.target.value)
                                }
                                placeholder="Course title"
                              />
                            </td>
                            <td>
                              <input
                                className={styles.input}
                                value={course.credits}
                                onChange={(event) =>
                                  updateCourse(course.id, 'credits', event.target.value)
                                }
                                placeholder="Credits"
                              />
                            </td>
                            <td>
                              <input
                                className={styles.input}
                                value={course.grade}
                                onChange={(event) =>
                                  updateCourse(course.id, 'grade', event.target.value)
                                }
                                placeholder="Grade"
                              />
                            </td>
                            <td>
                              <button
                                type="button"
                                className={styles.secondaryButton}
                                onClick={() => removeCourse(course.id)}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                          <tr className={`${styles.transcriptDetailRow} ${rowClass}`.trim()}>
                            <td colSpan={4}>
                              <div className={styles.transcriptSummaryRow}>
                                <span className={styles.transcriptSummaryLabel}>Summary</span>
                                <textarea
                                  className={styles.transcriptSummaryInput}
                                  value={course.summary}
                                  onChange={(event) =>
                                    updateCourse(course.id, 'summary', event.target.value)
                                  }
                                  placeholder="Course summary and skills (AI inferred)"
                                  rows={3}
                                />
                                {course.conflictReason ? (
                                  <div className={styles.transcriptConflictReason}>
                                    {course.conflictReason}
                                  </div>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        </Fragment>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}

          <div className={styles.transcriptActions}>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={handleSave}
              disabled={saving || loading}
            >
              {saving ? 'Saving...' : 'Save changes'}
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={handleReprocess}
              disabled={processing}
            >
              {processing ? 'Parsing...' : 'Re-run parsing'}
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={handleComputeSkills}
              disabled={computing || saving}
            >
              {computing ? 'Computing...' : 'Recompute skills'}
            </button>
          </div>
          <div className={styles.transcriptHint}>
            Skills auto-compute when you click Recommend. Use recompute after edits or for debug.
          </div>
          {computeDebug ? (
            <details className={styles.transcriptDebug}>
              <summary>Skill scoring debug</summary>
              <div className={styles.transcriptDebugSummary}>
                Courses: {computeDebug.totalCourses} total · {computeDebug.eligibleCourses} eligible ·{' '}
                {computeDebug.scoredCourses} embedded · Evidence: {computeDebug.courses.length}
              </div>
              <div className={styles.transcriptDebugList}>
                {computeDebug.courses.map((course) => {
                  const reason = formatDebugReason(course.reason);
                  const statusLabel =
                    course.status === 'matched'
                      ? `matched (${course.matchCount ?? 0})`
                      : course.status.replace('_', ' ');
                  const thresholdLabel =
                    course.thresholdUsed && course.thresholdUsed !== 'none'
                      ? ` • ${course.thresholdUsed}`
                      : '';
                  const detailParts = [statusLabel + thresholdLabel, reason].filter(Boolean);
                  const topSkill = course.topSkill
                    ? `Top skill: ${course.topSkill.name} (${course.topSkill.taxonomyType})`
                    : 'Top skill: —';
                  return (
                    <div key={course.courseKey} className={styles.transcriptDebugItem}>
                      <div className={styles.transcriptDebugTitle}>{course.title}</div>
                      <div className={styles.transcriptDebugMeta}>
                        {detailParts.join(' • ')}
                      </div>
                      <div className={styles.transcriptDebugMeta}>
                        Max score: {formatDebugScore(course.maxScore)} • {topSkill}
                      </div>
                    </div>
                  );
                })}
              </div>
            </details>
          ) : null}
        </section>
      </div>
    </main>
  );
}
