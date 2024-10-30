import { consola } from "consola";
import Elysia from "elysia";
import { getPath } from "hono/utils/url";

export function createLogger() {
  const map = new WeakMap<Request, { prefix: string; start: number }>();
  return new Elysia()
    .onRequest(({ request }) => {
      const state = {
        prefix: `[${request.method}] ${getPath(request)}`,
        start: performance.now(),
      };
      consola.start(state.prefix);
      map.set(request, state);
    })
    .onAfterResponse(({ request, response: r }) => {
      const state = map.get(request);
      if (!state) return;
      const response = r as Response;
      const time = `${Math.round(performance.now() - state.start)}ms`;
      if (response.status >= 400) {
        consola.fail(state.prefix, response.status, time);
      } else {
        consola.success(state.prefix, response.status, time);
      }
    })
    .as("plugin");
}
