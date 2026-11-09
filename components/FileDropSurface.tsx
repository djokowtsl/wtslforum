'use client';

import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import styles from './FileDropSurface.module.css';

type Props = {
  children: ReactNode;
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  prompt: string;
  className?: string;
};

function containsFiles(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types).includes('Files') || dataTransfer.files.length > 0;
}

export default function FileDropSurface({
  children,
  onFiles,
  disabled = false,
  prompt,
  className,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!containsFiles(event.dataTransfer)) return;
    event.preventDefault();
    if (disabled) return;
    dragDepth.current += 1;
    setDragging(true);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!containsFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!containsFiles(event.dataTransfer) || disabled) return;
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    const files = Array.from(event.dataTransfer.files);
    if (!files.length) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (!disabled) onFiles(files);
  }

  return (
    <div
      className={`${styles.surface}${className ? ` ${className}` : ''}`}
      data-file-drop-active={dragging ? 'true' : undefined}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      {dragging && <div className={styles.overlay} role="status">{prompt}</div>}
    </div>
  );
}
