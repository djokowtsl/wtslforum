'use client';

import { uploadPresigned } from '@vercel/blob/client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, ArrowUpRight, Check, ChevronRight, Clock3, FileAudio2, FileUp, Gauge, LoaderCircle, RotateCcw, ShieldCheck, Trophy, Upload, X } from 'lucide-react';
import type { Te4AnalysisResult, Te4Highlight } from '@/lib/te4DmoTypes';
import styles from './DmoAnalysisWorkspace.module.css';

type Phase = 'idle' | 'uploading' | 'analyzing' | 'ready' | 'error';
const MAX_DMO_BYTES = 64 * 1024 * 1024;

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
  const [phase, setPhase] = useState<Phase>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Te4AnalysisResult | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null);
  const [viewerHtml, setViewerHtml] = useState('');
  const [viewerError, setViewerError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const viewerFrame = useRef<HTMLIFrameElement>(null);

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
  }, [result]);

  const selectHighlight = useCallback((highlight: Te4Highlight) => {
    setSelectedPoint(highlight.point);
    viewerFrame.current?.contentWindow?.postMessage({ type: 'select-point', point: highlight.point }, '*');
  }, []);

  const chooseFile = (candidate?: File) => {
    setError('');
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith('.dmo')) {
      setFile(null);
      setError('Choose a TE4 match recording ending in .dmo.');
      return;
    }
    if (candidate.size > MAX_DMO_BYTES) {
      setFile(null);
      setError('This recording exceeds the 64 MiB analysis limit.');
      return;
    }
    setFile(candidate);
    setPhase('idle');
    setProgress(0);
    setResult(null);
    setSelectedPoint(null);
  };

  const analyze = async () => {
    if (!file || phase === 'uploading' || phase === 'analyzing') return;
    setError('');
    setResult(null);
    setSelectedPoint(null);
    setProgress(0);
    try {
      setPhase('uploading');
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-100) || 'match.dmo';
      const blob = await uploadPresigned(`dmo-analysis/${crypto.randomUUID()}-${safeName}`, file, {
        access: 'private',
        handleUploadUrl: '/api/admin/dmo-analysis/upload',
        contentType: 'application/octet-stream',
        multipart: true,
        onUploadProgress: ({ percentage }) => setProgress(Math.round(percentage)),
      });
      setPhase('analyzing');
      const response = await fetch('/api/admin/dmo-analysis/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pathname: blob.pathname, filename: file.name }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(typeof payload?.error === 'string' ? payload.error : `Analysis failed (${response.status}).`);
      }
      const analysis = await response.json() as Te4AnalysisResult;
      setResult(analysis);
      setPhase('ready');
      setSelectedPoint(analysis.highlights[0]?.point ?? null);
    } catch (cause) {
      setPhase('error');
      setError(cause instanceof Error ? cause.message : 'The recording could not be analyzed. Try again.');
    }
  };

  const reset = () => {
    setPhase('idle');
    setFile(null);
    setProgress(0);
    setError('');
    setResult(null);
    setSelectedPoint(null);
    setViewerHtml('');
    if (fileInput.current) fileInput.current.value = '';
  };

  const busy = phase === 'uploading' || phase === 'analyzing';

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
          <p className={styles.intro}>Turn a raw match recording into a ranked shortlist of the moments worth another look.</p>
        </div>
        <div className={styles.headingAside}>
          <span className={styles.headingIndex}>01 <i /> 03</span>
          <span>UPLOAD <b>·</b> ANALYZE <b>·</b> REPLAY</span>
        </div>
      </section>

      {!result && (
        <section className={styles.uploadPanel} aria-labelledby="upload-title">
          <div className={styles.panelHeading}>
            <div className={styles.stepNumber}>01</div>
            <div><h2 id="upload-title">Load a match file</h2><p>One .dmo recording per analysis run.</p></div>
          </div>
          <input
            ref={fileInput}
            className={styles.fileInput}
            type="file"
            accept=".dmo,application/octet-stream"
            aria-label="Choose a TE4 DMO recording"
            onChange={(event) => chooseFile(event.currentTarget.files?.[0])}
          />
          {!file ? (
            <button
              type="button"
              className={styles.dropzone}
              onClick={() => fileInput.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                chooseFile(event.dataTransfer.files?.[0]);
              }}
              aria-describedby="file-hint"
            >
              <span className={styles.uploadGlyph}><FileUp size={23} /></span>
              <span className={styles.dropTitle}>Choose recording <b>or drop it here</b></span>
              <span id="file-hint" className={styles.dropHint}>DMO file · maximum 64 MiB · uploaded directly to private storage</span>
            </button>
          ) : (
            <div className={styles.fileCard}>
              <span className={styles.fileGlyph}><FileAudio2 size={20} /></span>
              <span className={styles.fileDetails}><strong>{file.name}</strong><small>{(file.size / (1024 * 1024)).toFixed(1)} MB <i /> Ready for analysis</small></span>
              {!busy && <button type="button" className={styles.removeFile} onClick={reset} aria-label="Remove selected file"><X size={17} /></button>}
            </div>
          )}
          {busy && (
            <div className={styles.progressBlock} role="status" aria-live="polite">
              <div className={styles.progressLabels}>
                <span>{phase === 'uploading' ? 'Uploading securely' : 'Reading match data'}</span>
                <strong>{phase === 'uploading' ? `${progress}%` : <><LoaderCircle size={14} className={styles.spin} /> IN PROGRESS</>}</strong>
              </div>
              <div className={styles.progressTrack}><span style={{ transform: `scaleX(${(phase === 'uploading' ? progress : 100) / 100})` }} /></div>
              <p>{phase === 'uploading' ? 'Sending the recording to private storage.' : 'Finding points, momentum shifts and standout rallies.'}</p>
            </div>
          )}
          {error && (
            <div className={styles.errorNotice} role="alert"><AlertTriangle size={17} /><span>{error}</span>
              {phase === 'error' && file && <button type="button" onClick={analyze}>Retry <RotateCcw size={14} /></button>}
            </div>
          )}
          <div className={styles.uploadFooter}>
            <span><ShieldCheck size={15} /> Recording remains private to staff</span>
            <button type="button" className={styles.primaryButton} onClick={analyze} disabled={!file || busy}>
              {busy ? (phase === 'uploading' ? 'Uploading…' : 'Analyzing…') : <>Analyze match <ArrowUpRight size={16} /></>}
            </button>
          </div>
        </section>
      )}

      {result && (
        <div className={styles.results}>
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
            <button type="button" className={styles.newAnalysis} onClick={reset}><RotateCcw size={14} /> New analysis</button>
          </section>

          {result.warnings.length > 0 && <div className={styles.warningBanner}><AlertTriangle size={17} /><div><strong>Analysis notes</strong><ul>{result.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul></div></div>}

          <section className={styles.metricsRail} aria-label="Match metrics">
            <div className={styles.metricCard}><span className={styles.metricIcon}><Trophy size={16} /></span><span className={styles.metricLabel}>FINAL WINNER</span><strong>{result.names[result.meta.finalWinner - 1]}</strong><small>{result.meta.setsToWin} sets to win</small></div>
            <div className={styles.metricCard}><span className={styles.metricIcon}><Gauge size={16} /></span><span className={styles.metricLabel}>ELO EXPECTED</span><strong>{result.meta.eloMatchProbability === null ? '—' : `${Math.round(result.meta.eloMatchProbability * 100)}%`}</strong><small>pre-match probability</small></div>
            <div className={styles.metricCard}><span className={styles.metricIcon}><Activity size={16} /></span><span className={styles.metricLabel}>SERVE SHIFT</span><strong>{result.meta.serveShift > 0 ? '+' : ''}{result.meta.serveShift.toFixed(1)}<small className={styles.inlineUnit}>pp</small></strong><small>match momentum swing</small></div>
            <div className={styles.metricCard}><span className={styles.metricIcon}><Clock3 size={16} /></span><span className={styles.metricLabel}>SERVE WIN RATE</span><strong>{Math.round(result.meta.serveWinRates[1] * 100)}<small className={styles.inlineUnit}>%</small><b className={styles.metricDivider}>/</b>{Math.round(result.meta.serveWinRates[2] * 100)}<small className={styles.inlineUnit}>%</small></strong><small>{result.names[0]} <i /> {result.names[1]}</small></div>
          </section>

          <div className={styles.analysisGrid}>
            <section className={styles.viewerPanel} aria-labelledby="viewer-title">
              <div className={styles.sectionHeading}>
                <div><span className={styles.kicker}>03 / REPLAY</span><h2 id="viewer-title">Point-by-point viewer</h2></div>
                <span className={styles.securePill}><span /> INTERACTIVE</span>
              </div>
              {viewerError ? (
                <div className={styles.viewerFallback} role="alert"><AlertTriangle size={20} /><strong>Replay unavailable</strong><p>{viewerError}</p><button type="button" className={styles.secondaryButton} onClick={() => setResult({ ...result })}>Retry viewer</button></div>
              ) : viewerHtml ? (
                <div className={styles.frameWrap}>
                  <iframe
                    ref={viewerFrame}
                    className={styles.viewerFrame}
                    title={`Point-by-point replay: ${result.names[0]} vs ${result.names[1]}`}
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

      {!result && phase === 'idle' && (
        <section className={styles.emptyState}>
          <div className={styles.emptyAccent} aria-hidden="true"><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /></div>
          <div><span className={styles.kicker}>READY WHEN YOU ARE</span><h2>Find the turning points.</h2><p>Upload a match and let the analysis surface the rallies that changed the story.</p></div>
          <span className={styles.emptyStatus}><i /> AWAITING DMO FILE</span>
        </section>
      )}
      <footer className={styles.footerNote}><span>WTSL / STAFF TOOLS</span><span>DMO analysis <b>·</b> member submissions remain on /media</span></footer>
    </main>
  );
}
