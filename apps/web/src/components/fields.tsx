import type { ReactNode } from 'react';

/**
 * Поля формы. Числовые значения ходят строками: пользователь печатает
 * «12,» или «-», и парсить это на каждом нажатии значит драться с вводом.
 * Разбор — один раз при отправке.
 */

const inputClass =
  'min-h-11 w-full rounded border border-slate-300 px-3 text-base ' +
  'focus:border-slate-500 focus:outline-none';

type FieldProps = {
  id: string;
  label: string;
  hint?: ReactNode;
  children: ReactNode;
};

function Field({ id, label, hint, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm text-slate-600">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

type TextFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Целые — цифровая клавиатура, дробные — с запятой (NFR-3). */
  numeric?: 'integer' | 'decimal';
  placeholder?: string;
  hint?: ReactNode;
};

export function TextField({ id, label, value, onChange, numeric, placeholder, hint }: TextFieldProps) {
  return (
    <Field id={id} label={label} hint={hint}>
      <input
        id={id}
        // Не type="number": он режет запятую как десятичный разделитель
        // и ловит прокрутку колесом. Клавиатуру задаёт inputMode.
        type="text"
        inputMode={numeric === 'decimal' ? 'decimal' : numeric === 'integer' ? 'numeric' : undefined}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
      />
    </Field>
  );
}

type TimeFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
};

export function TimeField({ id, label, value, onChange }: TimeFieldProps) {
  return (
    <Field id={id} label={label}>
      <input
        id={id}
        type="time"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
      />
    </Field>
  );
}

type SelectFieldProps<T extends string> = {
  id: string;
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  hint?: ReactNode;
};

export function SelectField<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
  hint,
}: SelectFieldProps<T>) {
  return (
    <Field id={id} label={label} hint={hint}>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className={inputClass}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </section>
  );
}
