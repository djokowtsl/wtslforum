'use client';

import { useId, useMemo, useState, type KeyboardEvent } from 'react';

type SearchableDropdownProps = {
  id: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  placeholder?: string;
  loading?: boolean;
};

const OPTION_LIMIT = 60;

export default function SearchableDropdown({
  id,
  value,
  options,
  onChange,
  placeholder,
  loading = false,
}: SearchableDropdownProps) {
  const generatedId = useId().replace(/:/g, '');
  const listId = id + '-options-' + generatedId;
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const query = value.trim().toLocaleLowerCase();
  const matchingOptions = useMemo(
    () => options.filter((option) => option.toLocaleLowerCase().includes(query)),
    [options, query],
  );
  const visibleOptions = matchingOptions.slice(0, OPTION_LIMIT);

  function optionId(index: number) {
    return listId + '-option-' + index;
  }

  function selectOption(option: string) {
    onChange(option);
    setIsOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      if (!visibleOptions.length) {
        setIsOpen(true);
        return;
      }
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) => Math.min(current < 0 ? 0 : current + 1, visibleOptions.length - 1));
    } else if (event.key === 'ArrowUp') {
      if (!visibleOptions.length) return;
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) => Math.max(current <= 0 ? 0 : current - 1, 0));
    } else if (event.key === 'Enter' && isOpen && activeIndex >= 0 && visibleOptions[activeIndex]) {
      event.preventDefault();
      selectOption(visibleOptions[activeIndex]);
    } else if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      setIsOpen(false);
      setActiveIndex(-1);
    } else if (event.key === 'Tab') {
      setIsOpen(false);
      setActiveIndex(-1);
    }
  }

  return (
    <div className="screenshot-searchable-dropdown">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-activedescendant={isOpen && activeIndex >= 0 && activeIndex < visibleOptions.length ? optionId(activeIndex) : undefined}
        aria-busy={loading}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onFocus={() => {
          setIsOpen(true);
          setActiveIndex(-1);
        }}
        onBlur={() => setIsOpen(false)}
        onChange={(event) => {
          onChange(event.target.value);
          setIsOpen(true);
          setActiveIndex(-1);
        }}
        onKeyDown={handleKeyDown}
      />
      <div id={listId} className="screenshot-searchable-dropdown-list" role="listbox" hidden={!isOpen}>
        {visibleOptions.length ? visibleOptions.map((option, index) => (
          <button
            key={option}
            id={optionId(index)}
            type="button"
            role="option"
            aria-selected={value === option}
            data-active={activeIndex === index ? 'true' : undefined}
            className="screenshot-searchable-dropdown-option"
            onPointerDown={(event) => event.preventDefault()}
            onPointerMove={() => setActiveIndex(index)}
            onClick={() => selectOption(option)}
          >
            {option}
          </button>
        )) : (
          <div className="screenshot-searchable-dropdown-empty" role="option" aria-disabled="true">
            No matching values
          </div>
        )}
        {matchingOptions.length > OPTION_LIMIT ? (
          <div className="screenshot-searchable-dropdown-hint">Showing the first {OPTION_LIMIT} matches. Type to narrow.</div>
        ) : null}
      </div>
    </div>
  );
}
