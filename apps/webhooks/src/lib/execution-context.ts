import { AsyncLocalStorage } from "node:async_hooks";

interface ExecutionCtx {
  executionId: string;
}

const storage = new AsyncLocalStorage<ExecutionCtx>();

export function runWithExecution<T>(executionId: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ executionId }, fn);
}

export function getCurrentExecutionId(): string | undefined {
  return storage.getStore()?.executionId;
}
