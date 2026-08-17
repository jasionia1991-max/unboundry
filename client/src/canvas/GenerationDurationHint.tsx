export function GenerationDurationHint({
  label,
  testId = "generation-duration-hint",
}: {
  label?: string;
  testId?: string;
}) {
  if (!label) return null;
  return (
    <span className="generation-duration-hint" data-testid={testId}>
      {label}
    </span>
  );
}
