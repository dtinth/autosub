import Keyv from "keyv";
import { NotFound } from "./NotFound";
import { getOperation, OperationContext, runOperation } from "./operations";
import { store } from "./store";

const operationIdStore = new Keyv({
  store: store,
  namespace: "operationIds",
});

interface TargetDefinition<TArg, TResult> {
  name: string;
  title: string;
  work: (o: OperationContext, arg: TArg) => Promise<TResult>;
}

export class Target<TArg, TResult> {
  constructor(private definition: TargetDefinition<TArg, TResult>) {}
  async createOperation(arg: TArg) {
    return runOperation(this.definition.title, async (o) => {
      await operationIdStore.set(this.definition.name, o.id);
      return this.definition.work(o, arg);
    });
  }
  get name() {
    return this.definition.name;
  }
  tryFetchOperationId() {
    return operationIdStore.get<string>(this.definition.name);
  }
  async tryFetchOperation() {
    const id = await this.tryFetchOperationId();
    return id ? getOperation(id) : undefined;
  }
  fetchResult() {
    return loadResult<TResult>(this.definition.name);
  }
  tryFetchResult() {
    return tryLoadResult<TResult>(this.definition.name);
  }
}
export type AnyTarget = Target<any, any>;

async function loadResult<T>(key: string) {
  const id = await operationIdStore.get<string>(key);
  if (!id) {
    throw new NotFound(`Operation "${key}" not found`);
  }
  const operation = await getOperation(id);
  if (operation.status === "completed") {
    return operation.result as T;
  } else {
    throw new NotFound(`Operation "${key}" is not completed`);
  }
}

async function tryLoadResult<T>(key: string) {
  return loadResult<T>(key).catch((e) => {
    if (e instanceof NotFound) {
      return undefined;
    }
    throw e;
  });
}
