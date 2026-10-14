'use client';

import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';

type SearchableDropdownProps = {
  id: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  placeholder?: string;
  loading?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  showAllOnFocus?: boolean;
  showDropdownIndicator?: boolean;
  dropdownLabel?: string;
  emptyOptionLabel?: string;
  optionLabels?: Record<string, string>;
  optionLimit?: number;
  selectionOnly?: boolean;
};

const OPTION_LIMIT = 60;

export default function SearchableDropdown({
  id,
  value,
  options,
  onChange,
  placeholder,
  loading = false,
  disabled = false,
  invalid = false,
  describedBy,
  showAllOnFocus = false,
  showDropdownIndicator = false,
  dropdownLabel = 'options',
  emptyOptionLabel,
  optionLabels,
  optionLimit = OPTION_LIMIT,
  selectionOnly = false,
}: SearchableDropdownProps) {
  const generatedId = useId().replace(/:/g, '');
  const listId = id + '-options-' + generatedId;
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [showAllOptions, setShowAllOptions] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const selectedLabel = value ? optionLabels?.[value] ?? value : '';
  const inputValue = selectionOnly ? (isOpen ? searchQuery : selectedLabel) : value;
  const queryValue = selectionOnly ? searchQuery : value;
  const query = (showAllOnFocus && showAllOptions ? '' : queryValue).trim().toLocaleLowerCase();
  const matchingOptions = useMemo(
    () => options.filter((option) => {
      const label = optionLabels?.[option] ?? option;
      return option.toLocaleLowerCase().includes(query) || label.toLocaleLowerCase().includes(query);
    }),
    [options, optionLabels, query],
  );
  const visibleOptions = matchingOptions.slice(0, Math.max(1, optionLimit));
  const optionItems = [
    ...(emptyOptionLabel ? [{ value: '', label: emptyOptionLabel }] : []),
    ...visibleOptions.map((option) => ({
      value: option,
      label: optionLabels?.[option] ?? option,
    })),
  ];
  const firstMatchIndex = emptyOptionLabel && visibleOptions.length ? 1 : 0;

  function optionId(index: number) {
    return listId + '-option-' + index;
  }

  function selectOption(option: string) {
    onChange(option);
    setSearchQuery('');
    setIsOpen(false);
    setActiveIndex(-1);
    setShowAllOptions(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      if (!optionItems.length) {
        setIsOpen(true);
        return;
      }
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) => Math.min(
        current < 0 ? firstMatchIndex : current + 1,
        optionItems.length - 1,
      ));
    } else if (event.key === 'ArrowUp') {
      if (!optionItems.length) return;
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) => Math.max(current <= 0 ? 0 : current - 1, 0));
    } else if (event.key === 'Enter' && isOpen && activeIndex >= 0 && optionItems[activeIndex]) {
      event.preventDefault();
      selectOption(optionItems[activeIndex].value);
    } else if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      setIsOpen(false);
      setActiveIndex(-1);
      setShowAllOptions(false);
      setSearchQuery('');
    } else if (event.key === 'Tab') {
      setIsOpen(false);
      setActiveIndex(-1);
      setShowAllOptions(false);
      setSearchQuery('');
    }
  }

  return (
    <div className={`screenshot-searchable-dropdown${showDropdownIndicator ? ' screenshot-searchable-dropdown--indicator' : ''}`}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-activedescendant={isOpen && activeIndex >= 0 && activeIndex < optionItems.length ? optionId(activeIndex) : undefined}
        aria-busy={loading}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        value={inputValue}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => {
          setIsOpen(true);
          setActiveIndex(-1);
          if (selectionOnly) setSearchQuery('');
          setShowAllOptions(showAllOnFocus);
          if (showAllOnFocus) inputRef.current?.select();
        }}
        onBlur={() => {
          setIsOpen(false);
          setActiveIndex(-1);
          setShowAllOptions(false);
          setSearchQuery('');
        }}
        onChange={(event) => {
          if (selectionOnly) setSearchQuery(event.target.value);
          else onChange(event.target.value);
          setIsOpen(true);
          setActiveIndex(-1);
          setShowAllOptions(false);
        }}
        onKeyDown={handleKeyDown}
      />
      {showDropdownIndicator && (
        <button
          type="button"
          className="screenshot-searchable-dropdown-toggle"
          aria-label={`${isOpen ? 'Hide' : 'Show'} ${dropdownLabel}`}
          aria-expanded={isOpen}
          aria-controls={listId}
          disabled={disabled}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            setActiveIndex(-1);
            if (isOpen) {
              setIsOpen(false);
              setShowAllOptions(false);
              setSearchQuery('');
            } else {
              setIsOpen(true);
              if (selectionOnly) setSearchQuery('');
              setShowAllOptions(showAllOnFocus);
              inputRef.current?.focus();
            }
          }}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="m5 7.5 5 5 5-5" />
          </svg>
        </button>
      )}
      <div id={listId} className="screenshot-searchable-dropdown-list" role="listbox" hidden={!isOpen}>
        {optionItems.map((option, index) => (
          <button
            key={option.value || 'empty-option'}
            id={optionId(index)}
            type="button"
            role="option"
            aria-selected={value === option.value}
            data-active={activeIndex === index ? 'true' : undefined}
            className="screenshot-searchable-dropdown-option"
            onPointerDown={(event) => event.preventDefault()}
            onPointerMove={() => setActiveIndex(index)}
            onClick={() => selectOption(option.value)}
          >
            {option.label}
          </button>
        ))}
        {!visibleOptions.length && (
          <div className="screenshot-searchable-dropdown-empty" role="option" aria-disabled="true">
            No matching values
          </div>
        )}
        {matchingOptions.length > optionLimit ? (
          <div className="screenshot-searchable-dropdown-hint">
            Showing the first {optionLimit} matches. Type to narrow.
          </div>
        ) : null}
      </div>
    </div>
  );
}
