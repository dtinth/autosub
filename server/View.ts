import { fromAnyIterable } from "@sec-ant/readable-stream/ponyfill/fromAnyIterable";
import { Html, html, Hypertext, renderHtmlStream } from "@thai/html";
import { format } from "node:util";
export { html, type Html } from "@thai/html";

export interface PageBuilder {
  /** Title of the page. Change this property to customize the page title and header. */
  title: string;

  /** HTTP status code. Default is 200. Change this property to set a different status code. */
  status: number;

  /** Display something on the page. */
  write: (...v: Html[]) => void;

  /** Display something on the page. */
  writeHead: (...v: Html[]) => void;

  /** Add a log message. This will be added to the end of the page for diagnostics. */
  debug: (...p: any[]) => void;

  /** Redirect to another page. Should be used with the `return` keyword. */
  redirect: (p: string) => void;
}

export interface PageLayout {
  template: (props: { title: string; head: Html; body: Html }) => Hypertext;
  renderError: (error: Error) => Hypertext;
  renderLogs: (logs: string[]) => Hypertext;
}

export async function respondWithPage(
  layout: PageLayout,
  f: (page: PageBuilder) => Promise<Html | void>
): Promise<Response> {
  const head: Html[] = [];
  const body: Html[] = [];
  const log: string[] = [];

  let redirectTarget: string | undefined;
  const builder: PageBuilder = {
    redirect: (p: string) => {
      redirectTarget = p;
    },
    title: "",
    status: 200,
    write: (...v: Html[]) => body.push(...v),
    writeHead: (...v: Html[]) => head.push(...v),
    debug: (...a: any[]) => {
      const str = format(...a);
      log.push(str);
      console.log("debug:", str);
    },
  };
  try {
    const result = await f(builder);
    if (result instanceof Response) {
      return result;
    }
    body.push(html`${result}`);
  } catch (error: any) {
    if (error instanceof Response) {
      return error;
    }
    body.push(layout.renderError(error));
  }

  if (log.length > 0) {
    body.push(layout.renderLogs(log));
  }

  if (redirectTarget) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: redirectTarget,
      },
    });
  }

  const outputHtml = layout.template({
    title: builder.title,
    head: html`${head}`,
    body: html`${body}`,
  });

  return new Response(fromAnyIterable(renderHtmlStream(outputHtml)), {
    status: builder.status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}
