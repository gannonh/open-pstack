function comparableSelector(value: string): string {
  return value.trim().toLowerCase().replace(/\./g, "-");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Claude's `[1m]`-style context modifier is invocation syntax. Provider
// reports may omit it, so identity comparison strips it from both sides.
export function stripContextModifier(selector: string): string {
  return selector.replace(/\[[a-z0-9]+\]$/i, "");
}

export function concreteClaudeRevisionMatchesRollingSelector(
  selector: string,
  reported: string
): boolean {
  const normalizedSelector = comparableSelector(selector);
  const normalizedReported = comparableSelector(stripContextModifier(reported));
  const pattern = new RegExp(
    `^claude-${escapeRegExp(normalizedSelector)}-[0-9]+(?:-[0-9]+)*$`
  );
  return pattern.test(normalizedReported);
}

// An explicit selector matches its own concrete version, with or without the
// context modifier and with or without a dated snapshot suffix. Any other
// version, including a sibling revision, is a mismatch.
export function concreteClaudeRevisionMatchesExplicitSelector(
  selector: string,
  reported: string
): boolean {
  const normalizedSelector = comparableSelector(stripContextModifier(selector));
  const normalizedReported = comparableSelector(stripContextModifier(reported));
  const pattern = new RegExp(`^${escapeRegExp(normalizedSelector)}(?:-[0-9]{8})?$`);
  return pattern.test(normalizedReported);
}
