export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="spinner-wrap" role="status">
      <span className="spinner" />
      <span className="visually-hidden">{label}</span>
    </div>
  );
}
