import { $, inspect } from "bun";
import { createHash } from "crypto";
import { Elysia, t } from "elysia";
import fs, { mkdirSync, readdirSync } from "fs";
import { basename } from "path";
import speechmatics from "speechmatics";
import { alignTranscript } from "./alignTranscript";
import { codeBlock, icon, layout } from "./bootstrap";
import { createLogger } from "./createLogger";
import { createVtt, VttSegment } from "./createVtt";
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
import { Html, html, respondWithPage } from "./View";
import { createWaveform } from "./waveform";
import {
  generateWordTimestampsFromSpeechmatics,
  WordTimestamps,
} from "./WordTimestamps";

const cwd = process.cwd();
const hash = createHash("sha256").update(cwd).digest("hex");
const port = 4573;
const projectName = basename(cwd);

const availableAsrPresets = ["speechmatics", "youtube"] as const;
type AsrPreset = (typeof availableAsrPresets)[number];

const availableTranscriberPresets = ["iapp", "openai", "gemini"] as const;
type TranscriberPreset = (typeof availableTranscriberPresets)[number];

const app = new Elysia({ prefix: `/projects/${hash}` })
  .use(createLogger())
  .get(
    "/home",
    ({ query, request }) =>
      respondWithPage(layout, async (page) => {
        const asrPreset = (query.asr ?? "youtube") as AsrPreset;
        const transcriberPreset = (query.preset ??
          "gemini") as TranscriberPreset;
        page.title = projectName;

        // Bootstrap script
        page.write(html`<script>
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
        </script>`);

        const section = (titleText: string) => {
          page.write(title(titleText, "codicon:play"));
        };

        section("Transcription notes");
        const notesFile = Bun.file("notes.txt");
        const notes = (await notesFile.exists()) ? await notesFile.text() : "";
        page.write(html`
          <form method="post" action="transcription-notes">
            <label class="d-block"
              >Notes for transcription
              <textarea
                class="form-control font-monospace"
                name="notes"
                rows="5"
              >
${notes}</textarea
              >
            </label>
            <button type="submit" class="btn btn-primary">Save</button>
          </form>
        `);

        section("Preset");
        const presetButton = (
          key: string,
          value: string,
          active: boolean
        ) => html`
          <a
            href="?${new URLSearchParams([
              ...Array.from(new URL(request.url).searchParams).filter(
                (x) => x[0] !== key
              ),
              [key, value],
            ]).toString()}"
            class="btn btn-sm ${active
              ? "btn-secondary"
              : "btn-outline-secondary"}"
          >
            ${value}
          </a>
        `;
        page.write(html`<div class="mb-3 d-flex gap-2 align-items-baseline">
          ASR:
          <div class="btn-group">
            ${availableAsrPresets.map((presetOption) =>
              presetButton("asr", presetOption, asrPreset === presetOption)
            )}
          </div>
        </div>`);
        page.write(html`<div class="mb-3 d-flex gap-2 align-items-baseline">
          Transcriber:
          <div class="btn-group">
            ${availableTranscriberPresets.map((presetOption) =>
              presetButton(
                "preset",
                presetOption,
                transcriberPreset === presetOption
              )
            )}
          </div>
        </div>`);

        {
          section("Obtain word-level timestamps");
          if (asrPreset === "speechmatics") {
            page.write(html`<ol>
              <li>
                Perform ASR with Speechmatics.
                <p>
                  ${operationLink(speechmaticsAsrTarget(), {
                    actions: [
                      {
                        action: "asr?model=speechmatics",
                        title: "Generate ASR",
                      },
                    ],
                  })}
                  <a href="asr-json" class="btn btn-sm btn-secondary"
                    >View JSON file</a
                  >
                </p>
              </li>
              <li>
                Convert to word-level timestamps.
                <p>
                  ${operationLink(wordTimestampsTarget(), {
                    actions: [
                      {
                        action: "wordTimestamps",
                        title:
                          "Generate word-level timestamps from Speechmatics",
                      },
                    ],
                  })}
                </p>
              </li>
            </ol>`);
          } else if (asrPreset === "youtube") {
            page.write(html`<ol>
              <li>
                Import YouTube timed text JSON.
                <p>
                  ${operationLink(importYouTubeTarget(), {
                    actions: [
                      {
                        action: "importYouTubeForm",
                        title: "Import YouTube timed text JSON",
                      },
                    ],
                  })}
                </p>
              </li>
            </ol>`);
          }
        }

        section("Partitioning into parts");
        page.write(html`<p>
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
        </p>`);

        section("Process each part");
        page.write(html`${partsTable(transcriberPreset)}`);
        if (transcriberPreset === "gemini") {
          page.write(html`<a href="transcript">View combined Transcript</a>`);

          section("Align");
          page.write(html`<p>
            ${operationLink(alignTarget(), {
              actions: [{ action: "align", title: "Align transcript" }],
            })}
          </p>`);
          page.write(html`<p><a href="alignment">Show alignment</a></p>`);
          page.write(html`<p><a href="vtt-aligned">VTT</a></p>`);
        }

        if (transcriberPreset === "iapp") {
          section("Subtitles");
          page.write(html`
            ${query.preset === "iapp"
              ? html`<a href="vtt-iapp">VTT from iApp PRO</a>`
              : ""}
          `);
        }

        section("Generate waveform");
        page.write(html`<p>
          ${operationLink(waveformTarget(), {
            actions: [{ action: "waveform", title: "Generate waveform" }],
          })}
          <a href="waveform" class="btn btn-sm btn-secondary"
            >View waveform file</a
          >
        </p>`);

        section("Export word-level timestamps");
        page.write(html`<p>
          <a href="words-speechmatics" class="btn btn-sm btn-secondary"
            >Export as Speechmatics</a
          >
        </p>`);
      }),
    {
      query: t.Object({
        preset: t.Optional(t.String()),
        asr: t.Optional(t.String()),
      }),
    }
  )
  .post(
    "/transcription-notes",
    async ({ body }) => {
      await Bun.write("notes.txt", body.notes);
      return new Response(null, {
        status: 303,
        headers: {
          location: "home",
        },
      });
    },
    { body: t.Object({ notes: t.String() }) }
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
  .post("/importYouTubeForm", async () => {
    // Attempt to find "audio.mp3.*.json3"
    const foundSubtitleFile = readdirSync(cwd).find((file) =>
      file.match(/^audio\.mp3\..*\.json3$/)
    );
    if (foundSubtitleFile) {
      const json = await Bun.file(foundSubtitleFile).text();
      return respondWithOperation(() =>
        importYouTubeTarget().createOperation({ json })
      );
    }

    return respondWithPage(layout, async (page) => {
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
    });
  })
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
  .post("/align", () =>
    respondWithOperation(() => alignTarget().createOperation())
  )
  .get("/alignment", async () => {
    return respondWithPage(layout, async (page) => {
      const { outputRows, asrWords } = await alignTarget().fetchResult();
      return html` <h1>Alignment result</h1>
        <style>
          .alignment[data-kind="exact"] {
            color: var(--bs-green);
          }
          .alignment[data-kind="approx"] {
            color: var(--bs-orange);
          }
          .alignment[data-kind="missing"] {
            color: var(--bs-red);
          }
        </style>
        <table>
          <thead>
            <tr>
              <th>Transcript</th>
              <th nowrap style="text-align: right; padding-left :1ch">
                Start time
              </th>
              <th nowrap style="text-align: right; padding-left :1ch">
                End time
              </th>
              <th style="padding-left: 1ch">Alignment source</th>
            </tr>
          </thead>
          ${outputRows.map((row) => {
            const alignedWords = row.words.filter((word) => word.alignment);
            const start = Math.min(
              ...alignedWords.map((word) => word.alignment!.start)
            );
            const end = Math.max(
              ...alignedWords.map((word) => word.alignment!.end)
            );
            const startIndex = Math.min(
              ...alignedWords.map((word) => word.alignment!.index)
            );
            const endIndex = Math.max(
              ...alignedWords.map((word) => word.alignment!.index)
            );
            const usedWords = asrWords.slice(startIndex, endIndex + 1);
            const words = usedWords.map((word) => word.word).join(" ");
            const codes = [...row.text] as Html[];
            for (const word of row.words) {
              const startIndex = word.index;
              const endIndex = word.index + [...word.word].length;
              const kind = word.alignment
                ? word.alignment.exact
                  ? "exact"
                  : "approx"
                : "missing";
              // prettier-ignore
              codes[startIndex] = html`<span class="alignment" data-kind="${kind}">${codes[startIndex]}`;
              codes[endIndex - 1] = html`${codes[endIndex - 1]}</span>`;
            }
            return html`
              <tr data-words="${JSON.stringify(row.words)}">
                <td style="white-space:pre-wrap">${codes.filter((x) => x)}</td>
                <td align="right">${start.toFixed(2)}s</td>
                <td align="right">${end.toFixed(2)}s</td>
                <td class="text-muted" style="padding-left: 1ch">${words}</td>
              </tr>
            `;
          })}
        </table>`;
    });
  })
  .get("/vtt-aligned", async () => {
    let segments: VttSegment[] = [];
    const { outputRows } = await alignTarget().fetchResult();

    // https://help.happyscribe.com/en/articles/9174614-what-are-subtitle-gaps
    const minimumGap = (1 / 24) * 2;

    for (const row of outputRows) {
      const alignedWords = row.words.filter((word) => word.alignment);
      const start = Math.min(
        ...alignedWords.map((word) => word.alignment!.start)
      );
      const end = Math.max(...alignedWords.map((word) => word.alignment!.end));
      if (Number.isFinite(start) && Number.isFinite(end)) {
        const lastSegment = segments[segments.length - 1];
        if (lastSegment && lastSegment.end >= start - minimumGap) {
          lastSegment.end = start - minimumGap;
        }
        segments.push({ text: row.text, start, end });
      }
    }

    segments = segments.filter(
      (s) => s.text.trim() && s.end - s.start > minimumGap
    );

    return new Response(createVtt(segments), {
      headers: {
        "Content-Type": "text/vtt;charset=utf-8",
      },
    });
  })
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
    const combinedTranscript = await getCombinedTranscript();
    return new Response(combinedTranscript, {
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

async function getCombinedTranscript() {
  const { partitions } = await partitionsTarget().fetchResult();
  const parts: string[] = [];
  for (const partition of partitions) {
    const transcript = await improveTranscriptTarget(
      partition.name
    ).fetchResult();
    parts.push(extractTag(transcript.out, "ANSWER"));
  }
  const combinedTranscript = parts.join("\n");
  return combinedTranscript;
}

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

function alignTarget() {
  type Result = Awaited<ReturnType<typeof alignTranscript>>;
  return new Target<void, Result>({
    name: `alignment`,
    title: "Align transcript",
    work: async (o) => {
      const wordTimestamps = await wordTimestampsTarget().fetchResult();
      const combinedTranscript = await getCombinedTranscript();
      return alignTranscript(combinedTranscript, wordTimestamps, {
        log: o.log,
      });
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

async function partsTable(preset: TranscriberPreset) {
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
        ${parts.partitions.map((part) => {
          const actions: Html[] = [];
          if (preset === "iapp") {
            actions.push(
              operationLink(iAppProTarget(part.name), {
                actions: [
                  {
                    action: `transcribe-iapp?part=${part.name}`,
                    title: "Transcribe with iApp ASR",
                  },
                ],
              })
            );
          }
          if (preset === "openai") {
            actions.push(
              operationLink(openaiTranscribeTarget(part.name), {
                actions: [
                  {
                    action: `transcribe-openai?part=${part.name}`,
                    title: "Transcribe with OpenAI",
                  },
                ],
              })
            );
          }
          if (preset === "gemini") {
            actions.push(
              operationLink(geminiTranscribeTarget(part.name), {
                actions: [
                  {
                    action: `transcribe-gemini?part=${part.name}`,
                    title: "Transcribe with Gemini",
                  },
                ],
              }),
              operationLink(improveTranscriptTarget(part.name), {
                actions: [
                  {
                    action: `improve?part=${part.name}`,
                    title: "Improve with Claude",
                  },
                ],
              })
            );
          }
          return html`
            <tr>
              <td><a href="audio?part=${part.name}">${part.name}</a></td>
              <td>${actions}</td>
            </tr>
          `;
        })}
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
