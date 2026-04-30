'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar,
  CheckSquare,
  Clock,
  Hash,
  List,
  Plus,
  Tag,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import {
  convertValue,
  isRedundantSignatureProperty,
  parseFrontmatter,
  type Property,
  type PropertyType,
  type PropertyValue,
  type WikiFile,
  useWikiStore,
} from '@/lib/wiki';

const TYPE_OPTIONS: { type: PropertyType; label: string }[] = [
  { type: 'text', label: 'Text' },
  { type: 'number', label: 'Number' },
  { type: 'checkbox', label: 'Checkbox' },
  { type: 'date', label: 'Date' },
  { type: 'datetime', label: 'Date & Time' },
  { type: 'list', label: 'List' },
  { type: 'tags', label: 'Tags' },
];

function TypeIcon({ type, size = 14 }: { type: PropertyType; size?: number }) {
  switch (type) {
    case 'text':
      return <Type size={size} />;
    case 'number':
      return <Hash size={size} />;
    case 'checkbox':
      return <CheckSquare size={size} />;
    case 'date':
      return <Calendar size={size} />;
    case 'datetime':
      return <Clock size={size} />;
    case 'list':
      return <List size={size} />;
    case 'tags':
      return <Tag size={size} />;
  }
}

interface Props {
  file: WikiFile;
  readOnly?: boolean;
}

