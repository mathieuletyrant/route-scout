// A local usecase that defines and calls a `getThing` unrelated to any client.
// No client import → ZERO usages under client gating.
function getThing(id: string) {
  return { id };
}

export function run() {
  return getThing('1');
}
