import { $, inspect } from "bun";
import { createHash } from "crypto";
import { Elysia, t } from "elysia";
import fs, { mkdirSync } from "fs";
import { basename } from "path";
import speechmatics from "speechmatics";
import { codeBlock, icon, layout } from "./bootstrap";
import { transcribeWithIApp } from "./iApp";
import { createVttFromIApp } from "./iAppVtt";
import { NotFound } from "./NotFound";
import {
  findOperation,
  getOperation,
  getOperationLogs,
  OperationCreateResult,
} from "./operations";
import { partition, Partitions } from "./Partitions";
import { SpeechmaticsASRResult } from "./SpeechmaticsASRResult";
import { AnyTarget, Target } from "./Target";
import { html, respondWithPage } from "./View";
import {
  generateWordTimestampsFromSpeechmatics,
  WordTimestamps,
} from "./WordTimestamps";

const cwd = process.cwd();
const hash = createHash("sha256").update(cwd).digest("hex");
const port = 4573;
const projectName = basename(cwd);

const app = new Elysia({ prefix: `/projects/${hash}` })
  .get("/home", () =>
    respondWithPage(layout, async (page) => {
      page.title = projectName;
      return html`
        <script>
          function doPost(action, e) {
            if (e.metaKey || e.altKey || e.ctrlKey) {
              e.preventDefault();
              fetch(action, { method: "POST" });
              return;
            }
            const form = document.createElement("form");
            form.method = "POST";
            form.action = action;
            document.body.appendChild(form);
            form.submit();
          }
        </script>
        ${title("Basic ASR", "codicon:play")}
        <p>
          ${operationLink(speechmaticsAsrTarget(), {
            actions: [
              { action: "asr?model=speechmatics", title: "Generate ASR" },
            ],
          })}
        </p>

        ${title("Word-level timestamps", "codicon:play")}
        <p>
          ${operationLink(wordTimestampsTarget(), {
            actions: [
              {
                action: "wordTimestamps",
                title: "Generate word-level timestamps",
              },
            ],
          })}
        </p>

        ${title("Partitioning", "codicon:play")}
        <p>
          ${operationLink(partitionsTarget(), {
            actions: [
              { action: "partitions", title: "Generate partitions" },
              {
                action: "partitions?mode=short",
                title: "Generate partitions (shorter)",
              },
            ],
          })}
        </p>

        ${title("Parts", "codicon:play")} ${partsTable()}
        ${title("Subtitle", "codicon:play")}
        <a href="vtt-iapp">VTT from iApp PRO</a>
      `;
    })
  )
  .post(
    "/asr",
    ({ query }) =>
      respondWithOperation(() => speechmaticsAsrTarget().createOperation()),
    { query: t.Object({ model: t.String() }) }
  )
  .post("/wordTimestamps", ({ query }) =>
    respondWithOperation(() => wordTimestampsTarget().createOperation())
  )
  .post(
    "/partitions",
    ({ query }) =>
      respondWithOperation(() =>
        partitionsTarget().createOperation({
          short: query.mode === "short",
        })
      ),
    { query: t.Object({ mode: t.String() }) }
  )
  .get(
    "/audio",
    async ({ query }) => {
      const outFile = await getAudioPath(query.part);
      return Bun.file(outFile);
    },
    {
      query: t.Object({ part: t.String() }),
    }
  )
  .post(
    "/transcribe-iapp",
    ({ query }) =>
      respondWithOperation(() => iAppProTarget(query.part).createOperation()),
    { query: t.Object({ part: t.String() }) }
  )
  .get("/vtt-iapp", async () => {
    const partitions = await partitionsTarget().fetchResult();
    const vtt = await createVttFromIApp({
      partitions,
      getResult: (partName) => iAppProTarget(partName).fetchResult(),
    });
    return new Response(vtt, {
      headers: {
        "Content-Type": "text/vtt;charset=utf-8",
      },
    });
  })
  .get(
    "/operations",
    ({ query }) =>
      respondWithPage(layout, async (page) => {
        const op = await getOperation(query.id);
        page.title = op.title;
        const badgeClass = {
          pending: "text-bg-warning",
          completed: "text-bg-success",
          failed: "text-bg-danger",
        }[op.status];
        page.write(html`<span class="badge ${badgeClass}">${op.status}</span>`);

        if (op.result) {
          page.write(html`
            ${title("Result", "codicon:output")}
            ${codeBlock(inspect(op.result))}
          `);
        }

        if (op.error) {
          page.write(html`
            ${title("Error", "codicon:error")} ${codeBlock(op.error)}
          `);
        }

        const viewLogs = async () => {
          const logs = await getOperationLogs(query.id);
          return html` ${codeBlock(logs.map((x) => x.message).join("\n"))} `;
        };

        page.write(html` ${title("Logs", "codicon:output")} ${viewLogs()} `);
      }),
    { query: t.Object({ id: t.String() }) }
  );

function title(text: string, iconName: string) {
  return html`<h2 class="mt-4 mb-2 text-muted h4">
    ${icon(iconName)} <strong>${text}</strong>
  </h2>`;
}

