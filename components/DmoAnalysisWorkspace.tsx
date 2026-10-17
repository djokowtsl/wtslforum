'use client';

import { uploadPresigned } from '@vercel/blob/client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, ArrowUpRight, Check, ChevronRight, Clock3, FileAudio2, FileUp, Gauge, LoaderCircle, RotateCcw, ShieldCheck, Trophy, X } from 'lucide-react';
import { isPresignedUrlRetrievalFailure } from '@/lib/dmoUploadErrors';
import {
  buildTe4CoachingSummary,
  defaultTe4CoachingPlayer,
  listTe4CoachingPlayers,
} from '@/lib/te4DmoCoaching';
import type { Te4AnalysisResult, Te4Highlight } from '@/lib/te4DmoTypes';
import styles from './DmoAnalysisWorkspace.module.css';

type JobStatus = 'queued' | 'uploading' | 'analyzing' | 'ready' | 'error';
type DmoBatchJob = {
  id: string;
  file: File;
  status: JobStatus;
  progress: number;
  result?: Te4AnalysisResult;
  error?: string;
};

const MAX_DMO_BYTES = 64 * 1024 * 1024;
const MAX_BATCH_FILES = 5;
const MAX_CONCURRENT_ANALYSES = 2;

const formatDuration = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds || 0));
  const minutes = Math.floor(safeSeconds / 60);
  return `${minutes}:${String(safeSeconds % 60).padStart(2, '0')}`;
};

const safeViewerHtml = (html: string, data: Te4AnalysisResult['viewer']) => {
  const json = JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return html.replace('__DATA__', json);
};

