export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="border-b border-line">
      <div className="px-4 md:px-6 py-4 md:py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-lg font-medium text-text leading-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted mt-0.5">{subtitle}</p>}
        </div>
        {right && <div className="flex items-center gap-2 shrink-0 flex-wrap">{right}</div>}
      </div>
    </div>
  );
}

export function PageBody({ children }: { children: React.ReactNode }) {
  return <div className="p-4 md:p-6 space-y-4 md:space-y-6">{children}</div>;
}

export function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "accent";
}) {
  return (
    <div className="card p-3 md:p-4">
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
      </div>
      <div className={`text-2xl md:text-3xl font-medium mt-2 ${tone === "accent" ? "text-accent" : ""}`}>
        {value}
      </div>
      {hint && <div className="text-xs text-muted mt-1">{hint}</div>}
    </div>
  );
}

export function Field({
  name,
  label,
  defaultValue,
  placeholder,
  required,
  mono,
  type = "text",
}: {
  name: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  mono?: boolean;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="label block mb-1.5">{label}</span>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        className={`input ${mono ? "font-mono text-xs" : ""}`}
      />
    </label>
  );
}
