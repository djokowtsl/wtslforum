'use client';

import { useEffect, useRef, useState, type MutableRefObject, type TouchEvent } from 'react';
import type { TournamentBracketData } from '@/lib/challongeBracketData';
import TournamentBracketDiagram from './TournamentBracketDiagram';
import styles from './TournamentBracket.module.css';

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;

function clampZoom(value: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

function isBracketData(value: unknown): value is TournamentBracketData {
  if (!value || typeof value !== 'object') return false;
  const bracket = value as TournamentBracketData;
  return Number.isFinite(bracket.width)
    && Number.isFinite(bracket.height)
    && Array.isArray(bracket.sections)
    && Array.isArray(bracket.connectors)
    && Array.isArray(bracket.winners)
    && Array.isArray(bracket.losers)
    && Array.isArray(bracket.main);
}

function ZoomControls({
  zoom,
  onZoomChange,
}: {
  zoom: number;
  onZoomChange: (value: number) => void;
}) {
  return (
    <div className={styles.zoomControls} role="group" aria-label="Bracket zoom controls">
      <button type="button" aria-label="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={() => onZoomChange(clampZoom(zoom / 1.25))}>
        −
      </button>
      <output aria-live="polite">{Math.round(zoom * 100)}%</output>
      <button type="button" aria-label="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => onZoomChange(clampZoom(zoom * 1.25))}>
        +
      </button>
      <button
        type="button"
        className={styles.fitButton}
        disabled={zoom <= MIN_ZOOM}
        onClick={() => onZoomChange(MIN_ZOOM)}
      >
        Fit
      </button>
    </div>
  );
}

function BracketCanvas({
  bracket,
  tournamentName,
  zoom,
  setZoom,
  pinchStart,
  fullscreen = false,
}: {
  bracket: TournamentBracketData;
  tournamentName: string;
  zoom: number;
  setZoom: (value: number) => void;
  pinchStart: MutableRefObject<{ distance: number; zoom: number } | null>;
  fullscreen?: boolean;
}) {
  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 2) return;
    const first = event.touches[0];
    const second = event.touches[1];
    const distance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
    if (distance > 0) pinchStart.current = { distance, zoom };
  }

  function handleTouchMove(event: TouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 2 || !pinchStart.current) return;
    const first = event.touches[0];
    const second = event.touches[1];
    const distance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
    if (distance <= 0) return;
    event.preventDefault();
    setZoom(clampZoom(pinchStart.current.zoom * (distance / pinchStart.current.distance)));
  }

  return (
    <div className={fullscreen ? styles.fullscreenCanvas : styles.canvas}>
      <p className={styles.panHint}>Use the controls or pinch to zoom, then scroll to inspect matches.</p>
      <ZoomControls zoom={zoom} onZoomChange={setZoom} />
      <div
        className={styles.diagramViewport}
        role="region"
        aria-label={`${tournamentName} bracket diagram; pinch to zoom and scroll to pan`}
        tabIndex={0}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={(event) => { if (event.touches.length < 2) pinchStart.current = null; }}
        onTouchCancel={() => { pinchStart.current = null; }}
      >
        <TournamentBracketDiagram bracket={bracket} tournamentName={tournamentName} zoom={zoom} />
      </div>
    </div>
  );
}

export default function TournamentBracket({
  tournamentKey,
  tournamentName,
  challongeUrl,
}: {
  tournamentKey: string;
  tournamentName: string;
  challongeUrl: string;
}) {
  const [bracket, setBracket] = useState<TournamentBracketData | null>(null);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const pinchStart = useRef<{ distance: number; zoom: number } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    setBracket(null);
    fetch(`/api/tournaments/${encodeURIComponent(tournamentKey)}/bracket`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Bracket request failed.');
        const data: unknown = await response.json();
        if (!isBracketData(data)) throw new Error('Bracket data was invalid.');
        setBracket(data);
        setZoom(MIN_ZOOM);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [tournamentKey]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (fullscreen && dialog && !dialog.open) dialog.showModal();
  }, [fullscreen]);

  function closeFullscreen() {
    setFullscreen(false);
    window.requestAnimationFrame(() => openButtonRef.current?.focus());
  }

  return (
    <section className={styles.bracket} aria-labelledby="tournament-bracket-title">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>TOURNAMENT DRAW</span>
          <h2 id="tournament-bracket-title">{tournamentName}</h2>
          <p>Our interactive bracket, with character picks shown beside each player.</p>
        </div>
        <div className={styles.actions}>
          {bracket && (
            <button
              className={styles.fullscreenButton}
              type="button"
              ref={openButtonRef}
              onClick={() => setFullscreen(true)}
            >
              View full bracket ⤢
            </button>
          )}
          <a className={styles.officialLink} href={challongeUrl} target="_blank" rel="noopener noreferrer">
            Official draw ↗
          </a>
        </div>
      </header>

      {loading && <div className={styles.status} role="status">Loading the bracket…</div>}
      {error && (
        <div className={styles.status} role="status">
          The bracket could not be loaded. You can still open the official draw above.
        </div>
      )}
      {bracket && (
        <>
          <BracketCanvas
            bracket={bracket}
            tournamentName={tournamentName}
            zoom={zoom}
            setZoom={setZoom}
            pinchStart={pinchStart}
          />
          {fullscreen && (
            <dialog
              className={styles.fullscreenDialog}
              ref={dialogRef}
              aria-labelledby="tournament-bracket-fullscreen-title"
              onClose={closeFullscreen}
            >
              <div className={styles.fullscreenLayout}>
                <header className={styles.fullscreenHeader}>
                  <div>
                    <span className={styles.eyebrow}>FULL BRACKET</span>
                    <h2 id="tournament-bracket-fullscreen-title">{tournamentName}</h2>
                  </div>
                  <button
                    className={styles.closeButton}
                    type="button"
                    onClick={() => dialogRef.current?.close()}
                  >
                    Close
                  </button>
                </header>
                <BracketCanvas
                  bracket={bracket}
                  tournamentName={tournamentName}
                  zoom={zoom}
                  setZoom={setZoom}
                  pinchStart={pinchStart}
                  fullscreen
                />
              </div>
            </dialog>
          )}
        </>
      )}
    </section>
  );
}
