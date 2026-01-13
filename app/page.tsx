"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';

import { parseFullAddress, type ParsedAddress } from '../src/lib/address';
import styles from './page.module.css';

type DetectedMode = 'address' | 'address_soc' | 'soc' | 'none';
type OccupationSuggestion = { onetCode: string; title: string };
const confirmationStorageKey = 'lookupConfirmation';
const onetCodePattern = /^\s*(\d{2}-\d{4}(?:\.\d{2})?)\b/;

function extractOnetCode(value: string): string {
  const match = value.match(onetCodePattern);
  return match ? match[1] : '';
}

function formatOccupationLabel(entry: OccupationSuggestion): string {
  return `${entry.onetCode} — ${entry.title}`;
}

export default function HomePage() {
  const router = useRouter();
  const [addressText, setAddressText] = useState('');
  const [addressDetails, setAddressDetails] = useState<ParsedAddress | null>(null);
  const [showAddressDetails, setShowAddressDetails] = useState(false);
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
  const [authMode, setAuthMode] = useState<'public' | 'invite' | null>(null);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [dutiesCopied, setDutiesCopied] = useState(false);
  const [welcomeName, setWelcomeName] = useState<string | null>(null);
  const socFetchId = useRef(0);
  const socBlurTimer = useRef<number | null>(null);

  const trimmedAddress = addressText.trim();
  const trimmedSoc = socCode.trim();
  const hasAddress = trimmedAddress.length > 0;
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
  const salaryNumber = Number(salaryAmount);
  const salaryWarning =
    detectedMode === 'address_soc' &&
    salaryUnit === 'year' &&
    Number.isFinite(salaryNumber) &&
    salaryNumber > 0 &&
    salaryNumber < 1000;

  const parsedAddress = useMemo(
    () => (addressText.trim() ? parseFullAddress(addressText) : null),
    [addressText],
  );
  const annualFormatter = useMemo(
    () => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    [],
  );
  const hourlyFormatter = useMemo(
    () => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    [],
  );

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
    if (!parsedAddress) {
      setAddressDetails(null);
      return;
    }
    setAddressDetails(parsedAddress);
    if (parsedAddress.confidence !== 'high') {
      setShowAddressDetails(true);
    }
  }, [parsedAddress]);

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
    }
  }, [response]);

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
        setAddressText(saved.lastRequest.address?.fullText ?? '');
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

  const handleLogout = async () => {
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
    } finally {
      router.replace('/login');
    }
  };

  const handleSocInputChange = (event: ChangeEvent<HTMLInputElement>) => {
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

  const buildRequestBody = (override?: { areaCode?: string }) => {
    const body: any = {};
    if (hasAddress) {
      if (trimmedAddress) {
        const parsed = addressDetails ?? parseFullAddress(trimmedAddress);
        const line1 = parsed.line2 ? `${parsed.line1} ${parsed.line2}`.trim() : parsed.line1;
        body.address = {
          fullText: trimmedAddress,
          line1: line1 || undefined,
          city: parsed.city || undefined,
          state: parsed.state || undefined,
          zip: parsed.zip || undefined,
        };
      }
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
      body.override = { areaCode: override.areaCode };
    }
    return body;
  };

  const runLookup = async (override?: { areaCode?: string }) => {
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

  const resendWithOverride = (areaCode: string) => {
    const base = lastRequest ?? buildRequestBody();
    runLookup({ areaCode });
    setLastRequest({ ...base, override: { areaCode } });
  };

  const updateAddressDetail = (field: keyof ParsedAddress, value: string) => {
    setAddressDetails((prev) =>
      prev
        ? {
          ...prev,
          [field]: value,
        }
        : prev,
    );
    setShowAddressDetails(true);
  };

  const runCandidateSearch = async () => {
    const geoState = response?.geo?.geocode?.stateAb;
    const fallbackStateMatch = addressText.match(/\b([A-Za-z]{2})\s*\d{5}\b/);
    const fallbackState = fallbackStateMatch ? fallbackStateMatch[1].toUpperCase() : null;
    const stateAb =
      (geoState && geoState !== 'NA' ? geoState : null) ||
      addressDetails?.state ||
      parsedAddress?.state ||
      fallbackState;
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

    const countyName = response.geo?.geocode?.countyName ?? null;
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

    return (
      <div className={styles.results} data-testid="results">
        <div className={styles.resultsHeader}>
          <h2 className={styles.resultsTitle}>Results</h2>
          <span className={styles.pill} data-testid="result-kind">
            Kind: {response.kind}
          </span>
        </div>

        {response.warnings?.length ? (
          <div className={styles.warning} data-testid="warnings">
            Warnings: {response.warnings.join('; ')}
          </div>
        ) : null}

        <div className={styles.resultsGrid}>
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

        {response.kind === 'geo_needs_confirmation' && response.confirmation?.suggestions ? (
          <div className={styles.card}>
            <h3 className={styles.cardTitle}>Confirmation Needed</h3>
            <ul className={styles.list} data-testid="confirmation-list">
              {response.confirmation.suggestions.map((entry: any) => (
                <li key={`${entry.areaCode}-${entry.countyFips}`}>
                  {entry.countyTownName} → {entry.areaName} ({entry.areaCode})
                  <button
                    className={styles.chipButton}
                    type="button"
                    onClick={() => resendWithOverride(entry.areaCode)}
                  >
                    Use
                  </button>
                </li>
              ))}
            </ul>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span className={styles.label}>Search candidates</span>
                <input
                  className={styles.input}
                  value={candidateQuery}
                  onChange={(event) => setCandidateQuery(event.target.value)}
                  placeholder="Middlesex"
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
                        onClick={() => resendWithOverride(entry.areaCode)}
                      >
                        Use
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
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
              <label className={styles.field}>
                <div className={styles.fieldHeader}>
                  <span className={styles.label}>Address</span>
                  <button
                    type="button"
                    className={`${styles.secondaryButton} ${styles.inlineButton}`}
                    onClick={() => setShowAddressDetails((prev) => !prev)}
                    data-testid="address-details-toggle"
                  >
                    {showAddressDetails ? 'Hide address details' : 'Edit address details'}
                  </button>
                </div>
                <textarea
                  className={`${styles.textarea} ${styles.addressTextarea}`}
                  rows={2}
                  value={addressText}
                  onChange={(event) => setAddressText(event.target.value)}
                  placeholder="123 Main St, City, ST 12345"
                  data-testid="address-input"
                />
              </label>

              {showAddressDetails && addressDetails ? (
                <div className={styles.detailCard} data-testid="address-details">
                  <div className={styles.helper} data-testid="address-confidence">
                    Parsed confidence: {addressDetails.confidence}
                  </div>
                  {addressDetails.warnings.length ? (
                    <div className={styles.warning} data-testid="address-warnings">
                      {addressDetails.warnings.join('; ')}
                    </div>
                  ) : null}
                  <div className={styles.formGrid}>
                    <label className={styles.field}>
                      <span className={styles.label}>Line 1</span>
                      <input
                        className={styles.input}
                        value={addressDetails.line1}
                        onChange={(event) => updateAddressDetail('line1', event.target.value)}
                        data-testid="address-line1"
                      />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>Line 2</span>
                      <input
                        className={styles.input}
                        value={addressDetails.line2 ?? ''}
                        onChange={(event) => updateAddressDetail('line2', event.target.value)}
                        data-testid="address-line2"
                      />
                    </label>
                    <div className={styles.inlineRow}>
                      <label className={styles.field}>
                        <span className={styles.label}>City</span>
                        <input
                          className={styles.input}
                          value={addressDetails.city}
                          onChange={(event) => updateAddressDetail('city', event.target.value)}
                          data-testid="address-city"
                        />
                      </label>
                      <label className={styles.field}>
                        <span className={styles.label}>State</span>
                        <input
                          className={styles.input}
                          value={addressDetails.state}
                          onChange={(event) => updateAddressDetail('state', event.target.value)}
                          data-testid="address-state"
                        />
                      </label>
                      <label className={styles.field}>
                        <span className={styles.label}>ZIP</span>
                        <input
                          className={styles.input}
                          value={addressDetails.zip ?? ''}
                          onChange={(event) => updateAddressDetail('zip', event.target.value)}
                          data-testid="address-zip"
                        />
                      </label>
                    </div>
                  </div>
                </div>
              ) : null}

              <label className={styles.field}>
                <span className={styles.label}>Occupation (O*NET) Code and Title</span>
                <div className={styles.autocomplete}>
                  <input
                    className={styles.input}
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
                    placeholder="15-1211.00 or software"
                    data-testid="soc-input"
                    aria-autocomplete="list"
                    aria-expanded={socSuggestionsOpen}
                    aria-haspopup="listbox"
                  />
                  {socSuggestionsOpen ? (
                    <div className={styles.suggestionsPanel} role="listbox" data-testid="soc-suggestions">
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
                <span className={styles.helper} data-testid="soc-help">
                  Wages use SOC-6; tasks use O*NET 8-digit with fallback.
                </span>
                {socSuffixMatch ? (
                  <span className={styles.hintStrong} data-testid="soc-suffix-note">
                    Using {socSuffixMatch[1]} for wages (O*NET suffix .{socSuffixMatch[2]} ignored).
                    {' '}
                    Tasks keep the O*NET {socSuffixMatch[1]}.{socSuffixMatch[2]} suffix.
                  </span>
                ) : null}
              </label>

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