function respondWithOperation(factory: () => Promise<OperationCreateResult>) {
  return respondWithPage(layout, async (page) => {
    const { id } = await factory();
    page.redirect("operations?id=" + id);
  });
}

function speechmaticsAsrTarget() {
  return new Target<void, SpeechmaticsASRResult>({
    name: "full_asr_speechmatics",
    title: "ASR with Speechmatics",
    work: async (o) => {
      const sm = new speechmatics.Speechmatics({
        apiKey: process.env.SPEECHMATICS_API_KEY!,
      });

      o.log("Reading audio file...");
      const input = new Blob([fs.readFileSync("audio.mp3")]);

      o.log("Performing ASR on audio file...");
      try {
        const transcript = await sm.batch.transcribe(
          { data: input, fileName: `${projectName}_audio.mp3` },
          {
            transcription_config: {
              language: "th",
              operating_point: "standard", // enhanced
            },
          },
          "json-v2"
        );

        o.log("ASR completed.");
        return transcript as SpeechmaticsASRResult;
      } catch (error) {
        o.log("ASR failed.");
        throw error;
      }
    },
  });
}

function wordTimestampsTarget() {
  return new Target<void, WordTimestamps>({
    name: "word_timestamps",
    title: "Generate word-level timestamps",
    work: async (o) => {
      const asrResult = await speechmaticsAsrTarget().fetchResult();
      return generateWordTimestampsFromSpeechmatics(asrResult);
    },
  });
}

function iAppProTarget(partName: string) {
  return new Target<void, any>({
    name: `iapp_pro:${partName}`,
    title: "Transcribe with iApp ASR PRO",
    work: async (o) => {
      const path = await getAudioPath(partName);
      return transcribeWithIApp(path, { pro: true, log: o.log });
    },
  });
}

function partitionsTarget() {
  return new Target<{ short: boolean }, Partitions>({
    name: "partitions",
    title: "Generate partitions",
    work: async (o, { short }) => {
      const wordTimestamps = await wordTimestampsTarget().fetchResult();
      return partition(wordTimestamps, { short, log: o.log });
    },
  });
}

async function operationLink(
  target: AnyTarget,
  options: {
    actions: { action: string; title: string }[];
  }
) {
  const id = await target.tryFetchOperationId();
  let btnClass = "btn-secondary";
  let href = "";
  if (id) {
    const operation = await findOperation(id);
    btnClass = {
      "": "btn-secondary",
      pending: "btn-warning",
      completed: "btn-success",
      failed: "btn-danger",
    }[operation?.status || ""];
    href = `operations?id=${id}`;
  }
  const mainButton = href
    ? html`<a href="${href}" class="btn btn-sm ${btnClass}">${target.name}</a>`
    : html`<button class="btn btn-sm ${btnClass}" disabled>
        ${target.name}
      </button>`;
  return html`
    <div class="btn-group">
      ${mainButton}
      <button
        type="button"
        class="btn btn-sm ${btnClass} dropdown-toggle dropdown-toggle-split"
        data-bs-toggle="dropdown"
        aria-expanded="false"
      >
        <span class="visually-hidden">Toggle Dropdown</span>
      </button>
      <ul class="dropdown-menu">
        ${options.actions.map(
          (x) =>
            html`<li>
              <a
                class="dropdown-item"
                href="javascript:"
                onclick="doPost(${JSON.stringify(x.action)},event)"
                >${x.title}</a
              >
            </li>`
        )}
      </ul>
    </div>
  `;
}

async function partsTable() {
  const parts = await partitionsTarget().tryFetchResult();
  if (!parts) return null;
  return html`
    <table class="table table-striped table-hover">
      <thead>
        <tr>
          <th>Part</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${parts.partitions.map(
          (part) => html`
            <tr>
              <td><a href="audio?part=${part.name}">${part.name}</a></td>
              <td>
                ${operationLink(iAppProTarget(part.name), {
                  actions: [
                    {
                      action: `transcribe-iapp?part=${part.name}`,
                      title: "Transcribe with iApp ASR",
                    },
                  ],
                })}
              </td>
            </tr>
          `
        )}
      </tbody>
    </table>
  `;
}

async function getPart(name: string) {
  const parts = await partitionsTarget().fetchResult();
  const part = parts.partitions.find((x) => x.name === name);
  if (!part) throw new NotFound(`Part "${name}" not found`);
  return part;
}

async function getAudioPath(partName: string) {
  const part = await getPart(partName);
  const outFile = "artifacts/" + part.name + ".mp3";
  if (!fs.existsSync(outFile)) {
    mkdirSync("artifacts", { recursive: true });
    await $`ffmpeg -i audio.mp3 -ss ${part.start} -to ${part.end} -c copy ${outFile} -y`;
  }
  return outFile;
}

app.listen(
  {
    hostname: "127.0.0.1",
    port,
  },
  () => {
    console.log(
      `Server is running on http://localhost:${port}/projects/${hash}/home`
    );
  }
);
