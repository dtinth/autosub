import Keyv from "keyv";
import { uuidv7 } from "uuidv7";
import { store } from "./store";

export interface Operation {
  title: string;
  createdAt: string;
  settledAt?: string;
  status: "pending" | "completed" | "failed";
  error?: string;
  result?: any;
}

export interface OperationContext {
  id: string;
  log: (message: string) => void;
}

const opsStore = new Keyv({ store: store, namespace: "operations" });

export async function runOperation(
  title: string,
  f: (op: OperationContext) => Promise<any>
) {
  const id = uuidv7();
  const operation: Operation = {
    title,
    createdAt: new Date().toISOString(),
    status: "pending",
  };
  await opsStore.set(id, operation);
  const logStore = new Keyv({ store: store, namespace: `logs_${id}` });
  const resultPromise = (async () => {
    try {
      operation.result = await f({
        id,
        log: (message) => {
          console.log(`[${id}] ${message}`);
          logStore
            .set(uuidv7(), { time: new Date().toISOString(), message })
            .catch((e) => {
              console.error("Failed to log message", e);
            });
        },
      });
      operation.status = "completed";
    } catch (error: any) {
      operation.status = "failed";
      operation.error = error.stack || error.message;
    } finally {
      operation.settledAt = new Date().toISOString();
      await opsStore.set(id, operation);
    }
  })();
  return { id, resultPromise };
}

export type OperationCreateResult = Awaited<ReturnType<typeof runOperation>>;

export async function findOperation(id: string) {
  return await opsStore.get<Operation>(id);
}

export async function getOperation(id: string) {
  const op = await findOperation(id);
  if (!op) {
    throw new Error("Operation not found");
  }
  return op;
}

export async function getOperationLogs(id: string) {
  const logStore = new Keyv({ store: store, namespace: `logs_${id}` });
  const out: { time: string; message: string }[] = [];
  for await (const [_key, value] of logStore.iterator!(undefined)) {
    out.push(value);
  }
  out.sort((a, b) => a.time.localeCompare(b.time));
  return out;
}
