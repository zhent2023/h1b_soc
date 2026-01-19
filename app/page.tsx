"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { put } from '@vercel/blob/client';

import { parseFullAddress, type ParsedAddress } from '../src/lib/address';
import { useTranscriptState, type TranscriptEntry, type TranscriptScoreDebug } from './transcript-state';
import styles from './page.module.css';

type DetectedMode = 'address' | 'address_soc' | 'soc' | 'none';
type OccupationSuggestion = { onetCode: string; title: string; jobZone?: number | null };
type AddressFields = {
  line1: string;
  line2: string;
  city: string;
  state: string;
  zip: string;
};
type SocRecommendItem = {
  matchedOnetCode: string;
  matchedOnetTitle: string | null;
  jobZone: number | null;
  socCode: string;
  socTitle: string | null;
  similarity: number;
  confidence?: number;
  duties: string[];
  dutiesCount: number;
  dutiesAvailable: boolean;
  wageLevel1Hourly: string | null;
  wageLevel1Annual: number | null;
  wageYear: string | null;
  wageAreaCode: string | null;
  wageIsAcwia: boolean | null;
  wageAvailable: boolean;
  wageHasDataQualityIssue: boolean | null;
  wageDataQualityNotes: Record<string, unknown> | null;
  wageSource: 'LOCAL' | 'NATIONAL' | 'NONE';
};
type SocRecommendResponse = {
  items: SocRecommendItem[];
  warnings: string[];
  meta?: {
    inputTruncated?: boolean;
    enrichment?: {
      dutiesIncluded: boolean;
      wageIncluded: boolean;
      skippedReason?: 'TIMEOUT' | 'MISSING_WAGE_CONTEXT' | 'ERROR';
    };
  };
};
type CombinedMatchItem = {
  onet_code: string;
  onet_title?: string | null;
  job_zone?: number | null;
  duties?: string[];
  duties_count?: number;
  duties_available?: boolean;
  final_rank: number;
  source: 'duties' | 'skills';
  rrf_score?: number;
  duties_rank?: number | null;
  skills_rank?: number | null;
  skills_gate?: 'pass' | 'fail' | 'skipped';
  skills_score?: number | null;
  skills_coverage?: number | null;
  skills_match?: number | null;
  skills_evidence?: {
    course_count: number;
    top_matches: Array<{
      course_title: string;
      skill_name: string;
      taxonomy_type: string;
      skill_weight: number;
    }>;
  } | null;
  similarity?: number;
  confidence?: number;
  score?: number;
  coverage?: number;
  match?: number;
};
type CombinedMatchResponse = {
  results: CombinedMatchItem[];
  fusion_applied: boolean;
  duties_meta?: {
    input_truncated?: boolean;
    input_length?: number;
  } | null;
};
type TranscriptUploadTarget = {
  provider: 'vercel_blob' | 'local';
  uploadUrl?: string;
  clientToken?: string;
  pathname?: string;
  headers?: Record<string, string>;
  method?: string;
  maxBytes: number;
  storageUrl?: string | null;
};
type TranscriptCreateResponse = {
  transcriptId: string;
  upload: TranscriptUploadTarget;
};
const confirmationStorageKey = 'lookupConfirmation';
const onetCodePattern = /^\s*(\d{2}-\d{4}(?:\.\d{2})?)\b/;
const dutiesPreviewCount = 7;
const PO_BOX_RE = /\bP\.?\s*O\.?\s*Box\b/i;
const READY_TRANSCRIPT_STATUSES = new Set(['READY', 'NEEDS_REVIEW']);

async function readJsonResponse<T>(res: Response): Promise<T> {
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return (await res.json()) as T;
  }
  const text = await res.text();
  const snippet = text.replace(/\s+/g, ' ').slice(0, 160);
  const suffix = snippet ? ` Response: ${snippet}` : '';
  throw new Error(`Server returned non-JSON response (${res.status}).${suffix}`);
}

const TRANSCRIPT_STAGE_LABELS = [
  { key: 'upload', label: 'Upload' },
  { key: 'ocr', label: 'OCR' },
  { key: 'parse', label: 'Parse' },
  { key: 'score', label: 'Score' },
] as const;

const UPLOAD_ESTIMATE_MS = 8_000;
const PARSE_ESTIMATE_TEXT_MS = 18_000;
const PARSE_ESTIMATE_OCR_MS = 60_000;
const SCORE_ESTIMATE_MS = 8_000;

const STATE_OPTIONS = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DC', name: 'District of Columbia' },
  { code: 'DE', name: 'Delaware' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'GU', name: 'Guam' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'IA', name: 'Iowa' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MD', name: 'Maryland' },
  { code: 'ME', name: 'Maine' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MT', name: 'Montana' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NY', name: 'New York' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'PR', name: 'Puerto Rico' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VA', name: 'Virginia' },
  { code: 'VI', name: 'U.S. Virgin Islands' },
  { code: 'VT', name: 'Vermont' },
  { code: 'WA', name: 'Washington' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WY', name: 'Wyoming' },
];

const STATE_CODES = new Set(STATE_OPTIONS.map((entry) => entry.code));

function normalizeStateName(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, '');
}

function normalizeStateInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (STATE_CODES.has(upper)) return upper;
  const normalizedName = normalizeStateName(trimmed);
  const match = STATE_OPTIONS.find(
    (entry) => normalizeStateName(entry.name) === normalizedName,
  );
  return match ? match.code : null;
}

function composeAddressText(fields: AddressFields, normalizedState?: string | null): string {
  const line1 = fields.line1.trim();
  const line2 = fields.line2.trim();
  const city = fields.city.trim();
  const state = normalizedState ?? '';
  const zip = fields.zip.trim();
  const stateZip = [state, zip].filter(Boolean).join(' ');
  return [line1, line2, city, stateZip].filter(Boolean).join(', ');
}

function computeAddressMeta(fields: AddressFields) {
  const line1 = fields.line1.trim();
  const line2 = fields.line2.trim();
  const city = fields.city.trim();
  const stateRaw = fields.state.trim();
  const zip = fields.zip.trim();
  const hasAny = Boolean(line1 || line2 || city || stateRaw || zip);
  const normalizedState = normalizeStateInput(stateRaw);
  const warnings: string[] = [];

  if (!hasAny) {
    return { warnings, confidence: 'low' as const, normalizedState, hasAny };
  }

  if (!city) {
    warnings.push('City is required.');
  }
  if (!normalizedState) {
    warnings.push(
      stateRaw
        ? 'State must be a valid US state or territory.'
        : 'State is required.',
    );
  }
  if (!zip) {
    warnings.push('ZIP code missing.');
  }
  if (!line1 && city && normalizedState) {
    warnings.push('Street address missing; results may be approximate.');
  }
  if (PO_BOX_RE.test(`${line1} ${line2}`)) {
    warnings.push('PO Box detected; results may be inaccurate.');
  }

  let confidence: 'high' | 'medium' | 'low' = 'high';
  if (!city || !normalizedState) {
    confidence = 'low';
  } else if (!zip || !line1) {
    confidence = 'medium';
  }

  return { warnings, confidence, normalizedState, hasAny };
}

function buildAddressFieldsFromParsed(parsed: ParsedAddress): AddressFields {
  return {
    line1: parsed.line1,
    line2: parsed.line2 ?? '',
    city: parsed.city,
    state: parsed.state,
    zip: parsed.zip ?? '',
  };
}

function normalizeAddressInput(value: string): string {
  return value.replace(/\s*\n+\s*/g, ', ').replace(/\s+/g, ' ').trim();
}

function hydrateAddressFields(payload?: {
  fullText?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  zip?: string;
}): AddressFields {
  if (!payload) {
    return { line1: '', line2: '', city: '', state: '', zip: '' };
  }
  const line1 = payload.line1 ?? '';
  const line2 = payload.line2 ?? '';
  const city = payload.city ?? '';
  const state = payload.state ?? '';
  const zip = payload.zip ?? '';
  const hasAny = Boolean(line1 || line2 || city || state || zip);
  if (!hasAny && payload.fullText) {
    const parsed = parseFullAddress(payload.fullText);
    return buildAddressFieldsFromParsed(parsed);
  }
  return { line1, line2, city, state, zip };
}

function extractOnetCode(value: string): string {
  const match = value.match(onetCodePattern);
  return match ? match[1] : '';
}

function formatOccupationLabel(entry: OccupationSuggestion): string {
  return `${entry.onetCode} — ${entry.title}`;
}