export function PropertiesBlock({ file, readOnly = false }: Props) {
  const updateProperties = useWikiStore((s) => s.updateProperties);

  const parsed = useMemo(() => parseFrontmatter(file.content), [file.content]);
  const visibleProperties = useMemo(
    () => parsed.properties.filter((property) => !isRedundantSignatureProperty(property.key)),
    [parsed.properties],
  );
  const hasRedundantProperties = visibleProperties.length !== parsed.properties.length;
  const [draft, setDraft] = useState<Property[]>(visibleProperties);
  const [openTypeMenu, setOpenTypeMenu] = useState<number | null>(null);
  const lastFileId = useRef(file.id);

  useEffect(() => {
    if (lastFileId.current !== file.id) {
      lastFileId.current = file.id;
      setDraft(visibleProperties);
      setOpenTypeMenu(null);
    } else {
      const aSer = JSON.stringify(visibleProperties);
      const bSer = JSON.stringify(draft);
      if (aSer !== bSer && visibleProperties.length !== draft.length) {
        setDraft(visibleProperties);
      }
    }
  }, [file.id, visibleProperties, draft]);

  useEffect(() => {
    if (!readOnly && hasRedundantProperties) updateProperties(file.id, visibleProperties);
  }, [file.id, hasRedundantProperties, readOnly, updateProperties, visibleProperties]);

  const persist = (next: Property[]) => {
    if (readOnly) return;
    setDraft(next);
    updateProperties(file.id, next);
  };

  const setProp = (index: number, patch: Partial<Property>) => {
    const next = draft.map((p, i) => (i === index ? { ...p, ...patch } : p));
    persist(next);
  };

  const removeProp = (index: number) => {
    persist(draft.filter((_, i) => i !== index));
  };

  const changeType = (index: number, type: PropertyType) => {
    const current = draft[index];
    const value = convertValue(current.value, type);
    setProp(index, { type, value });
    setOpenTypeMenu(null);
  };

  const addProp = () => {
    const usedKeys = new Set(draft.map((p) => p.key));
    let candidate = 'new property';
    let n = 1;
    while (usedKeys.has(candidate)) {
      n += 1;
      candidate = `new property ${n}`;
    }
    persist([...draft, { key: candidate, type: 'text', value: '' }]);
  };

  return (
    <div className="propertiesBlock">
      <div className="propertiesHeader">Properties</div>
      {draft.map((prop, index) => (
        <div className="propRow" key={`${index}-${prop.key}`}>
          <div className="propIconWrap">
            <button
              className="propIcon"
              disabled={readOnly}
              onClick={() => setOpenTypeMenu(openTypeMenu === index ? null : index)}
              title="Change type"
              type="button"
            >
              <TypeIcon type={prop.type} />
            </button>
            {openTypeMenu === index && (
              <div className="typeMenu" role="menu">
                {TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.type}
                    type="button"
                    className={`typeMenuItem ${prop.type === opt.type ? 'active' : ''}`}
                    onClick={() => changeType(index, opt.type)}
                  >
                    <TypeIcon type={opt.type} />
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <KeyInput value={prop.key} onCommit={(key) => setProp(index, { key })} readOnly={readOnly} />
          <ValueEditor prop={prop} onChange={(value) => setProp(index, { value })} readOnly={readOnly} />
          <button
            className="propRemove"
            disabled={readOnly}
            onClick={() => removeProp(index)}
            title="Delete property"
            type="button"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button className="addProp" onClick={addProp} type="button" disabled={readOnly}>
        <Plus size={14} />
        Add property
      </button>
    </div>
  );
}

function KeyInput({ value, onCommit, readOnly = false }: { value: string; onCommit: (next: string) => void; readOnly?: boolean }) {
  const [local, setLocal] = useState(value);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  return (
    <input
      className="propKey"
      readOnly={readOnly}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== value && local.trim().length > 0) onCommit(local.trim());
        else setLocal(value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setLocal(value);
      }}
    />
  );
}

function ValueEditor({
  prop,
  onChange,
  readOnly = false,
}: {
  prop: Property;
  onChange: (value: PropertyValue) => void;
  readOnly?: boolean;
}) {
  switch (prop.type) {
    case 'checkbox':
      return (
        <label className="propValue propCheckbox">
          <input
            type="checkbox"
            disabled={readOnly}
            checked={Boolean(prop.value)}
            onChange={(e) => onChange(e.target.checked)}
          />
        </label>
      );
    case 'number':
      return (
        <DebouncedInput
          className="propValue"
          type="number"
          value={prop.value === null ? '' : String(prop.value)}
          disabled={readOnly}
          onCommit={(v) => onChange(v === '' ? null : Number(v))}
        />
      );
    case 'date':
      return (
        <DebouncedInput
          className="propValue"
          type="date"
          value={typeof prop.value === 'string' ? prop.value : ''}
          disabled={readOnly}
          onCommit={(v) => onChange(v)}
        />
      );
    case 'datetime':
      return (
        <DebouncedInput
          className="propValue"
          type="datetime-local"
          value={typeof prop.value === 'string' ? prop.value.slice(0, 16) : ''}
          disabled={readOnly}
          onCommit={(v) => onChange(v)}
        />
      );
    case 'list':
    case 'tags':
      return (
        <ChipsEditor
          values={Array.isArray(prop.value) ? prop.value : []}
          onChange={onChange}
          isTag={prop.type === 'tags'}
          readOnly={readOnly}
        />
      );
    case 'text':
    default:
      return (
        <DebouncedInput
          className="propValue"
          type="text"
          value={prop.value === null ? '' : String(prop.value)}
          disabled={readOnly}
          onCommit={(v) => onChange(v)}
        />
      );
  }
}

function DebouncedInput({
  value,
  onCommit,
  ...rest
}: {
  value: string;
  onCommit: (next: string) => void;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const [local, setLocal] = useState(value);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  return (
    <input
      {...rest}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== value) onCommit(local);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setLocal(value);
      }}
    />
  );
}

function ChipsEditor({
  values,
  onChange,
  isTag,
  readOnly = false,
}: {
  values: string[];
  onChange: (value: string[]) => void;
  isTag: boolean;
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    if (readOnly) return;
    const value = draft.trim().replace(/^#/, '');
    if (!value) return;
    if (values.includes(value)) {
      setDraft('');
      return;
    }
    onChange([...values, value]);
    setDraft('');
  };

  const remove = (idx: number) => {
    if (readOnly) return;
    onChange(values.filter((_, i) => i !== idx));
  };

  return (
    <div className="propValue chipRow">
      {values.map((value, idx) => (
        <span key={`${idx}-${value}`} className={`chip ${isTag ? 'chip-tag' : ''}`}>
          {isTag ? `#${value}` : value}
          <button type="button" onClick={() => remove(idx)} aria-label="remove" disabled={readOnly}>
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        className="chipInput"
        value={draft}
        disabled={readOnly}
        placeholder={values.length === 0 ? (isTag ? '#add' : 'add') : ''}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commit();
          }
          if (e.key === 'Backspace' && draft === '' && values.length > 0) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={commit}
      />
    </div>
  );
}
