export function logProgress(state, message) {
  console.log(
    `[${state.source}] ` +
    `Depth=${state.depth} ` +
    `Visited=${state.visited.size} ` +
    `→ ${message}`
  );
}
