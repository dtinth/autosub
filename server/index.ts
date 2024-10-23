import { $, inspect } from "bun";
import { createHash } from "crypto";
import { Elysia, t } from "elysia";
import fs, { mkdirSync } from "fs";
import { basename } from "path";
import speechmatics from "speechmatics";
import { codeBlock, icon, layout } from "./bootstrap";
import { extractTag } from "./extractTag";
import { transcribeWithGemini } from "./gemini";
import { transcribeWithIApp } from "./iApp";
import { createVttFromIApp } from "./iAppVtt";
import { importYouTubeTimedText } from "./importYouTubeTimedText";
import { improveTranscript } from "./improveTranscript";
import { NotFound } from "./NotFound";
import { transcribeWithOpenAI } from "./openai";
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
import { createWaveform } from "./waveform";
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
          <a href="asr-json" class="btn btn-sm btn-secondary">View JSON file</a>
        </p>

        ${title("Waveform", "codicon:play")}
        <p>
          ${operationLink(waveformTarget(), {
            actions: [{ action: "waveform", title: "Generate waveform" }],
          })}
          <a href="waveform" class="btn btn-sm btn-secondary"
            >View waveform file</a
          >
        </p>

        ${title("Word-level timestamps", "codicon:play")}
        <p>
          ${operationLink(wordTimestampsTarget(), {
            actions: [
              {
                action: "wordTimestamps",
                title: "Generate word-level timestamps from Speechmatics ASR",
              },
              {
                action: "importYouTubeForm",
                title:
                  "Import word-level timestamps from YouTube Timed Text JSON",
              },
            ],
          })}
          <a href="words-speechmatics" class="btn btn-sm btn-secondary"
            >Export as Speechmatics</a
          >
        </p>

        ${title("Partitioning", "codicon:play")}
        <p>
          ${operationLink(partitionsTarget(), {
            actions: [
              {
                action: "partitions?mode=long",
                title: "Generate partitions (long: 8 minutes)",
              },
              {
                action: "partitions?mode=normal",
                title: "Generate partitions (medium: 3 minutes)",
              },
              {
                action: "partitions?mode=short",
                title: "Generate partitions (short: 1 minute)",
              },
            ],
          })}
        </p>

        ${title("Parts", "codicon:play")} ${partsTable()}
        ${title("Transcript", "codicon:play")}
        <a href="transcript">Combined Transcript</a>

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
  .get(
    "/asr-json",
    async () =>
      new Response(
        JSON.stringify(await speechmaticsAsrTarget().fetchResult()),
        {
          headers: {
            "content-type": "application/json;charset=utf-8",
          },
        }
      )
  )
  .post("/importYouTubeForm", async () =>
    respondWithPage(layout, async (page) => {
      page.title = "Import from YouTube";
      page.write(html`
        <form method="post" action="importYouTube">
          <div class="mb-3">
            <label for="url" class="form-label">Timed text JSON</label>
            <textarea class="form-control" name="json" rows="10"></textarea>
          </div>
          <button type="submit" class="btn btn-primary">Import</button>
        </form>
      `);
    })
  )
  .post(
    "/importYouTube",
    async ({ body }) =>
      respondWithOperation(() =>
        importYouTubeTarget().createOperation({ json: body.json })
      ),
    {
      body: t.Object({
        json: t.String(),
      }),
    }
  )
  .post("/wordTimestamps", ({ query }) =>
    respondWithOperation(() => wordTimestampsTarget().createOperation())
  )
  .get("/words-speechmatics", async () => {
    const wordTimestamps = await wordTimestampsTarget().fetchResult();
    const speechmaticsResult: SpeechmaticsASRResult = {
      results: wordTimestamps.words.map((word) => ({
        start_time: word.start,
        end_time: word.end,
        alternatives: [{ content: word.word, confidence: 1 }],
      })),
    };
    return new Response(JSON.stringify(speechmaticsResult), {
      headers: {
        "Content-Type": "application/json;charset=utf-8",
      },
    });
  })
  .post(
    "/partitions",
    ({ query }) =>
      respondWithOperation(() =>
        partitionsTarget().createOperation({
          mode: query.mode as any,
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
  .post(
    "/transcribe-openai",
    ({ query }) =>
      respondWithOperation(() =>
        openaiTranscribeTarget(query.part).createOperation()
      ),
    { query: t.Object({ part: t.String() }) }
  )
  .post(
    "/transcribe-gemini",
    ({ query }) =>
      respondWithOperation(() =>
        geminiTranscribeTarget(query.part).createOperation()
      ),
    { query: t.Object({ part: t.String() }) }
  )
  .post(
    "/improve",
    ({ query }) =>
      respondWithOperation(() =>
        improveTranscriptTarget(query.part).createOperation()
      ),
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
  .get("/transcript", async () => {
    const { partitions } = await partitionsTarget().fetchResult();
    const parts: string[] = [];
    for (const partition of partitions) {
      const transcript = await improveTranscriptTarget(
        partition.name
      ).fetchResult();
      parts.push(extractTag(transcript.out, "ANSWER"));
    }
    return new Response(parts.join("\n"), {
      headers: {
        "Content-Type": "text/vtt;charset=utf-8",
      },
    });
  })
  .post("/waveform", async () =>
    respondWithOperation(() => waveformTarget().createOperation())
  )
  .get("/waveform", async () => {
    const waveformData = await waveformTarget().fetchResult();
    let words: [number, string][] = [];

    const asrResult = await speechmaticsAsrTarget().tryFetchResult();
    if (asrResult && asrResult.results) {
      words = asrResult.results
        .filter((result) => result.alternatives && result.alternatives[0])
        .map((result) => [result.start_time, result.alternatives[0].content]);
    }

    const response = {
      waveform: waveformData,
      words: words,
    };

    return new Response(JSON.stringify(response), {
      headers: {
        "Content-Type": "application/json;charset=utf-8",
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

function importYouTubeTarget() {
  return new Target<{ json: string }, WordTimestamps>({
    name: "word_timestamps",
    title: "Import word timestamps from YouTube timed text JSON",
    work: async (o, arg) => {
      const json = JSON.parse(arg.json);
      return importYouTubeTimedText(json);
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

function openaiTranscribeTarget(partName: string) {
  return new Target<void, any>({
    name: `openai:${partName}`,
    title: "Transcribe with OpenAI",
    work: async (o) => {
      const path = await getAudioPath(partName);
      return transcribeWithOpenAI(path, { log: o.log });
    },
  });
}

function geminiTranscribeTarget(partName: string) {
  type Result = Awaited<ReturnType<typeof transcribeWithGemini>>;
  return new Target<void, Result>({
    name: `gemini:${partName}`,
    title: "Transcribe with Gemini",
    work: async (o) => {
      const path = await getAudioPath(partName);
      return transcribeWithGemini(path, { log: o.log });
    },
  });
}

function improveTranscriptTarget(partName: string) {
  type Result = Awaited<ReturnType<typeof improveTranscript>>;
  return new Target<void, Result>({
    name: `improve:${partName}`,
    title: "Improve transcript",
    work: async (o) => {
      const geminiResult = await geminiTranscribeTarget(partName).fetchResult();
      return improveTranscript(geminiResult.out, { log: o.log });
    },
  });
}

function partitionsTarget() {
  return new Target<{ mode: "long" | "normal" | "short" }, Partitions>({
    name: "partitions",
    title: "Generate partitions",
    work: async (o, { mode }) => {
      const wordTimestamps = await wordTimestampsTarget().fetchResult();
      return partition(wordTimestamps, { mode, log: o.log });
    },
  });
}

function waveformTarget() {
  return new Target<void, number[]>({
    name: "waveform",
    title: "Generate waveform",
    work: async (o) => {
      return createWaveform("audio.mp3");
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
                ${operationLink(openaiTranscribeTarget(part.name), {
                  actions: [
                    {
                      action: `transcribe-openai?part=${part.name}`,
                      title: "Transcribe with OpenAI",
                    },
                  ],
                })}
                ${operationLink(geminiTranscribeTarget(part.name), {
                  actions: [
                    {
                      action: `transcribe-gemini?part=${part.name}`,
                      title: "Transcribe with Gemini",
                    },
                  ],
                })}
                ${operationLink(improveTranscriptTarget(part.name), {
                  actions: [
                    {
                      action: `improve?part=${part.name}`,
                      title: "Improve with Claude",
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
