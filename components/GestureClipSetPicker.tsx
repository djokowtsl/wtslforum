'use client';

import SearchableClipSelect from './SearchableClipSelect';
import {
  NATIVE_MOTION_GESTURE_SET_LIMIT,
  nativeMotionGestureClipIds,
  nativeMotionGestureClips,
  nativeMotionGesturePickFromIds,
  type NativeMotionCatalog,
  type NativeMotionGesturePick,
} from '@/lib/nativeMotionCatalogData';

type Props = {
  /** Unique prefix for element ids, e.g. "match-0-gesture-CheerFist". */
  id: string;
  type: string;
  catalog: NativeMotionCatalog;
  value: NativeMotionGesturePick | undefined;
  /** Label for "no animation chosen", e.g. "Use character/default gesture". */
  emptyLabel: string;
  onChange: (pick: NativeMotionGesturePick | null) => void;
  className?: string;
  buttonClassName?: string;
};

/**
 * Choose one or more animations for a gesture type. With several, the court
 * plays them in turn, so repeated fist pumps don't all look the same.
 */
export default function GestureClipSetPicker({
  id, type, catalog, value, emptyLabel, onChange, className, buttonClassName,
}: Props) {
  const clips = nativeMotionGestureClips(catalog, type);
  const chosen = nativeMotionGestureClipIds(value);
  const label = type.replace(/([a-z])([A-Z])/g, '$1 $2');
  const optionsFor = (current: string) => [
    { value: '', label: chosen.length > 1 ? 'Remove this animation' : emptyLabel },
    ...clips
      .filter((clip) => clip.id === current || !chosen.includes(clip.id))
      .map((clip) => ({
        value: clip.id,
        label: [clip.gestureMod, clip.sourceBundle, clip.originalClipName].filter(Boolean).join(' · ') || clip.id,
      })),
  ];
  const update = (ids: string[]) => onChange(nativeMotionGesturePickFromIds(ids));
  const unused = clips.filter((clip) => !chosen.includes(clip.id));
  const slots = chosen.length ? chosen : [''];

  return (
    <div className={className} role="group" aria-labelledby={`${id}-label`}>
      <span id={`${id}-label`}>
        {label}
        {chosen.length > 1 && <small> · {chosen.length} animations, played in turn</small>}
      </span>
      {slots.map((clipId, position) => (
        <SearchableClipSelect
          key={`${clipId || 'empty'}-${position}`}
          id={`${id}-${position}`}
          labelledBy={`${id}-label`}
          value={clipId}
          options={optionsFor(clipId)}
          onChange={(next) => {
            const ids = [...chosen];
            if (next) ids[position] = next;
            else ids.splice(position, 1);
            update(ids);
          }}
        />
      ))}
      {unused.length > 0 && chosen.length < NATIVE_MOTION_GESTURE_SET_LIMIT && (
        <span>
          {chosen.length > 0 && (
            <button
              type="button"
              className={buttonClassName}
              onClick={() => update([...chosen, unused[0].id])}
            >
              Add another {label.toLowerCase()} animation
            </button>
          )}
          {chosen.length > 0 && clips.length > 1 && ' '}
          {clips.length > 1 && (
            <button
              type="button"
              className={buttonClassName}
              onClick={() => update([...chosen, ...unused.map((clip) => clip.id)])}
            >
              Use all {Math.min(clips.length, NATIVE_MOTION_GESTURE_SET_LIMIT)}
            </button>
          )}
        </span>
      )}
    </div>
  );
}
