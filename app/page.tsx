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
import { useRouter } from 'next/navigation';

import { parseFullAddress, type ParsedAddress } from '../src/lib/address';
import styles from './page.module.css';

type DetectedMode = 'address' | 'address_soc' | 'soc' | 'none';
type OccupationSuggestion = { onetCode: string; title: string };
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
const confirmationStorageKey = 'lookupConfirmation';
const onetCodePattern = /^\s*(\d{2}-\d{4}(?:\.\d{2})?)\b/;
const dutiesPreviewCount = 6;
const PO_BOX_RE = /\bP\.?\s*O\.?\s*Box\b/i;

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
  const [dutiesInput, setDutiesInput] = useState('');
  const [recommendations, setRecommendations] = useState<SocRecommendItem[]>([]);
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
  const [socInputFlash, setSocInputFlash] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const stateListboxId = useId();
  const socListboxId = useId();
  const socInputRef = useRef<HTMLInputElement | null>(null);
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
    if (!recommenderEnabled || typeof window === 'undefined') {
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
  }, [recommenderEnabled]);

  useEffect(() => {
    if (!recommenderEnabled || typeof window === 'undefined') {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const focus = params.get('focusOnet');
    if (focus) {
      setRecommendSelected({ code: focus, title: null });
    }
  }, [recommenderEnabled]);

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

  const handleRecommendSelect = (item: SocRecommendItem) => {
    const title = item.matchedOnetTitle ?? item.socTitle ?? null;
    if (title) {
      setSocInput(formatOccupationLabel({ onetCode: item.matchedOnetCode, title }));
    } else {
      setSocInput(item.matchedOnetCode);
    }
    setSocCode(item.matchedOnetCode);
    setSocSelectedTitle(title);
    setSocSuggestions([]);
    setSocSuggestionsOpen(false);
    setSocSuggestionsError('');
    setSocHighlightIndex(-1);
    setRecommendSelected({ code: item.matchedOnetCode, title });
    updateFocusOnetParam(item.matchedOnetCode);
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

  const handleRecommendSubmit = async () => {
    if (!recommenderEnabled) return;
    const trimmed = dutiesInput.trim();
    if (!trimmed) {
      setRecommendError('Paste job duties to get recommendations.');
      setRecommendations([]);
      return;
    }
    setRecommendLoading(true);
    setRecommendError('');
    setRecommendWarnings([]);
    setRecommendMeta(null);
    const localWarnings: string[] = [];
    try {
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
      const data = (await res.json()) as SocRecommendResponse;
      if (!res.ok) {
        throw new Error((data as any)?.error ?? 'Recommendation failed.');
      }
      setRecommendations(Array.isArray(data.items) ? data.items : []);
      const apiWarnings = Array.isArray(data.warnings) ? data.warnings : [];
      setRecommendWarnings([...localWarnings, ...apiWarnings]);
      setRecommendMeta(data.meta ?? null);
      setRecommendExpanded(null);
    } catch (err) {
      setRecommendError(err instanceof Error ? err.message : 'Recommendation failed.');
      setRecommendations([]);
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
              <h3 className={styles.cardTitle}>Tasks</h3>
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
                                    <span className={styles.suggestionCode}>{entry.onetCode}</span>
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

            {recommenderEnabled ? (
              recommendOpen ? (
                <div className={`${styles.recommenderPanel} ${styles.formSpan}`} data-testid="soc-recommender">
                  <div className={styles.recommenderHeader}>
                    <div>
                      <div className={styles.recommenderHeading}>
                        <span className={styles.recommenderHeadingTitle}>Recommend O*NET codes</span>
                        <span className={styles.recommenderTag}>Top 6</span>
                      </div>
                      <div className={styles.helper}>
                        Paste job duties and click Recommend to get Top 6 O*NET codes.
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
                  <div className={styles.recommenderActions}>
                    <button
                      type="button"
                      className={`${styles.primaryButton} ${styles.recommenderAction}`}
                      onClick={handleRecommendSubmit}
                      disabled={recommendLoading}
                      data-testid="soc-recommender-submit"
                    >
                      {recommendLoading ? 'Matching...' : 'Recommend Top 6 O*NET Codes'}
                    </button>
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
                  {recommendations.length ? (
                    <div className={styles.recommenderGrid} data-testid="soc-recommend-list">
                      {recommendations.map((item) => {
                        const title = item.matchedOnetTitle ?? item.socTitle ?? 'Unknown title';
                        const hasMoreDuties =
                          item.dutiesAvailable && item.dutiesCount > dutiesPreviewCount;
                        const isExpanded =
                          !hasMoreDuties || recommendExpanded === item.matchedOnetCode;
                        const showDutiesList = !isMobile || isExpanded;
                        const dutiesToShow = isExpanded
                          ? item.duties
                          : item.duties.slice(0, dutiesPreviewCount);
                        const remainingDuties = Math.max(item.dutiesCount - dutiesPreviewCount, 0);
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
                            role="button"
                            tabIndex={0}
                            data-testid="soc-recommend-card"
                            data-onet-code={item.matchedOnetCode}
                            onClick={() => handleRecommendSelect(item)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                handleRecommendSelect(item);
                              }
                            }}
                          >
                            <div className={styles.recommenderCardHeader}>
                              <div>
                                <div className={styles.recommenderCode}>{item.matchedOnetCode}</div>
                                <div className={styles.recommenderTitle}>{title}</div>
                              </div>
                              {isSelected ? (
                                <span className={styles.recommenderSelected}>✓ Selected</span>
                              ) : (
                                <button
                                  type="button"
                                  className={`${styles.primaryButton} ${styles.recommenderSelect}`}
                                  data-testid="soc-recommend-select"
                                  onClick={(event) => {
                                    event.stopPropagation();
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
                    Recommend by duties
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
