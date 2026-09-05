function comparableSelector(value: string): string {
  return value.trim().toLowerCase().replace(/\./g, "-");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function concreteClaudeRevisionMatchesRollingSelector(
  selector: string,
  reported: string
): boolean {
  const normalizedSelector = comparableSelector(selector);
  const normalizedReported = comparableSelector(reported);
  const pattern = new RegExp(
    `^claude-${escapeRegExp(normalizedSelector)}-[0-9]+(?:-[0-9]+)*$`
  );
  return pattern.test(normalizedReported);
}
