'use client';

import { useEffect, useState } from 'react';
import { ARRANGEMENT_LABELS, BASIS_LABELS, LINE_TYPES, SOURCE_LABELS } from '@/lib/prediction/labels';

function NumberField({
  text,
  unit,
  value,
  onCommit,
}: {
  text: string;
  unit?: string;
  value: number | null;
  onCommit: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | number>(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);
  return (
    <label className="field">
      {text}
      {unit ? ` (${unit})` : ''}
      <input
        type="number"
        step="any"
        className="num"
        value={draft}
        placeholder="MISSING_DATA"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const next = draft === '' ? null : Number(draft);
          if (next !== value) onCommit(next);
        }}
      />
    </label>
  );
}

function SelectField({
  text,
  value,
  options,
  onCommit,
}: {
  text: string;
  value: string | null;
  options: Record<string, string> | string[];
  onCommit: (value: string | null) => void;
}) {
  const entries = Array.isArray(options) ? options.map((o) => [o, o]) : Object.entries(options);
  return (
    <label className="field">
      {text}
      <select value={value ?? ''} onChange={(e) => onCommit(e.target.value || null)}>
        <option value="">MISSING_DATA</option>
        {entries.map(([key, name]) => (
          <option key={key} value={key}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextField({ text, value, onCommit }: { text: string; value: string | null; onCommit: (value: string | null) => void }) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);
  return (
    <label className="field">
      {text}
      <input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== (value ?? '') && onCommit(draft || null)} />
    </label>
  );
}

export function curveToText(curve: number[][] | null): string {
  return (curve ?? []).map(([d, b]) => `${d}:${b}`).join(', ');
}

export function parseCurve(text: string): number[][] | null {
  const pairs = text
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split(':').map(Number));
  return pairs.length ? pairs : null;
}

export function SourceForm({
  source,
  models,
  onChange,
  onDelete,
}: {
  source: any;
  models: string[];
  onChange: (field: string, value: unknown) => void;
  onDelete: () => void;
}) {
  const isLine = LINE_TYPES.includes(source.source_type);
  const [curve, setCurve] = useState(curveToText(source.reference_curve));
  useEffect(() => setCurve(curveToText(source.reference_curve)), [source.reference_curve]);

  return (
    <div>
      <h3 style={{ margin: '0 0 8px' }}>
        {source.tag} <span className="muted small">{SOURCE_LABELS[source.source_type]}</span>
      </h3>
      <div style={{ display: 'grid', gap: 8 }}>
        <TextField text="תג" value={source.tag} onCommit={(v) => v && onChange('tag', v)} />
        <NumberField
          text="גובה מעל מפלס הקומה"
          unit="מ׳"
          value={source.height_above_floor_m}
          onCommit={(v) => onChange('height_above_floor_m', v)}
        />
        <NumberField text="זרם" unit="A" value={source.current_a} onCommit={(v) => onChange('current_a', v)} />
        <SelectField text="בסיס הזרם" value={source.current_basis} options={BASIS_LABELS} onCommit={(v) => onChange('current_basis', v)} />
        <NumberField text="מקדם עומס" value={source.load_factor} onCommit={(v) => onChange('load_factor', v)} />
        {isLine && (
          <>
            <SelectField
              text="סידור מוליכים"
              value={source.arrangement}
              options={ARRANGEMENT_LABELS}
              onCommit={(v) => onChange('arrangement', v)}
            />
            <NumberField text="מרחק בין מוליכים" unit="מ׳" value={source.spacing_m} onCommit={(v) => onChange('spacing_m', v)} />
            {source.source_type === 'BUSBAR' && (
              <NumberField text="רוחב פס" unit="מ׳" value={source.bar_width_m} onCommit={(v) => onChange('bar_width_m', v)} />
            )}
            <TextField
              text="קבוצת פאזה (מעגלים עם קשר פאזה ידוע)"
              value={source.coherence_group}
              onCommit={(v) => onChange('coherence_group', v)}
            />
          </>
        )}
        {!isLine && (
          <>
            <SelectField text="מודל" value={source.model_type} options={models} onCommit={(v) => onChange('model_type', v)} />
            <NumberField text="גובה הגוף" unit="מ׳" value={source.box_height_m} onCommit={(v) => onChange('box_height_m', v)} />
            <label className="field">
              נתוני ייחוס: מרחק במ׳:שדה ב-mG, מופרדים בפסיק
              <input
                className="num"
                value={curve}
                placeholder="MISSING_DATA"
                onChange={(e) => setCurve(e.target.value)}
                onBlur={() => curve !== curveToText(source.reference_curve) && onChange('reference_curve', parseCurve(curve))}
              />
            </label>
            <NumberField text="זרם ייחוס" unit="A" value={source.reference_current_a} onCommit={(v) => onChange('reference_current_a', v)} />
            <NumberField
              text="מעריך דעיכה (לנקודת ייחוס אחת)"
              value={source.decay_exponent}
              onCommit={(v) => onChange('decay_exponent', v)}
            />
            <TextField text="מקור נתוני הייחוס" value={source.reference_source} onCommit={(v) => onChange('reference_source', v)} />
          </>
        )}
      </div>
      {source.missing?.length > 0 && (
        <p className="small" style={{ color: 'var(--warn)', marginTop: 8 }}>
          חסר: {source.missing.join(', ')}
        </p>
      )}
      <button type="button" className="btn-danger" style={{ marginTop: 10 }} onClick={onDelete}>
        מחיקת מקור
      </button>
    </div>
  );
}
