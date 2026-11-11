'use client';

import { useMemo, useState, type KeyboardEvent } from 'react';
import styles from './NativeMotionAdmin.module.css';

export type SearchableClipOption = {
  value: string;
  label: string;
};

type Props = {
  id: string;
  labelledBy: string;
  value: string;
  options: readonly SearchableClipOption[];
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
};

const MAX_VISIBLE_OPTIONS = 80;

export default function SearchableClipSelect({
  id,
  labelledBy,
  value,
  options,
  placeholder = 'Search by player or clip name',
  disabled = false,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = options.find((option) => option.value === value);
  const matchingOptions = useMemo(() => {
    const search = query.trim().toLocaleLowerCase('en-GB');
    return options.filter((option) => (
      !search || option.label.toLocaleLowerCase('en-GB').includes(search)
    ));
  }, [options, query]);
  const visibleOptions = useMemo(() => {
    const matches = matchingOptions.slice(0, MAX_VISIBLE_OPTIONS);
    if (!query && selected && !matches.some((option) => option.value === selected.value)) {
      return [selected, ...matches.slice(0, MAX_VISIBLE_OPTIONS - 1)];
    }
    return matches;
  }, [matchingOptions, query, selected]);

  function choose(option: SearchableClipOption) {
    onChange(option.value);
    setQuery('');
    setOpen(false);
    setActiveIndex(0);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setQuery('');
      setOpen(false);
    } else if (event.key === 'ArrowDown' && visibleOptions.length) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index + 1) % visibleOptions.length);
    } else if (event.key === 'ArrowUp' && visibleOptions.length) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index - 1 + visibleOptions.length) % visibleOptions.length);
    } else if (event.key === 'Enter' && open && visibleOptions[activeIndex]) {
      event.preventDefault();
      choose(visibleOptions[activeIndex]);
    }
  }

  return (
    <div
      className={styles.clipPicker}
      onBlur={(event) => {
        const nextFocus = event.relatedTarget;
        if (nextFocus instanceof Node && event.currentTarget.contains(nextFocus)) return;
        setOpen(false);
        setQuery('');
      }}
    >
      <input
        id={id}
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={`${id}-options`}
        aria-activedescendant={open && visibleOptions.length ? `${id}-option-${activeIndex}` : undefined}
        aria-labelledby={labelledBy}
        aria-haspopup="listbox"
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        value={open ? query : selected?.label ?? ''}
        onFocus={() => {
          setQuery('');
          setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)));
          setOpen(true);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {open && !disabled && (
        <div className={styles.clipListbox} id={`${id}-options`} role="listbox" aria-labelledby={labelledBy}>
          {visibleOptions.length ? visibleOptions.map((option, index) => (
            <button
              className={styles.clipOption}
              id={`${id}-option-${index}`}
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              data-active={index === activeIndex}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(option)}
            >
              {option.label}
            </button>
          )) : (
            <p className={styles.clipEmpty} role="status">No matching clips.</p>
          )}
          {matchingOptions.length > visibleOptions.length && (
            <p className={styles.clipEmpty} role="status">
              Showing {visibleOptions.length} of {matchingOptions.length} clips. Type to narrow the list.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
