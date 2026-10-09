'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  emoji: string;
  count: number;
  reacted: boolean;
  reactors: string[];
  disabled: boolean;
  updating: boolean;
  loginRequired?: boolean;
  onToggle: () => void;
};

export default function ReactionChip({ emoji, count, reacted, reactors, disabled, updating, loginRequired = false, onToggle }: Props) {
  const id = useId();
  const item = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(null);

  function cancelClose() {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }
  function close() {
    cancelClose();
    setOpen(false);
    setPinned(false);
  }
  function place() {
    const rect = item.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(280, Math.max(0, window.innerWidth - 24));
    const height = popup.current?.getBoundingClientRect().height ?? 100;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const top = rect.bottom + height + 8 <= window.innerHeight
      ? rect.bottom + 8 : Math.max(8, rect.top - height - 8);
    setPosition({ left, top, width });
  }
  function show() {
    if (count <= 0) return;
    cancelClose();
    place();
    setOpen(true);
  }
  function leave() {
    if (pinned || item.current?.contains(document.activeElement)) return;
    cancelClose();
    // Give the pointer time to cross the gap into the portalled tooltip.
    closeTimer.current = setTimeout(close, 150);
  }
  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, count, reactors, updating]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!item.current?.contains(target) && !popup.current?.contains(target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  useEffect(() => {
    if (count === 0) close();
  }, [count]);
  useEffect(() => cancelClose, []);

  return (
    <div
      className="reaction-item"
      ref={item}
      title={loginRequired && count === 0 ? 'Log in with Discord to react' : undefined}
      onMouseEnter={show}
      onMouseLeave={leave}
      onFocus={show}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node) && !popup.current?.contains(event.relatedTarget as Node)) close();
      }}
    >
      <div className={`reaction-chip${reacted ? ' active' : ''}`}>
        <button
          type="button"
          className={`reaction-toggle${count > 0 ? ' has-count' : ''}`}
          onClick={onToggle}
          disabled={disabled}
          aria-label={loginRequired ? `Log in with Discord to react with ${emoji}` : `React with ${emoji}`}
          aria-pressed={reacted}
          aria-describedby={open ? id : undefined}
        >{emoji}</button>
        {count > 0 && (
          <button
            type="button"
            className="reaction-count"
            aria-label={`Show who reacted with ${emoji}: ${count} ${count === 1 ? 'reaction' : 'reactions'}`}
            aria-expanded={open}
            aria-controls={open ? id : undefined}
            aria-describedby={open ? id : undefined}
            onClick={() => {
              if (pinned) close();
              else { show(); setPinned(true); }
            }}
          ><b>{count}</b></button>
        )}
      </div>
      {open && count > 0 && position && createPortal(
        <div
          id={id}
          ref={popup}
          role="tooltip"
          className="reaction-tooltip"
          style={position}
          onMouseEnter={cancelClose}
          onMouseLeave={leave}
        >
          <strong>{emoji} · {count} {count === 1 ? 'reaction' : 'reactions'}</strong>
          <span>{updating ? 'Updating reaction…' : reactors.length ? reactors.join(', ') : 'Reaction details unavailable.'}</span>
        </div>,
        document.body,
      )}
    </div>
  );
}