function HighlightRow({ highlight, index, selected, onSelect }: {
  highlight: Te4Highlight;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.highlightRow} ${selected ? styles.highlightSelected : ''}`}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`Play highlight ${index + 1}, point ${highlight.point}, ${highlight.reasons}`}
    >
      <span className={styles.rank}>{String(index + 1).padStart(2, '0')}</span>
      <span className={styles.highlightCopy}>
        <span className={styles.highlightTitle}>{highlight.reasons || `Point ${highlight.point}`}</span>
        <span className={styles.highlightMeta}>Set {highlight.set} <i /> Game {highlight.games} <i /> Point {highlight.point}</span>
      </span>
      <span className={styles.highlightScore}>
        <strong>{Math.round(highlight.score)}</strong>
        <small>RANK</small>
      </span>
      <ChevronRight className={styles.rowChevron} size={16} aria-hidden="true" />
    </button>
  );
}

export default function DmoAnalysisWorkspace() {
  const [jobs, setJobs] = useState<DmoBatchJob[]>([]);
  const [selectionNotice, setSelectionNotice] = useState('');
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [coachingPlayer, setCoachingPlayer] = useState('');
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null);
  const [viewerHtml, setViewerHtml] = useState('');
  const [viewerError, setViewerError] = useState('');
  const [viewerRetryKey, setViewerRetryKey] = useState(0);
  const running = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const viewerFrame = useRef<HTMLIFrameElement>(null);

  const completedJobs = useMemo(
    () => jobs.filter(
      (job): job is DmoBatchJob & { result: Te4AnalysisResult } => Boolean(job.result),
    ),
    [jobs],
  );
  const completedResults = useMemo(() => completedJobs.map((job) => job.result), [completedJobs]);
  const activeMatchId = selectedMatchId ?? completedJobs[0]?.id ?? null;
  const result = jobs.find((job) => job.id === activeMatchId)?.result ?? null;
  const busy = jobs.some((job) => job.status === 'uploading' || job.status === 'analyzing');
  const availablePlayers = useMemo(() => listTe4CoachingPlayers(completedResults), [completedResults]);
  const defaultPlayer = useMemo(() => defaultTe4CoachingPlayer(completedResults), [completedResults]);
  const selectedCoach = availablePlayers.includes(coachingPlayer) ? coachingPlayer : defaultPlayer ?? '';
  const coaching = useMemo(
    () => buildTe4CoachingSummary(completedResults, selectedCoach),
    [completedResults, selectedCoach],
  );

  const selectedHighlight = useMemo(
    () => result?.highlights.find((item) => item.point === selectedPoint) ?? null,
    [result, selectedPoint],
  );

  useEffect(() => {
    if (!result) {
      setViewerHtml('');
      setViewerError('');
      return;
    }
    let cancelled = false;
    setViewerError('');
    fetch('/te4-match-viewer-shell.html')
      .then((response) => {
        if (!response.ok) throw new Error(`Viewer shell could not be loaded (${response.status}).`);
        return response.text();
      })
      .then((html) => {
        if (!cancelled) setViewerHtml(safeViewerHtml(html, result.viewer));
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setViewerHtml('');
          setViewerError(cause instanceof Error ? cause.message : 'The replay viewer could not be loaded.');
        }
      });
    return () => { cancelled = true; };
  }, [result, viewerRetryKey]);

  const selectHighlight = useCallback((highlight: Te4Highlight) => {
    setSelectedPoint(highlight.point);
    viewerFrame.current?.contentWindow?.postMessage({ type: 'select-point', point: highlight.point }, '*');
  }, []);

  const updateJob = (id: string, changes: Partial<DmoBatchJob>) => {
    setJobs((current) => current.map((job) => job.id === id ? { ...job, ...changes } : job));
  };

  const addFiles = (candidates: File[]) => {
    if (running.current) return;
    const accepted: DmoBatchJob[] = [];
    const problems: string[] = [];
    for (const candidate of candidates) {
      if (!candidate.name.toLowerCase().endsWith('.dmo')) {
        problems.push(`${candidate.name}: choose a file ending in .dmo.`);
      } else if (candidate.size > MAX_DMO_BYTES) {
        problems.push(`${candidate.name}: exceeds the 64 MiB per-file limit.`);
      } else if (jobs.length + accepted.length >= MAX_BATCH_FILES) {
        problems.push(`${candidate.name}: a batch can contain at most ${MAX_BATCH_FILES} files.`);
      } else {
        accepted.push({
          id: crypto.randomUUID(),
          file: candidate,
          status: 'queued',
          progress: 0,
        });
      }
    }
    setSelectionNotice(problems.join(' '));
    if (accepted.length) setJobs((current) => [...current, ...accepted]);
  };

  const runBatch = async (selectedJobs: DmoBatchJob[]) => {
    if (running.current || selectedJobs.length === 0) return;
    running.current = true;
    setSelectionNotice('');
    const processJob = async (job: DmoBatchJob) => {
      const uploadRequestId = crypto.randomUUID();
      updateJob(job.id, { status: 'uploading', progress: 0, error: undefined });
      try {
        const safeName = job.file.name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-100) || 'match.dmo';
        const blob = await uploadPresigned(`dmo-analysis/${crypto.randomUUID()}-${safeName}`, job.file, {
          access: 'private',
          handleUploadUrl: '/api/admin/dmo-analysis/upload',
          contentType: 'application/octet-stream',
          multipart: true,
          headers: { 'x-dmo-upload-id': uploadRequestId },
          onUploadProgress: ({ percentage }) => updateJob(job.id, { progress: Math.round(percentage) }),
        });
        updateJob(job.id, { status: 'analyzing', progress: 100 });
        const response = await fetch('/api/admin/dmo-analysis/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pathname: blob.pathname, filename: job.file.name }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(typeof payload?.error === 'string' ? payload.error : `Analysis failed (${response.status}).`);
        }
        const analysis = await response.json() as Te4AnalysisResult;
        updateJob(job.id, { status: 'ready', progress: 100, result: analysis, error: undefined });
        setSelectedMatchId((current) => current ?? job.id);
        setSelectedPoint((current) => current ?? analysis.highlights[0]?.point ?? null);
      } catch (cause) {
        const message = isPresignedUrlRetrievalFailure(cause)
          ? `Private upload setup failed before the recording was sent. Reference ${uploadRequestId}; ask a Forum admin to check the Vercel server logs.`
          : cause instanceof Error ? cause.message : 'The recording could not be analyzed. Try again.';
        updateJob(job.id, { status: 'error', error: message });
      }
    };

    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < selectedJobs.length) {
        const job = selectedJobs[nextIndex];
        nextIndex += 1;
        await processJob(job);
      }
    };
    try {
      await Promise.all(
        Array.from({ length: Math.min(MAX_CONCURRENT_ANALYSES, selectedJobs.length) }, () => worker()),
      );
    } finally {
      running.current = false;
    }
  };

  const analyzeQueued = () => {
    const pending = jobs.filter((job) => job.status === 'queued' || job.status === 'error');
    void runBatch(pending);
  };

  const retryJob = (job: DmoBatchJob) => {
    void runBatch([job]);
  };

  const selectMatch = (job: DmoBatchJob) => {
    if (!job.result) return;
    setSelectedMatchId(job.id);
    const point = job.result.highlights[0]?.point ?? null;
    setSelectedPoint(point);
    if (point !== null) viewerFrame.current?.contentWindow?.postMessage({ type: 'select-point', point }, '*');
  };

  const removeJob = (id: string) => {
    if (busy) return;
    setJobs((current) => current.filter((job) => job.id !== id));
  };

  const reset = () => {
    if (running.current) return;
    setJobs([]);
    setSelectionNotice('');
    setSelectedMatchId(null);
    setCoachingPlayer('');
    setSelectedPoint(null);
    setViewerHtml('');
    setViewerError('');
    if (fileInput.current) fileInput.current.value = '';
  };

  return (
    <main className={styles.workspace}>
      <header className={styles.topline}>
        <div className={styles.eyebrow}><span className={styles.liveMark} /> STAFF ANALYSIS / TE4</div>
        <div className={styles.privateTag}><ShieldCheck size={14} /> PRIVATE WORKSPACE</div>
      </header>

      <section className={styles.heading}>
        <div>
          <p className={styles.kicker}>MATCH INTELLIGENCE</p>
          <h1>DMO <em>analysis</em></h1>
          <p className={styles.intro}>Analyze several match recordings together, replay the key moments, and compare evidence-based patterns across matches.</p>
        </div>
        <div className={styles.headingAside}>
          <span className={styles.headingIndex}>01 <i /> 03</span>
          <span>UPLOAD <b>·</b> ANALYZE <b>·</b> REPLAY</span>
        </div>
      </section>

      {completedJobs.length === 0 && (
        <section className={styles.uploadPanel} aria-labelledby="upload-title">
          <div className={styles.panelHeading}>
            <div className={styles.stepNumber}>01</div>
            <div><h2 id="upload-title">Load match files</h2><p>Select up to {MAX_BATCH_FILES} recordings; two are uploaded and analyzed at a time.</p></div>
          </div>
          <input
            ref={fileInput}
            className={styles.fileInput}
            type="file"
            accept=".dmo,application/octet-stream"
            multiple
            aria-label="Choose TE4 DMO recordings"
            onChange={(event) => {
              addFiles(Array.from(event.currentTarget.files ?? []));
              event.currentTarget.value = '';
            }}
          />
          <button
            type="button"
            className={styles.dropzone}
            onClick={() => fileInput.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              addFiles(Array.from(event.dataTransfer.files));
            }}
            aria-describedby="file-hint"
            disabled={busy || jobs.length >= MAX_BATCH_FILES}
          >
            <span className={styles.uploadGlyph}><FileUp size={23} /></span>
            <span className={styles.dropTitle}>Choose recordings <b>or drop them here</b></span>
            <span id="file-hint" className={styles.dropHint}>Up to {MAX_BATCH_FILES} DMO files · 64 MiB each · private uploads</span>
          </button>
          {jobs.length > 0 && (
            <div className={styles.batchQueue} aria-label="Selected DMO recordings">
              {jobs.map((job) => (
                <div className={styles.batchFileRow} key={job.id}>
                  <span className={styles.fileGlyph}><FileAudio2 size={20} /></span>
                  <div className={styles.fileDetails}>
                    <strong>{job.file.name}</strong>
                    <small>{(job.file.size / (1024 * 1024)).toFixed(1)} MB <i /> {
                      job.status === 'queued' ? 'Ready for analysis' :
                      job.status === 'uploading' ? `Uploading · ${job.progress}%` :
                      job.status === 'analyzing' ? 'Reading match data' :
                      job.status === 'ready' ? 'Analysis complete' : 'Analysis failed'
                    }</small>
                    {job.status === 'uploading' && <div className={styles.fileProgress}><span style={{ width: `${job.progress}%` }} /></div>}
                    {job.error && <p className={styles.fileError}>{job.error}</p>}
                  </div>
                  {!busy && job.status === 'error' && <button type="button" className={styles.iconButton} onClick={() => retryJob(job)} aria-label={`Retry ${job.file.name}`}><RotateCcw size={16} /></button>}
                  {!busy && (job.status === 'queued' || job.status === 'error') && <button type="button" className={styles.removeFile} onClick={() => removeJob(job.id)} aria-label={`Remove ${job.file.name}`}><X size={17} /></button>}
                </div>
              ))}
            </div>
          )}
          {busy && (
            <div className={styles.progressBlock} role="status" aria-live="polite">
              <div className={styles.progressLabels}>
                <span>Processing batch</span>
                <strong><LoaderCircle size={14} className={styles.spin} /> IN PROGRESS</strong>
              </div>
              <p>Each recording is uploaded privately and analyzed independently. A failed file will not stop the rest of the batch.</p>
            </div>
          )}
          {selectionNotice && <div className={styles.errorNotice} role="alert"><AlertTriangle size={17} /><span>{selectionNotice}</span></div>}
          <div className={styles.uploadFooter}>
            <span><ShieldCheck size={15} /> Recording remains private to staff</span>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={analyzeQueued}
              disabled={!jobs.some((job) => job.status === 'queued' || job.status === 'error') || busy}
            >
              {busy ? 'Processing batch…' : <>Analyze {jobs.length || ''} {jobs.length === 1 ? 'match' : 'matches'} <ArrowUpRight size={16} /></>}
            </button>
          </div>
        </section>
      )}

      {result && (
        <div className={styles.results}>
          <section className={styles.batchOverview} aria-label="Batch analysis results">
            <div className={styles.batchOverviewHeading}>
              <div>
                <p className={styles.kicker}>BATCH RESULTS</p>
                <h2>{completedJobs.length} of {jobs.length} matches analyzed</h2>
                <p>{busy
                  ? 'Other recordings are still being processed.'
                  : jobs.some((job) => job.status === 'error')
                    ? `${jobs.filter((job) => job.status === 'error').length} files need attention.`
                    : 'All files in this batch are complete.'}</p>
              </div>
              <button type="button" className={styles.newAnalysis} onClick={reset} disabled={busy}><RotateCcw size={14} /> New analysis</button>
            </div>
            <div className={styles.batchMatchList}>
              {jobs.map((job) => job.result ? (
                <button
                  type="button"
                  key={job.id}
                  className={`${styles.batchMatchButton} ${job.id === activeMatchId ? styles.activeBatchMatch : ''}`}
                  onClick={() => selectMatch(job)}
                  aria-pressed={job.id === activeMatchId}
                >
                  <span className={styles.batchMatchCheck}><Check size={14} /></span>
                  <span className={styles.batchMatchCopy}>
                    <strong>{job.result.names[0]} <i>vs</i> {job.result.names[1]}</strong>
                    <small>{job.result.score} <i /> {job.file.name}</small>
                  </span>
                  <span className={styles.batchMatchStatus}>READY</span>
                </button>
              ) : (
                <div className={styles.batchMatchPending} key={job.id}>
                  <span className={styles.batchMatchCheck}>{job.status === 'error' ? <AlertTriangle size={14} /> : <LoaderCircle size={14} className={job.status === 'queued' ? '' : styles.spin} />}</span>
                  <span className={styles.batchMatchCopy}>
                    <strong>{job.file.name}</strong>
                    <small>{job.status === 'error' ? job.error : job.status === 'queued' ? 'Waiting to start' : job.status === 'uploading' ? `Uploading · ${job.progress}%` : 'Reading match data'}</small>
                  </span>
                  {job.status === 'error' && !busy && <button type="button" className={styles.retryButton} onClick={() => retryJob(job)}><RotateCcw size={13} /> Retry</button>}
                </div>
              ))}
            </div>
          </section>

          <section className={styles.coachingPanel} aria-labelledby="coaching-title">
            <div className={styles.coachingHeader}>
              <div>
                <p className={styles.kicker}>PLAYER-LEVEL SUMMARY</p>
                <h2 id="coaching-title">Coaching patterns</h2>
              </div>
              {availablePlayers.length > 0 && (
                <label className={styles.coachSelect}>
                  <span>PLAYER</span>
                  <select value={selectedCoach} onChange={(event) => setCoachingPlayer(event.currentTarget.value)}>
                    {availablePlayers.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </label>
              )}
            </div>
            {availablePlayers.length === 0 ? (
              <p className={styles.coachingEmpty}>Player names could not be matched from these recordings. Use DMO filenames that include the player names to group results for coaching.</p>
            ) : (
              <>
                <p className={styles.coachingContext}>
                  Evidence from {coaching.matchesWithPlayer} of {completedResults.length} completed {completedResults.length === 1 ? 'match' : 'matches'} with {selectedCoach}; {coaching.matchWins} {coaching.matchWins === 1 ? 'match win' : 'match wins'}.
                  {coaching.matchesWithPlayer < 2 && ' This is a single-match snapshot, not a confirmed trend.'}
                </p>
                {coaching.insights.length > 0 ? (
                  <div className={styles.coachingGrid}>
                    {coaching.insights.map((insight) => (
                      <article className={styles.coachingCard} data-tone={insight.tone} key={insight.title}>
                        <span className={styles.insightTone}>{insight.tone === 'strength' ? 'STRENGTH' : insight.tone === 'focus' ? 'PRACTICE FOCUS' : 'WATCH'}</span>
                        <h3>{insight.title}</h3>
                        <p className={styles.insightEvidence}>{insight.evidence}</p>
                        <p>{insight.cue}</p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className={styles.coachingEmpty}>There are not enough recorded points for stable coaching signals yet. Analyze more matches with this player.</p>
                )}
                <p className={styles.coachingFootnote}>Point results are reconstructed from DMO events; rally-ending winners and errors are approximate.</p>
              </>
            )}
          </section>

          <section className={styles.matchStrip} aria-label="Analysis summary">
            <div className={styles.matchIdentity}>
              <div className={styles.stepNumber}>02</div>
              <div><p className={styles.kicker}>MATCH REPORT</p><h2>{result.names[0]} <span>vs</span> {result.names[1]}</h2><p className={styles.matchScore}>{result.score}</p></div>
            </div>
            <div className={styles.summaryStats}>
              <div><span>POINTS READ</span><strong>{result.pointsAnalyzed.toLocaleString()}</strong></div>
              <div><span>RUNTIME</span><strong>{formatDuration(result.durationSeconds)}</strong></div>
              <div><span>HIGHLIGHTS</span><strong>{result.highlights.length.toString().padStart(2, '0')}</strong></div>
            </div>
          </section>

          {result.warnings.length > 0 && <div className={styles.warningBanner}><AlertTriangle size={17} /><div><strong>Analysis notes</strong><ul>{result.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul></div></div>}

          <section className={styles.metricsRail} aria-label="Match metrics">
            <div className={styles.metricCard}><span className={styles.metricIcon}><Trophy size={16} /></span><span className={styles.metricLabel}>FINAL WINNER</span><strong>{result.names[result.meta.finalWinner - 1]}</strong><small>{result.meta.setsToWin} sets to win</small></div>
            <div className={styles.metricCard}><span className={styles.metricIcon}><Gauge size={16} /></span><span className={styles.metricLabel}>ELO EXPECTED</span><strong>{result.meta.eloMatchProbability === null ? '—' : `${Math.round(result.meta.eloMatchProbability * 100)}%`}</strong><small>{result.meta.eloMatchProbability === null ? 'no pre-match ratings' : 'pre-match probability'}</small></div>
            <div className={styles.metricCard}><span className={styles.metricIcon}><Activity size={16} /></span><span className={styles.metricLabel}>SERVE SHIFT</span><strong>{typeof result.meta.serveShift !== 'number' ? '—' : <>{result.meta.serveShift > 0 ? '+' : ''}{result.meta.serveShift.toFixed(1)}<small className={styles.inlineUnit}>pp</small></>}</strong><small>{typeof result.meta.serveShift !== 'number' ? 'not calculated' : 'match momentum swing'}</small></div>
            <div className={styles.metricCard}><span className={styles.metricIcon}><Clock3 size={16} /></span><span className={styles.metricLabel}>SERVE WIN RATE</span><strong>{Math.round(result.meta.serveWinRates[1] * 100)}<small className={styles.inlineUnit}>%</small><b className={styles.metricDivider}>/</b>{Math.round(result.meta.serveWinRates[2] * 100)}<small className={styles.inlineUnit}>%</small></strong><small>{result.names[0]} <i /> {result.names[1]}</small></div>
          </section>

          <div className={styles.analysisGrid}>
            <section className={styles.viewerPanel} aria-labelledby="viewer-title">
              <div className={styles.sectionHeading}>
                <div><span className={styles.kicker}>03 / REPLAY</span><h2 id="viewer-title">Match replay</h2></div>
                <span className={styles.securePill}><span /> INTERACTIVE</span>
              </div>
              {viewerError ? (
                <div className={styles.viewerFallback} role="alert"><AlertTriangle size={20} /><strong>Replay unavailable</strong><p>{viewerError}</p><button type="button" className={styles.secondaryButton} onClick={() => setViewerRetryKey((value) => value + 1)}>Retry viewer</button></div>
              ) : viewerHtml ? (
                <div className={styles.frameWrap}>
                  <iframe
                    ref={viewerFrame}
                    className={styles.viewerFrame}
                    title={`Match replay: ${result.names[0]} vs ${result.names[1]}`}
                    srcDoc={viewerHtml}
                    sandbox="allow-scripts"
                    onLoad={() => {
                      if (selectedPoint !== null) viewerFrame.current?.contentWindow?.postMessage({ type: 'select-point', point: selectedPoint }, '*');
                    }}
                  />
                </div>
              ) : (
                <div className={styles.viewerLoading} role="status"><span className={styles.skeletonLine} /><span className={styles.skeletonStage} /><span className={styles.skeletonLineShort} /><small>Preparing replay data</small></div>
              )}
              {selectedHighlight && <div className={styles.selectedInsight}><span className={styles.checkmark}><Check size={13} /></span><span>Inspecting <strong>point {selectedHighlight.point}</strong> — {selectedHighlight.reasons || 'selected highlight'}</span></div>}
              <div className={styles.matchMetadata}><span>{result.filename}</span><span>{result.meta.frameCount.toLocaleString()} FRAMES</span></div>
            </section>

            <section className={styles.highlightPanel} aria-labelledby="highlights-title">
              <div className={styles.sectionHeading}>
                <div><span className={styles.kicker}>RANKED MOMENTS</span><h2 id="highlights-title">Highlight queue</h2></div>
                <span className={styles.highlightCount}>{result.highlights.length.toString().padStart(2, '0')}</span>
              </div>
              {result.highlights.length ? (
                <div className={styles.highlightList}>
                  {result.highlights.map((highlight, index) => (
                    <HighlightRow key={`${highlight.point}-${highlight.frame}`} highlight={highlight} index={index} selected={selectedPoint === highlight.point} onSelect={() => selectHighlight(highlight)} />
                  ))}
                </div>
              ) : (
                <div className={styles.emptyHighlights}><span><Activity size={19} /></span><strong>No standout points found</strong><p>This recording was analyzed, but no moments met the highlight threshold.</p></div>
              )}
              <p className={styles.queueHint}>Select any moment to jump the replay to that point.</p>
            </section>
          </div>

          <section className={styles.setScorePanel} aria-label="Set scores">
            <div><span className={styles.kicker}>SCORECARD</span><strong>Set breakdown</strong></div>
            <div className={styles.setScores}>
              {result.sets.map((set, index) => <div className={styles.setScore} key={`${index}-${set.join('-')}`}><small>SET {index + 1}</small><strong>{set[0]} <i>—</i> {set[1]}</strong></div>)}
            </div>
            <div className={styles.startChance}><span>STARTING WIN PROBABILITY</span><strong>{Math.round(result.meta.startProbability * 100)}%</strong></div>
          </section>
        </div>
      )}

      {completedJobs.length === 0 && jobs.length === 0 && (
        <section className={styles.emptyState}>
          <div className={styles.emptyAccent} aria-hidden="true"><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /></div>
          <div><span className={styles.kicker}>READY WHEN YOU ARE</span><h2>Find the turning points.</h2><p>Upload a batch of matches to see each replay and compare coaching patterns for a player.</p></div>
          <span className={styles.emptyStatus}><i /> AWAITING DMO FILES</span>
        </section>
      )}
      <footer className={styles.footerNote}><span>WTSL / STAFF TOOLS</span><span>DMO analysis <b>·</b> member submissions remain on /media</span></footer>
    </main>
  );
}
