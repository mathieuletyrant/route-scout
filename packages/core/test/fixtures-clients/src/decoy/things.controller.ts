// A controller whose method is named after the operationId, but which does NOT
// import any generated client. Must count as ZERO usages under client gating.
export class ThingsController {
  getThing(id: string) {
    return { id };
  }
}