export default function HomePage() {
  const router = useRouter();
  const [addressDetails, setAddressDetails] = useState<AddressFields>({
    line1: '',
    line2: '',
    city: '',
    state: '',
    zip: '',
  });
  const [socInput, setSocInput] = useState('');
  const [socCode, setSocCode] = useState('');
  const [socSelectedTitle, setSocSelectedTitle] = useState<string | null>(null);
  const [socSuggestions, setSocSuggestions] = useState<OccupationSuggestion[]>([]);
  const [socSuggestionsOpen, setSocSuggestionsOpen] = useState(false);
  const [socSuggestionsLoading, setSocSuggestionsLoading] = useState(false);
  const [socSuggestionsError, setSocSuggestionsError] = useState('');
  const [socHighlightIndex, setSocHighlightIndex] = useState(-1);
  const [salaryAmount, setSalaryAmount] = useState('');
  const [salaryUnit, setSalaryUnit] = useState<'year' | 'hour'>('year');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [response, setResponse] = useState<any>(null);
  const [lastRequest, setLastRequest] = useState<any>(null);
  const [candidateQuery, setCandidateQuery] = useState('');
  const [candidateResults, setCandidateResults] = useState<any[]>([]);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateError, setCandidateError] = useState('');
  const [showCandidateSearch, setShowCandidateSearch] = useState(false);
  const [authMode, setAuthMode] = useState<'public' | 'invite' | null>(null);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [dutiesCopied, setDutiesCopied] = useState(false);
  const [welcomeName, setWelcomeName] = useState<string | null>(null);
  const socFetchId = useRef(0);
  const socBlurTimer = useRef<number | null>(null);
  const stateBlurTimer = useRef<number | null>(null);
  const confirmationCardRef = useRef<HTMLDivElement | null>(null);
  const [stateSuggestionsOpen, setStateSuggestionsOpen] = useState(false);
  const [stateHighlightIndex, setStateHighlightIndex] = useState(-1);
  const recommenderEnabled = process.env.NEXT_PUBLIC_FEATURE_SOC_RECOMMENDER === 'true';
  const skillsMatchingEnabled = process.env.NEXT_PUBLIC_FEATURE_SKILL_MATCHING === 'true';
  const [dutiesInput, setDutiesInput] = useState('');
  const [recommendations, setRecommendations] = useState<SocRecommendItem[]>([]);
  const [combinedResults, setCombinedResults] = useState<CombinedMatchItem[]>([]);
  const [recommendMode, setRecommendMode] = useState<'duties' | 'combined'>('duties');
  const [recommendLoading, setRecommendLoading] = useState(false);
  const [recommendError, setRecommendError] = useState('');
  const [recommendWarnings, setRecommendWarnings] = useState<string[]>([]);
  const [recommendMeta, setRecommendMeta] = useState<SocRecommendResponse['meta'] | null>(null);
  const [recommendExpanded, setRecommendExpanded] = useState<string | null>(null);
  const [recommendSelected, setRecommendSelected] = useState<{
    code: string;
    title: string | null;
  } | null>(null);
  const [recommendOpen, setRecommendOpen] = useState(true);
  const [transcriptFiles, setTranscriptFiles] = useState<File[]>([]);
  const { transcripts, setTranscripts } = useTranscriptState();
  const [uploadBatchTotal, setUploadBatchTotal] = useState(0);
  const [uploadBatchBaseline, setUploadBatchBaseline] = useState(0);
  const [transcriptError, setTranscriptError] = useState('');
  const [transcriptMessage, setTranscriptMessage] = useState('');
  const [transcriptUploading, setTranscriptUploading] = useState(false);
  const [, setTranscriptTick] = useState(0);
  const [socInputFlash, setSocInputFlash] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const previewCount = isMobile ? 6 : dutiesPreviewCount;
  const stateListboxId = useId();
  const socListboxId = useId();
  const socInputRef = useRef<HTMLInputElement | null>(null);
  const transcriptInputRef = useRef<HTMLInputElement | null>(null);
  const socInputFlashTimer = useRef<number | null>(null);
  const lastUserScrollRef = useRef(0);

  const scrollIntoViewSafely = (node: HTMLElement) => {
    const rect = node.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const inView = rect.top >= 0 && rect.bottom <= viewportHeight;
    if (inView) return;
    const now = Date.now();
    const shouldSmooth = now - lastUserScrollRef.current > 300;
    // Avoid smooth scroll fighting user scroll while keeping auto-jump.
    node.scrollIntoView({ behavior: shouldSmooth ? 'smooth' : 'auto', block: 'center' });
  };

  const addressMeta = useMemo(() => computeAddressMeta(addressDetails), [addressDetails]);
  const recommendPanelEnabled = recommenderEnabled || skillsMatchingEnabled;
  const readyTranscriptIds = useMemo(
    () =>
      skillsMatchingEnabled
        ? transcripts
            .filter((entry) => READY_TRANSCRIPT_STATUSES.has(entry.status ?? ''))
            .map((entry) => entry.id)
        : [],
    [skillsMatchingEnabled, transcripts],
  );
  const pendingQueueIds = useMemo(
    () =>
      skillsMatchingEnabled
        ? transcripts
            .filter(
              (entry) =>
                !entry.status ||
                ['CREATED', 'UPLOADED', 'PARSING'].includes(entry.status),
            )
            .map((entry) => entry.id)
        : [],
    [skillsMatchingEnabled, transcripts],
  );
  const pendingTranscriptIds = pendingQueueIds;
  const hasAnyTranscript =
    skillsMatchingEnabled && (transcripts.length > 0 || uploadBatchTotal > 0);
  const hasReadyTranscript = skillsMatchingEnabled && readyTranscriptIds.length > 0;
  const hasPendingTranscript = skillsMatchingEnabled && pendingTranscriptIds.length > 0;
  const hasActionableContent =
    Boolean(dutiesInput.trim()) || (skillsMatchingEnabled && hasReadyTranscript);
  const recommendDisabled =
    recommendLoading || hasPendingTranscript || !hasActionableContent;
  const recommendDisabledReason = recommendLoading
    ? null
    : hasPendingTranscript
      ? 'Transcript is still processing. Please wait.'
      : !hasActionableContent
        ? skillsMatchingEnabled
          ? 'Paste job duties or upload a parsed transcript to continue.'
          : 'Paste job duties to continue.'
        : null;
  const trimmedSoc = socCode.trim();
  const hasAddressInput = addressMeta.hasAny;
  const hasAddress = Boolean(addressDetails.city.trim() && addressMeta.normalizedState);
  const hasSoc = trimmedSoc.length > 0;
  const detectedMode: DetectedMode = hasAddress && hasSoc ? 'address_soc' : hasAddress ? 'address' : hasSoc ? 'soc' : 'none';
  const modeLabel =
    detectedMode === 'address'
      ? 'Mode: Address only'
      : detectedMode === 'address_soc'
        ? 'Mode: Address + Occupation'
        : detectedMode === 'soc'
          ? 'Mode: Occupation only'
          : '';
  const submitLabel =
    detectedMode === 'address'
      ? 'Lookup Geo'
      : detectedMode === 'address_soc'
        ? 'Lookup Wages'
        : detectedMode === 'soc'
          ? 'Find Extremes'
          : 'Lookup';
  const socSuffixMatch = trimmedSoc.match(/^(\d{2}-\d{4})\.(\d{2})$/);
  const onetSummaryCode =
    /^\d{2}-\d{4}\.\d{2}$/.test(trimmedSoc)
      ? trimmedSoc
      : /^\d{2}-\d{4}$/.test(trimmedSoc)
        ? `${trimmedSoc}.00`
        : null;
  const onetSummaryUrl = onetSummaryCode
    ? `https://www.onetonline.org/link/summary/${onetSummaryCode}`
    : null;
  const salaryNumber = Number(salaryAmount);
  const salaryWarning =
    detectedMode === 'address_soc' &&
    salaryUnit === 'year' &&
    Number.isFinite(salaryNumber) &&
    salaryNumber > 0 &&
    salaryNumber < 1000;

  const annualFormatter = useMemo(
    () => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    [],
  );
  const hourlyFormatter = useMemo(
    () => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    [],
  );
  const stateSuggestions = useMemo(() => {
    const query = addressDetails.state.trim().toLowerCase();
    if (!query) return [];
    return STATE_OPTIONS.filter(
      (entry) =>
        entry.code.toLowerCase().startsWith(query) ||
        entry.name.toLowerCase().startsWith(query),
    );
  }, [addressDetails.state]);
  const stateActiveId =
    stateSuggestionsOpen &&
    stateHighlightIndex >= 0 &&
    stateHighlightIndex < stateSuggestions.length
      ? `${stateListboxId}-option-${stateSuggestions[stateHighlightIndex].code}`
      : undefined;
  const socActiveId =
    socSuggestionsOpen && socHighlightIndex >= 0 && socHighlightIndex < socSuggestions.length
      ? `${socListboxId}-option-${socSuggestions[socHighlightIndex].onetCode}`
      : undefined;

  useEffect(() => {
    let active = true;
    const fetchAuth = async () => {
      try {
        const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
        if (!active) return;
        if (!res.ok) {
          router.replace('/login');
          return;
        }
        const data = await res.json();
        if (data?.mode === 'public') {
          setAuthMode('public');
          setAuthEmail(null);
        } else {
          setAuthMode('invite');
          setAuthEmail(data?.email ?? null);
        }
      } catch {
        if (!active) return;
        router.replace('/login');
      }
    };
    fetchAuth();
    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    return () => {
      if (socInputFlashTimer.current) {
        window.clearTimeout(socInputFlashTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    const markScrollIntent = () => {
      lastUserScrollRef.current = Date.now();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp' ||
        event.key === 'PageDown' ||
        event.key === 'PageUp' ||
        event.key === 'Home' ||
        event.key === 'End' ||
        event.key === ' '
      ) {
        markScrollIntent();
      }
    };
    window.addEventListener('wheel', markScrollIntent, { passive: true });
    window.addEventListener('touchmove', markScrollIntent, { passive: true });
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('wheel', markScrollIntent);
      window.removeEventListener('touchmove', markScrollIntent);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    const query = socInput.trim();
    const selectionLabel =
      socSelectedTitle && socCode
        ? formatOccupationLabel({ onetCode: socCode, title: socSelectedTitle })
        : null;

    if (!query) {
      setSocSuggestions([]);
      setSocSuggestionsOpen(false);
      setSocSuggestionsLoading(false);
      setSocSuggestionsError('');
      setSocHighlightIndex(-1);
      return;
    }

    if (selectionLabel && query === selectionLabel) {
      setSocSuggestions([]);
      setSocSuggestionsOpen(false);
      setSocSuggestionsLoading(false);
      setSocSuggestionsError('');
      setSocHighlightIndex(-1);
      return;
    }

    const requestId = (socFetchId.current += 1);
    const controller = new AbortController();
    setSocSuggestionsLoading(true);
    setSocSuggestionsError('');
    setSocHighlightIndex(-1);

    const timer = window.setTimeout(async () => {
      try {
        const url = new URL('/api/v1/onet/occupations', window.location.origin);
        url.searchParams.set('q', query);
        const res = await fetch(url.toString(), {
          signal: controller.signal,
          credentials: 'include',
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error ?? 'Occupation search failed.');
        }
        if (socFetchId.current !== requestId) {
          return;
        }
        const items = Array.isArray(data.items) ? data.items : [];
        setSocSuggestions(items);
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }
        setSocSuggestionsError(err instanceof Error ? err.message : 'Occupation search failed.');
        setSocSuggestions([]);
      } finally {
        if (socFetchId.current === requestId) {
          setSocSuggestionsLoading(false);
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [socInput, socCode, socSelectedTitle]);

  useEffect(() => {
    if (!response || response.kind !== 'geo_needs_confirmation') {
      setCandidateResults([]);
      setCandidateQuery('');
      setCandidateError('');
      setShowCandidateSearch(false);
      return;
    }
    setShowCandidateSearch(false);
  }, [response]);

  useEffect(() => {
    if (response?.kind !== 'geo_needs_confirmation') return;
    const node = confirmationCardRef.current;
    if (!node) return;
    scrollIntoViewSafely(node);
  }, [response?.kind]);

  useEffect(() => {
    const raw = sessionStorage.getItem(confirmationStorageKey);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as { ts: number; lastRequest?: any; response?: any };
      if (!saved?.ts || Date.now() - saved.ts > 60 * 60 * 1000) {
        sessionStorage.removeItem(confirmationStorageKey);
        return;
      }

      if (saved.lastRequest) {
        setLastRequest(saved.lastRequest);
        setResponse(saved.response ?? null);
        setAddressDetails(hydrateAddressFields(saved.lastRequest.address));
        const restoredSoc = saved.lastRequest.socCode ?? '';
        setSocCode(restoredSoc);
        setSocInput(restoredSoc);
        setSocSelectedTitle(null);
        if (saved.lastRequest.proposedSalary !== undefined) {
          setSalaryAmount(String(saved.lastRequest.proposedSalary));
        }
        if (saved.lastRequest.salaryUnit === 'hour' || saved.lastRequest.salaryUnit === 'year') {
          setSalaryUnit(saved.lastRequest.salaryUnit);
        }
      }
    } catch {
      sessionStorage.removeItem(confirmationStorageKey);
    }
  }, []);

  useEffect(() => {
    const name = sessionStorage.getItem('welcomeName');
    if (!name) return;
    setWelcomeName(name);
    sessionStorage.removeItem('welcomeName');
    const timer = window.setTimeout(() => setWelcomeName(null), 4000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!skillsMatchingEnabled || typeof window === 'undefined') {
      return;
    }
    sessionStorage.removeItem('transcriptIds');
    sessionStorage.removeItem('transcriptId');
  }, [skillsMatchingEnabled]);

  useEffect(() => {
    if (response?.kind === 'geo_needs_confirmation' && lastRequest) {
      sessionStorage.setItem(
        confirmationStorageKey,
        JSON.stringify({ ts: Date.now(), lastRequest, response }),
      );
    } else if (response) {
      sessionStorage.removeItem(confirmationStorageKey);
    }
  }, [response, lastRequest]);

  useEffect(() => {
    setDutiesCopied(false);
  }, [response?.duties]);

  useEffect(() => {
    if (!recommendPanelEnabled || typeof window === 'undefined') {
      return;
    }
    const media = window.matchMedia('(max-width: 720px)');
    const update = () => setIsMobile(media.matches);
    update();
    if (media.addEventListener) {
      media.addEventListener('change', update);
    } else {
      media.addListener(update);
    }
    return () => {
      if (media.removeEventListener) {
        media.removeEventListener('change', update);
      } else {
        media.removeListener(update);
      }
    };
  }, [recommendPanelEnabled]);

  useEffect(() => {
    if (!recommendPanelEnabled || typeof window === 'undefined') {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const focus = params.get('focusOnet');
    if (focus) {
      setRecommendSelected({ code: focus, title: null });
    }
  }, [recommendPanelEnabled]);

  useEffect(() => {
    if (!recommendSelected) return;
    if (socCode === recommendSelected.code && socSelectedTitle && !recommendSelected.title) {
      setRecommendSelected({ code: recommendSelected.code, title: socSelectedTitle });
    }
  }, [recommendSelected, socCode, socSelectedTitle]);

  const handleLogout = async () => {
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
    } finally {
      router.replace('/login');
    }
  };

  const updateFocusOnetParam = (code: string | null) => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (code) {
      url.searchParams.set('focusOnet', code);
    } else {
      url.searchParams.delete('focusOnet');
    }
    window.history.replaceState({}, '', url.toString());
  };

  const clearRecommendSelection = () => {
    if (!recommendSelected) return;
    setRecommendSelected(null);
    updateFocusOnetParam(null);
  };

  const formatMatchPercent = (value: number) => {
    const bounded = Math.min(Math.max(value, 0), 1);
    return `${(bounded * 100).toFixed(2)}%`;
  };

  const formatHourlyPreview = (value: string | null) => {
    if (!value) return '—';
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return value;
    return `$${hourlyFormatter.format(parsed)}`;
  };

  const formatAnnualPreview = (value: number | null) => {
    if (value === null || value === undefined) return '—';
    return `$${annualFormatter.format(value)}`;
  };

  const applyParsedAddress = (parsed: ParsedAddress) => {
    setAddressDetails(buildAddressFieldsFromParsed(parsed));
  };

  const handleLine1Paste = (event: ClipboardEvent<HTMLInputElement>) => {
    const raw = event.clipboardData.getData('text');
    const text = normalizeAddressInput(raw);
    if (!text) return;
    const parsed = parseFullAddress(text);
    if (parsed.city && parsed.state) {
      event.preventDefault();
      applyParsedAddress(parsed);
    }
  };

  const handleLine1Blur = () => {
    const candidate = normalizeAddressInput(addressDetails.line1);
    if (!candidate) return;
    const looksLikeFull =
      candidate.includes(',') || /\b[A-Za-z]{2}\s*\d{5}\b/.test(candidate);
    if (!looksLikeFull) return;
    const parsed = parseFullAddress(candidate);
    if (parsed.city && parsed.state) {
      applyParsedAddress(parsed);
    }
  };

  const handleStateBlur = () => {
    const normalized = normalizeStateInput(addressDetails.state);
    if (normalized && normalized !== addressDetails.state) {
      updateAddressDetail('state', normalized);
    }
  };

  const handleStateInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    const trimmed = value.trim();
    if (!trimmed) {
      updateAddressDetail('state', value);
      setStateSuggestionsOpen(false);
      setStateHighlightIndex(-1);
      return;
    }
    const normalized = normalizeStateInput(trimmed);
    if (normalized && trimmed.length > 2) {
      updateAddressDetail('state', normalized);
      setStateSuggestionsOpen(false);
      setStateHighlightIndex(-1);
      return;
    }
    updateAddressDetail('state', value);
    setStateSuggestionsOpen(true);
    setStateHighlightIndex(-1);
  };

  const handleStateSelect = (code: string) => {
    updateAddressDetail('state', code);
    setStateSuggestionsOpen(false);
    setStateHighlightIndex(-1);
  };

  const handleStateKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!stateSuggestionsOpen || stateSuggestions.length === 0) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setStateHighlightIndex((prev) => {
        const next = prev + 1;
        return next >= stateSuggestions.length ? 0 : next;
      });
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setStateHighlightIndex((prev) => {
        const next = prev - 1;
        return next < 0 ? stateSuggestions.length - 1 : next;
      });
      return;
    }
    if (event.key === 'Enter' && stateHighlightIndex >= 0) {
      event.preventDefault();
      const entry = stateSuggestions[stateHighlightIndex];
      if (entry) {
        handleStateSelect(entry.code);
      }
      return;
    }
    if (event.key === 'Escape') {
      setStateSuggestionsOpen(false);
      setStateHighlightIndex(-1);
    }
  };

  const handleSocInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    clearRecommendSelection();
    const value = event.target.value;
    if (socSelectedTitle) {
      const selectedLabel = formatOccupationLabel({ onetCode: socCode, title: socSelectedTitle });
      if (value !== selectedLabel) {
        setSocSelectedTitle(null);
      }
    }
    setSocInput(value);
    setSocCode(extractOnetCode(value));
    setSocSuggestionsOpen(true);
  };

  const handleSocSelect = (entry: OccupationSuggestion) => {
    clearRecommendSelection();
    const label = formatOccupationLabel(entry);
    setSocInput(label);
    setSocCode(entry.onetCode);
    setSocSelectedTitle(entry.title);
    setSocSuggestions([]);
    setSocSuggestionsOpen(false);
    setSocSuggestionsError('');
    setSocHighlightIndex(-1);
  };

  const handleSocKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!socSuggestionsOpen || socSuggestions.length === 0) {
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSocHighlightIndex((prev) => {
        const next = prev + 1;
        return next >= socSuggestions.length ? 0 : next;
      });
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSocHighlightIndex((prev) => {
        const next = prev - 1;
        return next < 0 ? socSuggestions.length - 1 : next;
      });
      return;
    }
    if (event.key === 'Enter' && socHighlightIndex >= 0) {
      event.preventDefault();
      const entry = socSuggestions[socHighlightIndex];
      if (entry) {
        handleSocSelect(entry);
      }
      return;
    }
    if (event.key === 'Escape') {
      setSocSuggestionsOpen(false);
      setSocHighlightIndex(-1);
    }
  };

  const selectRecommendedOnet = (onetCode: string, title: string | null) => {
    if (title) {
      setSocInput(formatOccupationLabel({ onetCode, title }));
    } else {
      setSocInput(onetCode);
    }
    setSocCode(onetCode);
    setSocSelectedTitle(title);
    setSocSuggestions([]);
    setSocSuggestionsOpen(false);
    setSocSuggestionsError('');
    setSocHighlightIndex(-1);
    setRecommendSelected({ code: onetCode, title });
    updateFocusOnetParam(onetCode);
    setRecommendOpen(false);
    if (socInputFlashTimer.current) {
      window.clearTimeout(socInputFlashTimer.current);
    }
    setSocInputFlash(true);
    if (socInputRef.current) {
      socInputRef.current.focus();
      scrollIntoViewSafely(socInputRef.current);
    }
    socInputFlashTimer.current = window.setTimeout(() => {
      setSocInputFlash(false);
    }, 1400);
  };

  const handleRecommendSelect = (item: SocRecommendItem) => {
    const title = item.matchedOnetTitle ?? item.socTitle ?? null;
    selectRecommendedOnet(item.matchedOnetCode, title);
  };

  const addTranscriptEntry = (entry: TranscriptEntry) => {
    setTranscripts((prev) => {
      if (prev.some((item) => item.id === entry.id)) {
        return prev.map((item) => (item.id === entry.id ? { ...item, ...entry } : item));
      }
      return [...prev, entry];
    });
  };

  const updateTranscriptEntry = (id: string, patch: Partial<TranscriptEntry>) => {
    setTranscripts((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    );
  };

  const getStageStatus = (
    entry: TranscriptEntry,
    stage: (typeof TRANSCRIPT_STAGE_LABELS)[number]['key'],
  ) => {
    const status = entry.status ?? '';
    const uploadDone =
      Boolean(entry.uploadEndedAt) || ['PARSING', 'READY', 'NEEDS_REVIEW', 'FAILED'].includes(status);
    const uploadActive = !uploadDone && Boolean(entry.uploadStartedAt);
    const parseActive = status === 'PARSING';
    const parseDone = Boolean(entry.parseEndedAt) || ['READY', 'NEEDS_REVIEW', 'FAILED'].includes(status);
    const ocrUsed = entry.parseUsedPath === 'ocr';

    if (stage === 'upload') {
      if (uploadDone) return 'done';
      if (uploadActive) return 'active';
      return 'pending';
    }

    if (stage === 'ocr') {
      if (ocrUsed) {
        if (parseDone) return 'done';
        if (parseActive) return 'active';
        return 'pending';
      }
      if (parseDone) return 'skipped';
      return 'pending';
    }

    if (stage === 'parse') {
      if (parseDone) return 'done';
      if (parseActive) return 'active';
      return 'pending';
    }

    if (stage === 'score') {
      if (entry.scoreStatus === 'skipped') return 'skipped';
      if (entry.scoreStatus === 'failed') return 'failed';
      if (entry.scoreStatus === 'done') return 'done';
      if (entry.scoreStartedAt && !entry.scoreEndedAt) return 'active';
      return 'pending';
    }

    return 'pending';
  };

  const formatEta = (ms: number) => {
    const seconds = Math.max(5, Math.ceil(ms / 1000));
    return `${seconds}s`;
  };

  const formatDebugScore = (value?: number) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    return value.toFixed(3);
  };

  const formatDebugReason = (reason?: string) => {
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
  };

  const getTranscriptEta = (entry: TranscriptEntry) => {
    if (entry.error) return null;
    const now = Date.now();

    if (entry.scoreStartedAt && !entry.scoreEndedAt) {
      const remaining = SCORE_ESTIMATE_MS - (now - entry.scoreStartedAt);
      return `Estimated time remaining: ~${formatEta(Math.max(remaining, 0))}`;
    }

    if (entry.status === 'PARSING' && entry.parseStartedAt) {
      const estimate =
        entry.parseUsedPath === 'ocr'
          ? PARSE_ESTIMATE_OCR_MS
          : entry.parseUsedPath === 'pdf_text'
            ? PARSE_ESTIMATE_TEXT_MS
            : PARSE_ESTIMATE_OCR_MS;
      const remaining = estimate - (now - entry.parseStartedAt);
      return `Estimated time remaining: ~${formatEta(Math.max(remaining, 0))}`;
    }

    if (entry.uploadStartedAt && !entry.uploadEndedAt) {
      const remaining = UPLOAD_ESTIMATE_MS - (now - entry.uploadStartedAt);
      return `Estimated time remaining: ~${formatEta(Math.max(remaining, 0))}`;
    }

    return null;
  };

  const refreshTranscriptStatus = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/transcripts/${id}`, { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) return;
      const status = data?.transcript?.status ?? null;
      updateTranscriptEntry(id, { status });
    } catch {
      updateTranscriptEntry(id, { status: null });
    }
  };

  useEffect(() => {
    if (pendingTranscriptIds.length === 0) return;
    const timer = window.setInterval(() => {
      pendingTranscriptIds.forEach((id) => {
        void refreshTranscriptStatus(id);
      });
      setTranscriptTick((prev) => prev + 1);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [pendingTranscriptIds.join('|')]);

  const handleTranscriptFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (transcriptUploading) {
      setTranscriptError('Upload in progress. Please wait.');
      return;
    }
    setUploadBatchBaseline(transcripts.length);
    setUploadBatchTotal(files.length);
    setTranscriptFiles(files);
    setTranscriptError('');
    setTranscriptMessage('');
    if (files.length > 0) {
      void handleTranscriptUpload(files);
    }
  };

  const fetchJsonStep = async <T,>(
    step: string,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<T> => {
    let response: Response;
    try {
      response = await fetch(input, init);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${step} request failed: ${message}`);
    }

    if (!response.ok) {
      let detail = '';
      try {
        const text = await response.text();
        if (text) {
          try {
            const parsed = JSON.parse(text) as { error?: string; message?: string };
            detail = parsed.error ?? parsed.message ?? text;
          } catch {
            detail = text;
          }
        }
      } catch {
        detail = '';
      }
      const suffix = detail ? `: ${detail}` : '';
      throw new Error(`${step} failed${suffix}`);
    }

    try {
      return (await response.json()) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${step} response parse failed: ${message}`);
    }
  };

  const computeTranscriptSkills = async (transcriptId: string, messagePrefix?: string) => {
    updateTranscriptEntry(transcriptId, {
      scoreStartedAt: Date.now(),
      scoreEndedAt: undefined,
      scoreStatus: undefined,
      error: undefined,
      message: 'Computing skills evidence...',
    });

    try {
      const computeData = await fetchJsonStep<{
        evidenceCount?: number;
        debug?: TranscriptScoreDebug;
      }>(
        'Compute skills',
        `/api/v1/transcripts/${transcriptId}/compute-ska?debug=1`,
        {
          method: 'POST',
          credentials: 'include',
        },
      );
      const evidenceCount = computeData?.evidenceCount ?? 0;
      updateTranscriptEntry(transcriptId, {
        message: `${messagePrefix ? `${messagePrefix} ` : ''}Skills evidence: ${evidenceCount}.`,
        scoreEndedAt: Date.now(),
        scoreStatus: 'done',
        scoreEvidenceCount: evidenceCount,
        scoreDebug: computeData?.debug ?? undefined,
      });
      return evidenceCount;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Skills evidence failed.';
      updateTranscriptEntry(transcriptId, {
        error: message,
        scoreEndedAt: Date.now(),
        scoreStatus: 'failed',
      });
      throw error;
    }
  };

  const transcriptStatusTotal =
    uploadBatchTotal > 0 ? uploadBatchBaseline + uploadBatchTotal : transcripts.length;

  const handleTranscriptUpload = async (filesOverride?: File[]) => {
    const filesToUpload = filesOverride ?? transcriptFiles;
    if (filesToUpload.length === 0) {
      if (!filesOverride) {
        setTranscriptError('Select one or more PDF files to upload.');
      }
      return;
    }
    setTranscriptUploading(true);
    setTranscriptError('');
    setTranscriptMessage('');

    const errors: string[] = [];
    let successCount = 0;

    for (const file of filesToUpload) {
      let transcriptId: string | null = null;
      try {
        const createData = await fetchJsonStep<TranscriptCreateResponse>(
          'Create transcript',
          '/api/v1/transcripts/create',
          {
            method: 'POST',
            credentials: 'include',
          },
        );

        transcriptId = createData.transcriptId;
        addTranscriptEntry({
          id: transcriptId,
          name: file.name,
          status: 'CREATED',
          uploadStartedAt: Date.now(),
        });

        const upload = createData.upload;
        if (upload.maxBytes && file.size > upload.maxBytes) {
          throw new Error('Selected file exceeds the upload size limit.');
        }

        let storageUrl = upload.storageUrl ?? null;
        if (upload.provider === 'vercel_blob') {
          if (!upload.clientToken || !upload.pathname) {
            throw new Error('Upload token missing.');
          }
          const result = await put(upload.pathname, file, {
            access: 'public',
            token: upload.clientToken,
            contentType: file.type || 'application/pdf',
          });
          storageUrl = result.url;
        } else if (upload.uploadUrl) {
          const uploadData = await fetchJsonStep<{ storageUrl?: string }>(
            'Upload file',
            upload.uploadUrl,
            {
              method: upload.method ?? 'PUT',
              headers: upload.headers ?? {},
              body: file,
              credentials: 'include',
            },
          );
          storageUrl = uploadData?.storageUrl ?? storageUrl;
        } else {
          throw new Error('Upload target missing.');
        }

        await fetchJsonStep(
          'Finalize upload',
          `/api/v1/transcripts/${transcriptId}/complete-upload`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ storageUrl }),
          },
        );

        updateTranscriptEntry(transcriptId, {
          status: 'UPLOADED',
          message: 'Upload complete. Parsing transcript...',
          error: undefined,
          uploadEndedAt: Date.now(),
        });

        updateTranscriptEntry(transcriptId, { status: 'PARSING', parseStartedAt: Date.now() });

        const processData = await fetchJsonStep<{ usedPath?: string; courseCount?: number }>(
          'Parse transcript',
          `/api/v1/transcripts/${transcriptId}/process`,
          {
            method: 'POST',
            credentials: 'include',
          },
        );

        await refreshTranscriptStatus(transcriptId);
        updateTranscriptEntry(transcriptId, {
          message: `Parsing complete${processData?.usedPath === 'ocr' ? ' (OCR)' : ''}. Courses detected: ${processData?.courseCount ?? 0}.`,
          parseEndedAt: Date.now(),
          parseUsedPath: processData?.usedPath ?? null,
        });

        if (processData?.courseCount > 0) {
          try {
            await computeTranscriptSkills(transcriptId, 'Parsing complete.');
          } catch {
            // Score failure is already reflected in the transcript entry.
          }
        } else {
          updateTranscriptEntry(transcriptId, {
            scoreEndedAt: Date.now(),
            scoreStatus: 'skipped',
          });
        }

        successCount += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Transcript upload failed.';
        if (transcriptId) {
          updateTranscriptEntry(transcriptId, {
            error: message,
            status: 'FAILED',
            parseEndedAt: Date.now(),
            scoreEndedAt: Date.now(),
            scoreStatus: 'failed',
          });
        } else {
          errors.push(`${file.name}: ${message}`);
        }
      }
    }

    setTranscriptFiles([]);
    if (transcriptInputRef.current) {
      transcriptInputRef.current.value = '';
    }

    if (errors.length) {
      setTranscriptError(errors.join(' '));
    }
    if (successCount > 0) {
      setTranscriptMessage(
        `Uploaded ${successCount} transcript${successCount > 1 ? 's' : ''}.`,
      );
    }

    setUploadBatchTotal(0);
    setTranscriptUploading(false);
  };

  const handleRecommendSubmit = async () => {
    const trimmed = dutiesInput.trim();
    const hasTranscript = skillsMatchingEnabled && hasAnyTranscript;
    if (hasPendingTranscript) {
      setRecommendError('Transcript is still processing. Please wait.');
      setRecommendations([]);
      setCombinedResults([]);
      return;
    }
    const pendingTranscripts = transcripts.filter(
      (entry) => !entry.status || ['CREATED', 'UPLOADED', 'PARSING'].includes(entry.status),
    );
    if (!trimmed && !hasTranscript) {
      setRecommendError(
        skillsMatchingEnabled
          ? 'Paste job duties or upload a transcript to get recommendations.'
          : 'Paste job duties to get recommendations.',
      );
      setRecommendations([]);
      setCombinedResults([]);
      return;
    }
    if (skillsMatchingEnabled && !trimmed && !hasReadyTranscript) {
      setRecommendError('Transcript not parsed yet. Please wait for processing to finish.');
      setRecommendations([]);
      setCombinedResults([]);
      return;
    }
    setRecommendLoading(true);
    setRecommendError('');
    setRecommendWarnings([]);
    setRecommendMeta(null);
    const localWarnings: string[] = [];
    try {
      if (hasReadyTranscript && skillsMatchingEnabled) {
        if (pendingTranscripts.length > 0) {
          localWarnings.push(
            'Some transcripts are still processing. Only parsed transcripts were used.',
          );
        }
        const reviewEntries = transcripts.filter((entry) => entry.status === 'NEEDS_REVIEW');
        if (reviewEntries.length > 0) {
          localWarnings.push('Some transcripts need review; results may be less reliable.');
        }
        const readyEntries = transcripts.filter((entry) =>
          READY_TRANSCRIPT_STATUSES.has(entry.status ?? ''),
        );
        let skillsEvidenceTotal = readyEntries.reduce(
          (sum, entry) =>
            sum + (typeof entry.scoreEvidenceCount === 'number' ? entry.scoreEvidenceCount : 0),
          0,
        );
        const needsCompute = readyEntries.filter(
          (entry) =>
            entry.scoreStatus === 'failed' || typeof entry.scoreEvidenceCount !== 'number',
        );

        if (needsCompute.length > 0) {
          for (const entry of needsCompute) {
            try {
              const evidenceCount = await computeTranscriptSkills(entry.id);
              skillsEvidenceTotal += evidenceCount;
            } catch {
              localWarnings.push('Some transcripts failed skill scoring.');
            }
          }
        }

        if (!trimmed && skillsEvidenceTotal === 0) {
          setRecommendError(
            'No skills evidence extracted yet. Open the transcript review to refine summaries, then retry.',
          );
          setRecommendations([]);
          setCombinedResults([]);
          if (localWarnings.length) {
            setRecommendWarnings(localWarnings);
          }
          return;
        }
        if (trimmed && skillsEvidenceTotal === 0) {
          localWarnings.push(
            'No skills evidence extracted yet. Recommendations will use duties only.',
          );
        }
        const payload: Record<string, unknown> = {
          transcript_ids: readyTranscriptIds,
        };
        if (trimmed) {
          payload.dutiesText = trimmed;
        }
        const res = await fetch('/api/v1/match/combined', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
        const data = (await readJsonResponse(res)) as CombinedMatchResponse;
        if (!res.ok) {
          throw new Error((data as any)?.error ?? 'Recommendation failed.');
        }
        setCombinedResults(Array.isArray(data.results) ? data.results : []);
        setRecommendations([]);
        setRecommendMode('combined');
        setRecommendExpanded(null);
      } else {
        const payload: Record<string, unknown> = { dutiesText: trimmed };
        const { areaCode, warning } = await resolveRecommendAreaCode();
        if (areaCode) {
          payload.areaCode = areaCode;
        }
        if (warning) {
          localWarnings.push(warning);
        }
        if (response?.wages?.wageYear) {
          payload.wageYear = response.wages.wageYear;
        }
        if (typeof response?.wages?.isAcwia === 'boolean') {
          payload.isAcwia = response.wages.isAcwia;
        }

        const res = await fetch('/api/v1/soc/recommend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
        const data = (await readJsonResponse(res)) as SocRecommendResponse;
        if (!res.ok) {
          throw new Error((data as any)?.error ?? 'Recommendation failed.');
        }
        setRecommendations(Array.isArray(data.items) ? data.items : []);
        setCombinedResults([]);
        setRecommendMode('duties');
        const apiWarnings = Array.isArray(data.warnings) ? data.warnings : [];
        setRecommendWarnings([...localWarnings, ...apiWarnings]);
        setRecommendMeta(data.meta ?? null);
        setRecommendExpanded(null);
      }
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : 'Recommendation failed.';
      const message =
        rawMessage === 'SKILLS_NOT_READY'
          ? 'No skills evidence extracted yet. Open the transcript review to refine summaries, then retry.'
          : rawMessage;
      setRecommendError(message);
      setRecommendations([]);
      setCombinedResults([]);
      if (localWarnings.length) {
        setRecommendWarnings(localWarnings);
      }
    } finally {
      setRecommendLoading(false);
    }
  };

  const buildAddressPayload = () => {
    if (!hasAddress) {
      return null;
    }
    const normalizedState = addressMeta.normalizedState;
    const line1 = addressDetails.line1.trim();
    const line2 = addressDetails.line2.trim();
    const city = addressDetails.city.trim();
    const zip = addressDetails.zip.trim();
    const fullText = composeAddressText(addressDetails, normalizedState);
    return {
      address: {
        fullText: fullText || undefined,
        line1: line1 || undefined,
        line2: line2 || undefined,
        city: city || undefined,
        state: normalizedState || undefined,
        zip: zip || undefined,
      },
    };
  };

  const buildRequestBody = (override?: {
    areaCode?: string;
    countyFips?: string;
    countyTownName?: string;
  }) => {
    const body: any = {};
    const addressPayload = buildAddressPayload();
    if (addressPayload) {
      Object.assign(body, addressPayload);
    }
    if (hasSoc) {
      body.socCode = trimmedSoc;
    }
    if (hasAddress && hasSoc && salaryAmount.trim()) {
      if (Number.isFinite(salaryNumber)) {
        body.proposedSalary = salaryNumber;
        body.salaryUnit = salaryUnit;
      }
    }
    if (override?.areaCode) {
      body.override = {
        areaCode: override.areaCode,
        countyFips: override.countyFips,
        countyTownName: override.countyTownName,
      };
    }
    return body;
  };

  const resolveRecommendAreaCode = async (): Promise<{ areaCode: string | null; warning?: string }> => {
    const areaFromResponse = response?.geo?.area?.areaCode ?? null;
    if (areaFromResponse) {
      return { areaCode: areaFromResponse };
    }

    const addressPayload = buildAddressPayload();
    if (!addressPayload) {
      return { areaCode: null };
    }

    try {
      const res = await fetch('/api/v1/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(addressPayload),
      });
      const data = await res.json();
      if (res.ok && data?.geo?.area?.areaCode) {
        return { areaCode: data.geo.area.areaCode };
      }
      if (data?.kind === 'geo_needs_confirmation') {
        return {
          areaCode: null,
          warning: 'Address needs confirmation; wage preview is unavailable.',
        };
      }
      return { areaCode: null, warning: 'Wage area could not be resolved from the address.' };
    } catch {
      return { areaCode: null, warning: 'Wage area lookup failed; wage preview is unavailable.' };
    }
  };

  const runLookup = async (override?: {
    areaCode?: string;
    countyFips?: string;
    countyTownName?: string;
  }) => {
    setLoading(true);
    setError('');
    if (detectedMode === 'none') {
      setError('Paste an address, enter an occupation code, or both.');
      setLoading(false);
      return;
    }
    const body = buildRequestBody(override);
    setLastRequest(body);

    try {
      const res = await fetch('/api/v1/lookup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? 'Request failed.');
      }
      setResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setResponse(null);
    } finally {
      setLoading(false);
    }
  };

  const resendWithOverride = (entry: {
    areaCode: string;
    countyFips?: string | null;
    countyTownName?: string | null;
  }) => {
    const base = lastRequest ?? buildRequestBody();
    const override = {
      areaCode: entry.areaCode,
      countyFips: entry.countyFips ?? undefined,
      countyTownName: entry.countyTownName ?? undefined,
    };
    runLookup(override);
    setLastRequest({ ...base, override });
  };

  const updateAddressDetail = (field: keyof AddressFields, value: string) => {
    setAddressDetails((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const runCandidateSearch = async () => {
    const geoState = response?.geo?.geocode?.stateAb;
    const stateAb =
      (geoState && geoState !== 'NA' ? geoState : null) ||
      normalizeStateInput(addressDetails.state);
    if (!stateAb) {
      setCandidateError('State is required to search candidates.');
      return;
    }

    setCandidateLoading(true);
    setCandidateError('');
    try {
      const url = new URL('/api/v1/geo/candidates', window.location.origin);
      url.searchParams.set('state', stateAb);
      if (candidateQuery.trim()) {
        url.searchParams.set('q', candidateQuery.trim());
      }
      const res = await fetch(url.toString(), { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? 'Candidate search failed.');
      }
      setCandidateResults(data.items ?? []);
    } catch (err) {
      setCandidateError(err instanceof Error ? err.message : 'Candidate search failed.');
      setCandidateResults([]);
    } finally {
      setCandidateLoading(false);
    }
  };

  const openCandidateSearch = () => {
    setShowCandidateSearch(true);
  };

  const closeCandidateSearch = () => {
    setShowCandidateSearch(false);
    setCandidateQuery('');
    setCandidateResults([]);
    setCandidateError('');
  };

  const formatMoney = (value: number | null | undefined, unit: 'year' | 'hour') => {
    if (value === null || value === undefined) {
      return '—';
    }
    const formatter = unit === 'hour' ? hourlyFormatter : annualFormatter;
    return `$${formatter.format(value)}`;
  };

  const handleCopyDuties = async () => {
    if (!response?.duties?.duties?.length) {
      return;
    }
    const text = response.duties.duties.map((duty: any) => `- ${duty.text}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setDutiesCopied(true);
      window.setTimeout(() => setDutiesCopied(false), 2000);
    } catch {
      setDutiesCopied(false);
    }
  };

  const renderResults = () => {
    if (!response) return null;

    const countyName = response.geo?.countyName ?? response.geo?.geocode?.countyName ?? null;
    const wageAreaName = response.geo?.area?.areaName ?? null;
    const placeName = response.geo?.geocode?.placeName ?? null;
    const stateAb = response.geo?.geocode?.stateAb ?? response.geo?.area?.stateAb ?? null;
    let townshipLabel = wageAreaName ?? placeName;
    if (!wageAreaName && townshipLabel && stateAb) {
      if (!townshipLabel.includes(',') && !townshipLabel.includes(stateAb)) {
        townshipLabel = `${townshipLabel}, ${stateAb}`;
      }
    }
    const hasGeo = Boolean(response.geo?.geocode || response.geo?.area || response.geo?.cbsa);
    const hasWages = Boolean(response.wages?.level1);
    const hasDuties = Boolean(response.duties?.duties?.length);
    const dutiesJobZone = response.duties?.jobZone ?? null;
    const hasExtremes = Boolean(response.extremes);
    const formatAreaLabel = (area?: {
      displayName?: string | null;
      areaName?: string | null;
      stateAb?: string | null;
    }) => {
      if (!area) return 'Unknown area';
      return area.displayName || area.areaName || 'Unknown area';
    };
    const combinedWarnings = Array.from(
      new Set([...(response.warnings ?? []), ...(addressMeta.warnings ?? [])]),
    );

    return (
      <div className={styles.results} data-testid="results">
        <div className={styles.resultsHeader}>
          <h2 className={styles.resultsTitle}>Results</h2>
          <span className={styles.pill} data-testid="result-kind">
            Kind: {response.kind}
          </span>
        </div>

        {combinedWarnings.length ? (
          <div className={styles.warning} data-testid="warnings">
            Warnings: {combinedWarnings.join('; ')}
          </div>
        ) : null}

        <div className={styles.resultsGrid}>
          {response.kind === 'geo_needs_confirmation' && response.confirmation?.suggestions ? (
            <div
              ref={confirmationCardRef}
              className={`${styles.card} ${styles.spanTwo} ${styles.confirmationCard}`}
              data-testid="confirmation-card"
            >
              <h3 className={styles.cardTitle}>Confirmation Needed</h3>
              <ul className={styles.list} data-testid="confirmation-list">
                {response.confirmation.suggestions.map((entry: any) => (
                  <li key={`${entry.areaCode}-${entry.countyFips}`}>
                    {entry.countyTownName} → {entry.areaName} ({entry.areaCode})
                    <button
                      className={styles.chipButton}
                      type="button"
                    onClick={() => resendWithOverride(entry)}
                    >
                      Use
                    </button>
                  </li>
                ))}
              </ul>
              {showCandidateSearch ? (
                <div className={styles.confirmationSearch}>
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={closeCandidateSearch}
                  >
                    Hide search
                  </button>
                  <div className={styles.formGrid}>
                    <label className={styles.field}>
                      <span className={styles.label}>Search by county/town name</span>
                      <input
                        className={styles.input}
                        value={candidateQuery}
                        onChange={(event) => setCandidateQuery(event.target.value)}
                        data-testid="candidate-search-input"
                      />
                    </label>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => runCandidateSearch()}
                      disabled={candidateLoading}
                      data-testid="candidate-search-button"
                    >
                      {candidateLoading ? 'Searching...' : 'Search'}
                    </button>
                    {candidateError ? (
                      <div className={styles.error} data-testid="candidate-error">
                        {candidateError}
                      </div>
                    ) : null}
                    {candidateResults.length ? (
                      <ul className={styles.list} data-testid="candidate-results">
                        {candidateResults.map((entry) => (
                          <li key={`${entry.areaCode}-${entry.countyFips}`}>
                            {entry.countyTownName} → {entry.areaName} ({entry.areaCode})
                            <button
                              className={styles.chipButton}
                              type="button"
                          onClick={() => resendWithOverride(entry)}
                            >
                              Use
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className={styles.confirmationToggle}>
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={openCandidateSearch}
                  >
                    Cannot find your county? Search manually
                  </button>
                </div>
              )}
            </div>
          ) : null}
          <div className={`${styles.card} ${styles.primaryCard}`}>
            <h3 className={styles.cardTitle}>County / Township</h3>
            {hasGeo ? (
              <>
                <div className={styles.primaryLine}>
                  {countyName ? (
                    <span className={styles.primaryCounty} data-testid="geo-county">
                      {countyName}
                    </span>
                  ) : (
                    <span data-testid="geo-county">County unavailable</span>
                  )}
                  {townshipLabel ? (
                    <>
                      <span className={styles.primaryDivider}>-</span>
                      <span data-testid="geo-place">{townshipLabel}</span>
                    </>
                  ) : null}
                </div>
                {response.geo?.area ? (
                  <span className={styles.srOnly} data-testid="area-name">
                    {response.geo.area.areaName}
                  </span>
                ) : null}
                {response.geo?.area ? (
                  <span className={styles.srOnly} data-testid="area-code">
                    {response.geo.area.areaCode}
                  </span>
                ) : null}
              </>
            ) : (
              <div className={styles.cardHint}>Add an address to resolve the county/township.</div>
            )}
          </div>

          <div className={styles.card}>
            <h3 className={styles.cardTitle}>Prevailing Wage</h3>
            {hasWages ? (
              <>
                {response.featureFlags?.wageQualityBanner && response.wages.dataQuality ? (
                  <div className={styles.warning} data-testid="wage-quality-banner">
                    Wage data quality flag detected.
                    {response.wages.dataQuality.notes?.length ? (
                      <ul className={styles.list}>
                        {response.wages.dataQuality.notes.map((note: string, idx: number) => (
                          <li key={`${note}-${idx}`}>{note}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
                {response.wages.proposedSalary || response.wages.metWageLevel ? (
                  <div className={styles.metaRow}>
                    {response.wages.proposedSalary ? (
                      <span data-testid="proposed-salary" className={styles.metaItem}>
                        Proposed: {response.wages.proposedSalary.amount} /{' '}
                        {response.wages.proposedSalary.unit}
                      </span>
                    ) : null}
                    {response.wages.metWageLevel ? (
                      <span data-testid="met-wage-level" className={styles.metaItem}>
                        Met Level: {response.wages.metWageLevel.metLevel}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Wage Level</th>
                      <th className={styles.tableNumber}>Hourly</th>
                      <th className={styles.tableNumber}>Yearly</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><span className={styles.levelBadge}>I</span></td>
                      <td className={styles.tableNumber} data-testid="wage-l1-hourly">
                        {formatMoney(response.wages.level1?.hourly, 'hour')}
                      </td>
                      <td className={styles.tableNumber} data-testid="wage-l1-annual">
                        {formatMoney(response.wages.level1?.annual, 'year')}
                      </td>
                    </tr>
                    <tr>
                      <td><span className={styles.levelBadge}>II</span></td>
                      <td className={styles.tableNumber} data-testid="wage-l2-hourly">
                        {formatMoney(response.wages.level2?.hourly, 'hour')}
                      </td>
                      <td className={styles.tableNumber} data-testid="wage-l2-annual">
                        {formatMoney(response.wages.level2?.annual, 'year')}
                      </td>
                    </tr>
                    <tr>
                      <td><span className={styles.levelBadge}>III</span></td>
                      <td className={styles.tableNumber} data-testid="wage-l3-hourly">
                        {formatMoney(response.wages.level3?.hourly, 'hour')}
                      </td>
                      <td className={styles.tableNumber} data-testid="wage-l3-annual">
                        {formatMoney(response.wages.level3?.annual, 'year')}
                      </td>
                    </tr>
                    <tr>
                      <td><span className={styles.levelBadge}>IV</span></td>
                      <td className={styles.tableNumber} data-testid="wage-l4-hourly">
                        {formatMoney(response.wages.level4?.hourly, 'hour')}
                      </td>
                      <td className={styles.tableNumber} data-testid="wage-l4-annual">
                        {formatMoney(response.wages.level4?.annual, 'year')}
                      </td>
                    </tr>
                  </tbody>
                </table>
                {response.wages.metWageLevel?.notes?.length ? (
                  <ul className={styles.list}>
                    {response.wages.metWageLevel.notes.map((note: string, idx: number) => (
                      <li key={`${note}-${idx}`}>{note}</li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <div className={styles.cardHint}>
                {!hasAddress && !hasSoc
                  ? 'Enter an address and occupation code to see prevailing wages.'
                  : !hasSoc
                    ? 'Add an occupation code to see prevailing wage levels.'
                    : response.kind === 'geo_needs_confirmation'
                      ? 'Confirm a wage area to see prevailing wages.'
                      : !hasAddress
                        ? 'Add an address to get area-specific wages.'
                        : 'Run an address + occupation lookup to see prevailing wages.'}
              </div>
            )}
          </div>

          <div className={`${styles.card} ${styles.spanTwo}`}>
            <div className={styles.cardHeaderRow}>
              <div className={styles.cardTitleRow}>
                <h3 className={`${styles.cardTitle} ${styles.cardTitleInline}`}>Tasks</h3>
                {typeof dutiesJobZone === 'number' ? (
                  <span className={styles.jobZoneBadge}>Job Zone {dutiesJobZone}</span>
                ) : null}
              </div>
              <div className={styles.cardHeaderActions}>
                {onetSummaryUrl ? (
                  <a
                    className={styles.linkButton}
                    href={onetSummaryUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    O*NET profile
                  </a>
                ) : null}
                {hasDuties ? (
                  <button
                    type="button"
                    className={`${styles.copyButton} ${dutiesCopied ? styles.copyButtonSuccess : ''}`}
                    onClick={handleCopyDuties}
                  >
                    {dutiesCopied ? 'Copied' : 'Copy tasks'}
                  </button>
                ) : null}
              </div>
            </div>
            {hasDuties ? (
              <ul className={styles.list} data-testid="duties-list">
                {response.duties.duties.map((duty: any, idx: number) => (
                  <li key={`${duty.text}-${idx}`}>{duty.text}</li>
                ))}
              </ul>
            ) : response.duties?.note ? (
              <div data-testid="duties-note">{response.duties.note}</div>
            ) : (
              <div className={styles.cardHint}>
                {!hasSoc
                  ? 'Add an occupation code to see O*NET tasks.'
                  : response.kind === 'geo_needs_confirmation'
                    ? 'Confirm the area to unlock tasks.'
                    : 'Tasks are shown when an occupation code is provided.'}
              </div>
            )}
          </div>

          <div className={`${styles.card} ${styles.spanTwo}`}>
            <h3 className={styles.cardTitle}>Location extremes for Level 1 prevailing wages</h3>
            {hasExtremes ? (
              <table className={styles.table} data-testid="extremes-table">
                <thead>
                  <tr>
                    <th>Lowest</th>
                    <th>Highest</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({
                    length: Math.max(
                      response.extremes.lowest.length,
                      response.extremes.highest.length,
                    ),
                  }).map((_, index) => {
                    const low = response.extremes.lowest[index];
                    const high = response.extremes.highest[index];
                    return (
                      <tr key={`extreme-${index}`}>
                        <td data-testid="extremes-lowest">
                          {low
                            ? `${formatAreaLabel(low.area)}: ${formatMoney(
                              low.level1?.annual,
                              'year',
                            )}`
                            : '—'}
                        </td>
                        <td data-testid="extremes-highest">
                          {high
                            ? `${formatAreaLabel(high.area)}: ${formatMoney(
                              high.level1?.annual,
                              'year',
                            )}`
                            : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className={styles.cardHint}>
                {!hasSoc
                  ? 'Enter an occupation code to compare wage extremes across areas.'
                  : 'Extremes are available when an occupation code is provided.'}
              </div>
            )}
          </div>
        </div>

        {response.explain?.summary?.length ? (
          <div className={styles.srOnly}>
            <ul data-testid="explain-list">
              {response.explain.summary.map((entry: string, idx: number) => (
                <li key={`${entry}-${idx}`}>{entry}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  };

  if (!authMode) {
    return (
      <main className={styles.page}>
        <div className={styles.background} aria-hidden="true">
          <div className={`${styles.orb} ${styles.orbPrimary}`} />
          <div className={`${styles.orb} ${styles.orbSecondary}`} />
          <div className={`${styles.orb} ${styles.orbAccent}`} />
        </div>
        <div className={styles.container}>
          <div className={styles.header}>
            <div className={styles.brand}>
              <div className={styles.titleRow}>
                <h1 className={styles.title}>H1B SOC</h1>
                <span className={styles.datasetTag}>7/2025-6/2026</span>
              </div>
              <p className={styles.subtitle}>Loading...</p>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.background} aria-hidden="true">
        <div className={`${styles.orb} ${styles.orbPrimary}`} />
        <div className={`${styles.orb} ${styles.orbSecondary}`} />
        <div className={`${styles.orb} ${styles.orbAccent}`} />
      </div>
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.brand}>
            <div className={styles.titleRow}>
              <h1 className={styles.title}>H1B SOC</h1>
              <span className={styles.datasetTag}>7/2025-6/2026</span>
            </div>
            <p className={styles.subtitle}>Query wage and O*NET data with address and occupation inputs.</p>
          </div>
          {authMode === 'invite' && authEmail ? (
            <div className={styles.authCard}>
              <div className={styles.authLabel}>Signed in as</div>
              <div className={styles.authValue}>{authEmail}</div>
              <button type="button" className={styles.ghostButton} onClick={handleLogout}>
                Sign Out
              </button>
            </div>
          ) : authMode === 'public' ? (
            <div className={styles.authCard}>
              <div className={styles.authLabel}>Access</div>
              <div className={styles.authValue}>Public access</div>
            </div>
          ) : null}
        </div>

        {welcomeName ? (
          <div className={styles.toast} role="status" data-testid="welcome-toast">
            <span className={styles.toastIcon}>✓</span>
            <span>Welcome to H1B Wage Lookup, {welcomeName}!</span>
          </div>
        ) : null}

        <section className={styles.section}>
          <div className={styles.card}>
            {modeLabel ? (
              <div className={styles.modeBadge} data-testid="detected-mode">
                {modeLabel}
              </div>
            ) : (
              <div className={styles.emptyHint} data-testid="empty-hint">
                Paste an address, enter an occupation code, or both.
              </div>
            )}

            <div className={styles.formGrid}>
              <div className={styles.field}>
                <span className={styles.label}>Address</span>
                <div className={styles.helper}>
                  Paste a full address into Line 1 to auto-fill City, State, and ZIP.
                </div>
                <div className={styles.detailCard} data-testid="address-details">
                  <div className={styles.formGrid}>
                    <label className={styles.field}>
                      <span className={styles.label}>Line 1</span>
                      <input
                        className={styles.input}
                        value={addressDetails.line1}
                        onChange={(event) => updateAddressDetail('line1', event.target.value)}
                        onPaste={handleLine1Paste}
                        onBlur={handleLine1Blur}
                        placeholder="Street address or paste full address"
                        data-testid="address-line1"
                      />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>Line 2</span>
                      <input
                        className={styles.input}
                        value={addressDetails.line2}
                        onChange={(event) => updateAddressDetail('line2', event.target.value)}
                        data-testid="address-line2"
                      />
                    </label>
                    <div className={styles.inlineRow}>
                      <label className={styles.field}>
                        <span className={styles.label}>
                          City <span className={styles.required}>*</span>
                        </span>
                        <input
                          className={styles.input}
                          value={addressDetails.city}
                          onChange={(event) => updateAddressDetail('city', event.target.value)}
                          data-testid="address-city"
                        />
                      </label>
                      <label className={styles.field}>
                        <span className={styles.label}>
                          State <span className={styles.required}>*</span>
                        </span>
                        <div className={styles.autocomplete}>
                          <input
                            className={styles.input}
                            value={addressDetails.state}
                            onChange={handleStateInputChange}
                            onFocus={() => {
                              if (stateBlurTimer.current) {
                                window.clearTimeout(stateBlurTimer.current);
                                stateBlurTimer.current = null;
                              }
                              if (stateSuggestions.length) {
                                setStateSuggestionsOpen(true);
                              }
                            }}
                            onBlur={() => {
                              handleStateBlur();
                              if (stateBlurTimer.current) {
                                window.clearTimeout(stateBlurTimer.current);
                              }
                              stateBlurTimer.current = window.setTimeout(() => {
                                setStateSuggestionsOpen(false);
                              }, 150);
                            }}
                            onKeyDown={handleStateKeyDown}
                            data-testid="address-state"
                            role="combobox"
                            aria-autocomplete="list"
                            aria-expanded={stateSuggestionsOpen}
                            aria-haspopup="listbox"
                            aria-controls={stateSuggestionsOpen ? stateListboxId : undefined}
                            aria-activedescendant={
                              stateSuggestionsOpen ? stateActiveId : undefined
                            }
                          />
                          {stateSuggestionsOpen ? (
                            <div
                              className={styles.suggestionsPanel}
                              role="listbox"
                              id={stateListboxId}
                              data-testid="state-suggestions"
                            >
                              {stateSuggestions.length ? (
                                <ul className={styles.suggestionsList}>
                                  {stateSuggestions.map((entry, index) => {
                                    const isActive = index === stateHighlightIndex;
                                    return (
                                      <li key={entry.code}>
                                    <button
                                      type="button"
                                      className={`${styles.suggestionItem} ${isActive ? styles.suggestionItemActive : ''}`}
                                      id={`${stateListboxId}-option-${entry.code}`}
                                      onMouseDown={(event) => {
                                        event.preventDefault();
                                        handleStateSelect(entry.code);
                                          }}
                                          onMouseEnter={() => setStateHighlightIndex(index)}
                                          role="option"
                                          aria-selected={isActive}
                                        >
                                          <span className={styles.suggestionCode}>{entry.code}</span>
                                          <span className={styles.suggestionTitle}>{entry.name}</span>
                                        </button>
                                      </li>
                                    );
                                  })}
                                </ul>
                              ) : (
                                <div className={styles.suggestionsEmpty}>No matches found.</div>
                              )}
                            </div>
                          ) : null}
                        </div>
                      </label>
                      <label className={styles.field}>
                        <span className={styles.label}>ZIP</span>
                        <input
                          className={styles.input}
                          value={addressDetails.zip}
                          onChange={(event) => updateAddressDetail('zip', event.target.value)}
                          data-testid="address-zip"
                        />
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              <label className={styles.field}>
                <span className={styles.label}>Occupation (O*NET) Code and Title</span>
                <div className={styles.autocomplete}>
                  <input
                    ref={socInputRef}
                    className={`${styles.input} ${socInputFlash ? styles.inputHighlight : ''}`}
                    value={socInput}
                    onChange={handleSocInputChange}
                    onFocus={() => {
                      if (socBlurTimer.current) {
                        window.clearTimeout(socBlurTimer.current);
                        socBlurTimer.current = null;
                      }
                      if (socSuggestions.length) {
                        setSocSuggestionsOpen(true);
                      }
                    }}
                    onBlur={() => {
                      if (socBlurTimer.current) {
                        window.clearTimeout(socBlurTimer.current);
                      }
                      socBlurTimer.current = window.setTimeout(() => {
                        setSocSuggestionsOpen(false);
                      }, 150);
                    }}
                    onKeyDown={handleSocKeyDown}
                    placeholder="Type search term here"
                    data-testid="soc-input"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={socSuggestionsOpen}
                    aria-haspopup="listbox"
                    aria-controls={socSuggestionsOpen ? socListboxId : undefined}
                    aria-activedescendant={socSuggestionsOpen ? socActiveId : undefined}
                  />
                  {socSuggestionsOpen ? (
                    <div
                      className={styles.suggestionsPanel}
                      role="listbox"
                      id={socListboxId}
                      data-testid="soc-suggestions"
                    >
                      {socSuggestionsLoading ? (
                        <div className={styles.suggestionsStatus}>Searching occupations...</div>
                      ) : null}
                      {socSuggestionsError ? (
                        <div className={styles.suggestionsError}>{socSuggestionsError}</div>
                      ) : null}
                      {!socSuggestionsLoading && !socSuggestionsError ? (
                        socSuggestions.length ? (
                          <ul className={styles.suggestionsList}>
                            {socSuggestions.map((entry, index) => {
                              const isActive = index === socHighlightIndex;
                              return (
                                <li key={entry.onetCode}>
                                  <button
                                    type="button"
                                    className={`${styles.suggestionItem} ${isActive ? styles.suggestionItemActive : ''}`}
                                    id={`${socListboxId}-option-${entry.onetCode}`}
                                    onMouseDown={(event) => {
                                      event.preventDefault();
                                      handleSocSelect(entry);
                                    }}
                                    onMouseEnter={() => setSocHighlightIndex(index)}
                                    role="option"
                                    aria-selected={isActive}
                                  >
                                    <span className={styles.suggestionMeta}>
                                      <span className={styles.suggestionCode}>{entry.onetCode}</span>
                                      {entry.jobZone ? (
                                        <span className={styles.jobZoneBadge}>
                                          Job Zone {entry.jobZone}
                                        </span>
                                      ) : null}
                                    </span>
                                    <span className={styles.suggestionTitle}>{entry.title}</span>
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <div className={styles.suggestionsEmpty}>No matches found.</div>
                        )
                      ) : null}
                    </div>
                  ) : null}
                </div>
              {socSuffixMatch ? (
                <span className={styles.hintStrong} data-testid="soc-suffix-note">
                  Using {socSuffixMatch[1]} for wages (O*NET suffix .{socSuffixMatch[2]} ignored).
                  {' '}
                  Tasks keep the O*NET {socSuffixMatch[1]}.{socSuffixMatch[2]} suffix.
                </span>
              ) : null}
            </label>

            {recommendPanelEnabled ? (
              recommendOpen ? (
                <div className={`${styles.recommenderPanel} ${styles.formSpan}`} data-testid="soc-recommender">
                  <div className={styles.recommenderHeader}>
                    <div>
                      <div className={styles.recommenderHeading}>
                        <span className={styles.recommenderHeadingTitle}>Recommend O*NET codes</span>
                        <span className={styles.recommenderTag}>Top 6</span>
                      </div>
                      <div className={styles.helper}>
                        {skillsMatchingEnabled
                          ? 'Paste job duties and/or upload a transcript to get Top 6 O*NET codes.'
                          : 'Paste job duties to get Top 6 O*NET codes.'}
                      </div>
                    </div>
                    <button
                      type="button"
                      className={styles.ghostButton}
                      onClick={() => setRecommendOpen(false)}
                    >
                      Hide
                    </button>
                  </div>
                  <textarea
                    id="soc-recommender-input"
                    className={`${styles.textarea} ${styles.recommenderTextarea}`}
                    rows={4}
                    value={dutiesInput}
                    onChange={(event) => setDutiesInput(event.target.value)}
                    placeholder="Paste job duties here"
                    data-testid="soc-recommender-input"
                  />
                  {skillsMatchingEnabled ? (
                    <div className={styles.transcriptUpload} data-testid="transcript-upload">
                      <div className={styles.transcriptUploadRow}>
                        <label className={styles.transcriptUploadLabel}>
                          Transcript PDF
                          <input
                            type="file"
                            accept="application/pdf"
                            className={styles.transcriptUploadInput}
                            multiple
                            ref={transcriptInputRef}
                            onChange={handleTranscriptFileChange}
                            disabled={transcriptUploading}
                          />
                        </label>
                      </div>
                      {transcriptFiles.length ? (
                        <div className={styles.transcriptSelection}>
                          <span>Selected {transcriptFiles.length} file(s):</span>
                          <ul className={styles.transcriptFileList}>
                            {transcriptFiles.map((file) => (
                              <li key={`${file.name}-${file.size}`} className={styles.transcriptFileItem}>
                                {file.name}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      <div className={styles.transcriptStatusRow}>
                        <span className={styles.transcriptStatusLabel}>Transcript status:</span>
                        <span>
                          {hasAnyTranscript
                            ? `${readyTranscriptIds.length}/${transcriptStatusTotal} parsed`
                            : 'not uploaded'}
                        </span>
                      </div>
                      {transcripts.length ? (
                        <div className={styles.transcriptList}>
                          {transcripts.map((entry) => {
                            const isPending =
                              !entry.status ||
                              ['CREATED', 'UPLOADED', 'PARSING'].includes(entry.status);
                            const isScoring = Boolean(entry.scoreStartedAt && !entry.scoreEndedAt);
                            const statusLabel = entry.status
                              ? entry.status.replace(/_/g, ' ')
                              : 'pending';
                            const displayStatus = isScoring ? 'scoring' : statusLabel;
                            const etaLabel = getTranscriptEta(entry);
                            const queueIndex = pendingQueueIds.indexOf(entry.id);
                            const queueLabel =
                              queueIndex >= 0 && pendingQueueIds.length > 1
                                ? `Queue position: ${queueIndex + 1}/${pendingQueueIds.length}`
                                : null;
                            return (
                            <div key={entry.id} className={styles.transcriptCard}>
                              <div className={styles.transcriptCardHeader}>
                                <span className={styles.transcriptCardName}>
                                  {entry.name ?? `Transcript ${entry.id.slice(0, 8)}`}
                                </span>
                                <span
                                  className={`${styles.transcriptCardStatus} ${
                                    isPending || isScoring ? styles.transcriptCardStatusPending : ''
                                  }`}
                                >
                                  {displayStatus}
                                  {isPending || isScoring ? (
                                    <span className={styles.transcriptStatusDot} aria-hidden />
                                  ) : null}
                                </span>
                              </div>
                              {entry.message ? (
                                <div className={styles.transcriptCardMeta}>{entry.message}</div>
                              ) : null}
                              {entry.error ? (
                                <div className={styles.error}>{entry.error}</div>
                              ) : null}
                              {isPending ? (
                                <div className={styles.transcriptPendingHint}>
                                  Processing<span className={styles.transcriptDots} />
                                </div>
                              ) : isScoring ? (
                                <div className={styles.transcriptPendingHint}>
                                  Computing skills<span className={styles.transcriptDots} />
                                </div>
                              ) : null}
                              {isPending || isScoring ? (
                                <div className={styles.transcriptProgress} aria-hidden="true" />
                              ) : null}
                              <div className={styles.transcriptStages}>
                                {TRANSCRIPT_STAGE_LABELS.map((stage) => {
                                  const stageStatus = getStageStatus(entry, stage.key);
                                  const stageClass =
                                    stageStatus === 'done'
                                      ? styles.transcriptStageDone
                                      : stageStatus === 'active'
                                        ? styles.transcriptStageActive
                                        : stageStatus === 'skipped'
                                          ? styles.transcriptStageSkipped
                                          : stageStatus === 'failed'
                                            ? styles.transcriptStageFailed
                                            : styles.transcriptStagePending;
                                  return (
                                    <div
                                      key={stage.key}
                                      className={`${styles.transcriptStage} ${stageClass}`}
                                    >
                                      <span className={styles.transcriptStageDot} aria-hidden />
                                      <span>{stage.label}</span>
                                    </div>
                                  );
                                })}
                              </div>
                              {etaLabel ? (
                                <div className={styles.transcriptEta}>{etaLabel}</div>
                              ) : null}
                              {queueLabel ? (
                                <div className={styles.transcriptQueue}>{queueLabel}</div>
                              ) : null}
                              {entry.scoreDebug ? (
                                <details className={styles.transcriptDebug}>
                                  <summary>Skill scoring debug</summary>
                                  <div className={styles.transcriptDebugSummary}>
                                    Courses: {entry.scoreDebug.totalCourses} total ·{' '}
                                    {entry.scoreDebug.eligibleCourses} eligible ·{' '}
                                    {entry.scoreDebug.scoredCourses} embedded · Evidence:{' '}
                                    {entry.scoreEvidenceCount ?? 0}
                                  </div>
                                  <div className={styles.transcriptDebugList}>
                                    {entry.scoreDebug.courses.map((course) => {
                                      const reason = formatDebugReason(course.reason);
                                      const statusLabel =
                                        course.status === 'matched'
                                          ? `matched (${course.matchCount ?? 0})`
                                          : course.status.replace('_', ' ');
                                      const thresholdLabel =
                                        course.thresholdUsed && course.thresholdUsed !== 'none'
                                          ? ` • ${course.thresholdUsed}`
                                          : '';
                                      const detailParts = [
                                        statusLabel + thresholdLabel,
                                        reason,
                                      ].filter(Boolean);
                                      const topSkill = course.topSkill
                                        ? `Top skill: ${course.topSkill.name} (${course.topSkill.taxonomyType})`
                                        : 'Top skill: —';
                                      return (
                                        <div
                                          key={`${entry.id}-${course.courseKey}`}
                                          className={styles.transcriptDebugItem}
                                        >
                                          <div className={styles.transcriptDebugTitle}>
                                            {course.title}
                                          </div>
                                          <div className={styles.transcriptDebugMeta}>
                                            {detailParts.join(' • ')}
                                          </div>
                                          <div className={styles.transcriptDebugMeta}>
                                            Max score: {formatDebugScore(course.maxScore)} •{' '}
                                            {topSkill}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </details>
                              ) : null}
                              {entry.status === 'READY' || entry.status === 'NEEDS_REVIEW' ? (
                                <Link className={styles.transcriptLink} href={`/transcripts/${entry.id}`}>
                                  Review transcript
                                </Link>
                              ) : (
                                <span className={styles.transcriptPending}>
                                  Review available after parsing
                                </span>
                              )}
                            </div>
                          );
                          })}
                        </div>
                      ) : null}
                      {transcriptError ? (
                        <div className={styles.error}>{transcriptError}</div>
                      ) : null}
                      {transcriptMessage ? (
                        <div className={styles.success}>{transcriptMessage}</div>
                      ) : null}
                    </div>
                  ) : null}
                  <div className={styles.recommenderActions}>
                    <button
                      type="button"
                      className={`${styles.primaryButton} ${styles.recommenderAction}`}
                      onClick={handleRecommendSubmit}
                      disabled={recommendDisabled}
                      data-testid="soc-recommender-submit"
                    >
                      {recommendLoading ? 'Matching...' : 'Recommend Top 6 O*NET Codes'}
                    </button>
                    {recommendDisabledReason ? (
                      <div className={styles.recommenderHint}>{recommendDisabledReason}</div>
                    ) : null}
                  </div>
                  {recommendError ? (
                    <div className={styles.error} data-testid="soc-recommender-error">
                      {recommendError}
                    </div>
                  ) : null}
                  {recommendWarnings.length ? (
                    <div className={styles.warning} data-testid="soc-recommender-warnings">
                      {recommendWarnings.join(' ')}
                    </div>
                  ) : null}
                  {recommendMeta?.inputTruncated ? (
                    <div className={styles.warning} data-testid="soc-recommender-truncated">
                      Duties were truncated for matching.
                    </div>
                  ) : null}
                  {recommendSelected ? (
                    <div className={styles.recommenderBanner} data-testid="soc-recommend-banner">
                      <span>
                        Selected O*NET:{' '}
                        <strong>{recommendSelected.code}</strong>
                        {recommendSelected.title ? ` — ${recommendSelected.title}` : ''}
                      </span>
                      <button
                        type="button"
                        className={styles.ghostButton}
                        onClick={() => clearRecommendSelection()}
                      >
                        Clear
                      </button>
                    </div>
                  ) : null}
                  {recommendMode === 'combined' ? (
                    combinedResults.length ? (
                      <div className={styles.recommenderGrid} data-testid="soc-combined-list">
                        {combinedResults.map((item) => {
                          const isSelected = recommendSelected?.code === item.onet_code;
                          const title = item.onet_title ?? 'Unknown title';
                          const duties = item.duties ?? [];
                          const dutiesCount =
                            typeof item.duties_count === 'number'
                              ? item.duties_count
                              : duties.length;
                          const dutiesAvailable =
                            typeof item.duties_available === 'boolean'
                              ? item.duties_available
                              : dutiesCount > 0;
                          const hasMoreDuties = dutiesAvailable && dutiesCount > previewCount;
                          const isExpanded =
                            !hasMoreDuties || recommendExpanded === item.onet_code;
                          const showDutiesList = !isMobile || isExpanded;
                          const dutiesToShow = isExpanded
                            ? duties
                            : duties.slice(0, previewCount);
                          const remainingDuties = Math.max(dutiesCount - previewCount, 0);
                          return (
                            <div
                              key={item.onet_code}
                              className={styles.recommenderCard}
                              data-testid="soc-combined-card"
                            >
                              <div className={styles.recommenderCardHeader}>
                                <div>
                                  <div className={styles.recommenderCode}>{item.onet_code}</div>
                                  <div className={styles.recommenderTitle}>{title}</div>
                                  {item.job_zone ? (
                                    <div className={styles.recommenderJobZone}>
                                      <span className={styles.jobZoneBadge}>
                                        Job Zone {item.job_zone}
                                      </span>
                                    </div>
                                  ) : null}
                                  {item.skills_gate ? (
                                    <div className={styles.recommenderJobZone}>
                                      <span
                                        className={`${styles.skillsGateBadge} ${
                                          item.skills_gate === 'pass'
                                            ? styles.skillsGatePass
                                            : item.skills_gate === 'fail'
                                              ? styles.skillsGateFail
                                              : styles.skillsGateSkipped
                                        }`}
                                      >
                                        Skills {item.skills_gate}
                                      </span>
                                    </div>
                                  ) : null}
                                </div>
                                {isSelected ? (
                                  <span className={styles.recommenderSelected}>✓ Selected</span>
                                ) : (
                                  <button
                                    type="button"
                                    className={`${styles.primaryButton} ${styles.recommenderSelect}`}
                                    onClick={() => {
                                      selectRecommendedOnet(item.onet_code, item.onet_title ?? null);
                                    }}
                                  >
                                    Select
                                  </button>
                                )}
                              </div>
                              <div className={styles.recommenderMetaRow}>
                                <span className={styles.recommenderMetaItem}>
                                  Rank #{item.final_rank} · {item.source}
                                </span>
                                {item.duties_rank !== undefined && item.duties_rank !== null ? (
                                  <span className={styles.recommenderMetaItem}>
                                    Duties rank: {item.duties_rank}
                                  </span>
                                ) : null}
                                {item.skills_rank !== undefined && item.skills_rank !== null ? (
                                  <span className={styles.recommenderMetaItem}>
                                    Skills rank: {item.skills_rank}
                                  </span>
                                ) : null}
                                {item.rrf_score !== undefined ? (
                                  <span className={styles.recommenderMetaItem}>
                                    Fusion: {item.rrf_score.toFixed(3)}
                                  </span>
                                ) : null}
                                {item.similarity !== undefined ? (
                                  <span className={styles.recommenderMetaItem}>
                                    Similarity: {formatMatchPercent(item.similarity)}
                                  </span>
                                ) : null}
                              </div>
                              {item.skills_evidence ? (
                                <details className={styles.recommenderSkillsEvidence}>
                                  <summary>
                                    Skills matched: {item.skills_evidence.course_count} courses
                                  </summary>
                                  {item.skills_evidence.top_matches?.length ? (
                                    <ul className={styles.recommenderSkillsList}>
                                      {item.skills_evidence.top_matches.map((match, idx) => (
                                        <li
                                          key={`${item.onet_code}-skill-${idx}`}
                                          className={styles.recommenderSkillsItem}
                                        >
                                          {match.course_title} — {match.skill_name} ({match.taxonomy_type})
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <div className={styles.recommenderCollapsed}>
                                      No skill matches found.
                                    </div>
                                  )}
                                </details>
                              ) : null}
                              <div className={styles.recommenderDuties}>
                                {dutiesAvailable ? (
                                  showDutiesList ? (
                                    <ul
                                      className={`${styles.recommenderDutiesList} ${isExpanded ? styles.recommenderDutiesExpanded : styles.recommenderDutiesCollapsed}`}
                                      data-testid="soc-combined-duties"
                                    >
                                      {dutiesToShow.map((duty, idx) => (
                                        <li
                                          key={`${item.onet_code}-${idx}`}
                                          className={`${styles.recommenderDutyItem} ${isExpanded ? styles.recommenderDutyExpanded : styles.recommenderDutyCollapsed}`}
                                        >
                                          {duty}
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <div className={styles.recommenderCollapsed}>
                                      Duties available ({dutiesCount})
                                    </div>
                                  )
                                ) : (
                                  <div className={styles.recommenderCollapsed}>No duties available.</div>
                                )}
                                {dutiesAvailable && hasMoreDuties ? (
                                  <button
                                    type="button"
                                    className={`${styles.secondaryButton} ${styles.recommenderToggle}`}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setRecommendExpanded((prev) =>
                                        prev === item.onet_code ? null : item.onet_code,
                                      );
                                    }}
                                  >
                                    {isExpanded
                                      ? 'Hide duties'
                                      : `Show ${remainingDuties} more duties`}
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : !recommendLoading && (dutiesInput.trim() || hasAnyTranscript) ? (
                      <div className={styles.recommenderEmpty} data-testid="soc-combined-empty">
                        No recommendations yet. Click “Recommend O*NET Codes” to search.
                      </div>
                    ) : null
                  ) : recommendations.length ? (
                    <div className={styles.recommenderGrid} data-testid="soc-recommend-list">
                      {recommendations.map((item) => {
                        const title = item.matchedOnetTitle ?? item.socTitle ?? 'Unknown title';
                        const hasMoreDuties =
                          item.dutiesAvailable && item.dutiesCount > previewCount;
                        const isExpanded =
                          !hasMoreDuties || recommendExpanded === item.matchedOnetCode;
                        const showDutiesList = !isMobile || isExpanded;
                        const dutiesToShow = isExpanded
                          ? item.duties
                          : item.duties.slice(0, previewCount);
                        const remainingDuties = Math.max(item.dutiesCount - previewCount, 0);
                        const isSelected = recommendSelected?.code === item.matchedOnetCode;
                        const confidenceValue =
                          item.confidence ?? item.similarity;
                        const wagePreview = item.wageAvailable
                          ? `${formatHourlyPreview(item.wageLevel1Hourly)} / hr | ${formatAnnualPreview(
                            item.wageLevel1Annual,
                          )} / yr`
                          : 'No wage available';
                        return (
                          <div
                            key={item.matchedOnetCode}
                            className={styles.recommenderCard}
                            data-testid="soc-recommend-card"
                            data-onet-code={item.matchedOnetCode}
                          >
                        <div className={styles.recommenderCardHeader}>
                          <div>
                            <div className={styles.recommenderCode}>{item.matchedOnetCode}</div>
                            <div className={styles.recommenderTitle}>{title}</div>
                            {item.jobZone ? (
                              <div className={styles.recommenderJobZone}>
                                <span className={styles.jobZoneBadge}>
                                  Job Zone {item.jobZone}
                                </span>
                              </div>
                            ) : null}
                          </div>
                          {isSelected ? (
                            <span className={styles.recommenderSelected}>✓ Selected</span>
                          ) : (
                                <button
                                  type="button"
                                  className={`${styles.primaryButton} ${styles.recommenderSelect}`}
                                  data-testid="soc-recommend-select"
                                  onClick={() => {
                                    handleRecommendSelect(item);
                                  }}
                                >
                                  Select
                                </button>
                              )}
                            </div>
                            <div className={styles.recommenderWage}>
                              <div className={styles.recommenderWageText} data-testid="soc-recommend-wage">
                                <span className={styles.recommenderWageLabel}>Lv1 Prevailing Wage:</span>
                                <span className={styles.recommenderWageValue}>{wagePreview}</span>
                              </div>
                              {item.wageHasDataQualityIssue ? (
                                <span
                                  className={styles.recommenderQuality}
                                  data-testid="soc-recommend-quality"
                                >
                                  Data quality flag
                                </span>
                              ) : null}
                            </div>
                            <div className={styles.recommenderMetaRow}>
                              <span className={styles.recommenderMetaItem}>
                                Confidence: {formatMatchPercent(confidenceValue)}
                              </span>
                            </div>
                            <div className={styles.recommenderDuties}>
                              {item.dutiesAvailable ? (
                                showDutiesList ? (
                                  <ul
                                    className={`${styles.recommenderDutiesList} ${isExpanded ? styles.recommenderDutiesExpanded : styles.recommenderDutiesCollapsed}`}
                                    data-testid="soc-recommend-duties"
                                  >
                                    {dutiesToShow.map((duty, idx) => (
                                      <li
                                        key={`${item.matchedOnetCode}-${idx}`}
                                        className={`${styles.recommenderDutyItem} ${isExpanded ? styles.recommenderDutyExpanded : styles.recommenderDutyCollapsed}`}
                                      >
                                        {duty}
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <div className={styles.recommenderCollapsed}>
                                    Duties available ({item.dutiesCount})
                                  </div>
                                )
                              ) : (
                                <div className={styles.recommenderCollapsed}>No duties available.</div>
                              )}
                              {item.dutiesAvailable && hasMoreDuties ? (
                                <button
                                  type="button"
                                  className={`${styles.secondaryButton} ${styles.recommenderToggle}`}
                                  data-testid="soc-recommend-duties-toggle"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setRecommendExpanded((prev) =>
                                      prev === item.matchedOnetCode ? null : item.matchedOnetCode,
                                    );
                                  }}
                                >
                                  {isExpanded
                                    ? 'Hide duties'
                                    : `Show ${remainingDuties} more duties`}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : !recommendLoading && dutiesInput.trim() ? (
                    <div className={styles.recommenderEmpty} data-testid="soc-recommend-empty">
                      No recommendations yet. Click “Recommend O*NET Codes” to search.
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className={`${styles.recommenderPrompt} ${styles.formSpan}`}>
                  <span className={styles.helper}>Need help choosing an O*NET code?</span>
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() => setRecommendOpen(true)}
                    data-testid="soc-recommender-toggle"
                  >
                    Recommend by duties or transcript
                  </button>
                </div>
              )
            ) : null}

            {detectedMode === 'address_soc' ? (
                <div className={styles.inlineRow}>
                  <label className={styles.field}>
                    <span className={styles.label}>Proposed Salary</span>
                    <input
                      className={styles.input}
                      type="number"
                      value={salaryAmount}
                      onChange={(event) => setSalaryAmount(event.target.value)}
                      placeholder="120000"
                      data-testid="salary-input"
                    />
                    {salaryWarning ? (
                      <span className={styles.warning} data-testid="salary-warning">
                        Salary looks low for annual input. Did you mean hourly?
                      </span>
                    ) : null}
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>Salary Unit</span>
                    <select
                      className={styles.select}
                      value={salaryUnit}
                      onChange={(event) =>
                        setSalaryUnit(event.target.value === 'hour' ? 'hour' : 'year')
                      }
                      data-testid="salary-unit"
                    >
                      <option value="year">Year</option>
                      <option value="hour">Hour</option>
                    </select>
                  </label>
                </div>
              ) : null}
            </div>

            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => runLookup()}
              disabled={loading || detectedMode === 'none'}
              data-testid="lookup-button"
            >
              {loading ? 'Loading...' : submitLabel}
            </button>

            {error ? <div className={styles.error}>{error}</div> : null}
          </div>
        </section>

        {renderResults()}

        <section className={styles.disclaimer}>
          <strong>Disclaimer:</strong> For licensed attorneys and authorized staff only. Verify
          against official OFLC and O*NET sources. Not legal advice.
        </section>
      </div>
    </main>
  );
}
