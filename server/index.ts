import { inspect } from "bun";
import { createHash } from "crypto";
import { Elysia, t } from "elysia";
import fs from "fs";
import Keyv from "keyv";
import { basename } from "path";
import speechmatics from "speechmatics";
import { codeBlock, icon, layout } from "./bootstrap";
import {
  findOperation,
  getOperation,
  getOperationLogs,
  OperationCreateResult,
  runOperation,
} from "./operations";
import { partition, Partitions } from "./Partitions";
import { SpeechmaticsASRResult } from "./SpeechmaticsASRResult";
import { store } from "./store";
import { html, respondWithPage } from "./View";
import {
  generateWordTimestampsFromSpeechmatics,
  WordTimestamps,
} from "./WordTimestamps";

const cwd = process.cwd();
const hash = createHash("sha256").update(cwd).digest("hex");
const port = 4573;
const projectName = basename(cwd);
const operationIdStore = new Keyv({ store: store, namespace: "operationIds" });

const app = new Elysia({ prefix: `/projects/${hash}` })
  .get("/home", () =>
    respondWithPage(layout, async (page) => {
      page.title = projectName;
      return html`
        <script>
          function doPost(action) {
            const form = document.createElement("form");
            form.method = "POST";
            form.action = action;
            document.body.appendChild(form);
            form.submit();
          }
        </script>
        ${title("Basic ASR", "codicon:play")}
        <p>
          ${operationLink("full_asr_speechmatics", {
            actions: [
              { action: "asr?model=speechmatics", title: "Generate ASR" },
            ],
          })}
        </p>

        ${title("Word-level timestamps", "codicon:play")}
        <p>
          ${operationLink("word_timestamps", {
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
          ${operationLink("partitions", {
            actions: [{ action: "partitions", title: "Generate partitions" }],
          })}
        </p>

        ${title("Parts", "codicon:play")} ${partsTable()}
      `;
    })
  )
  .post(
    "/asr",
    ({ query }) =>
      respondWithOperation(async () => {
        return speechmaticsAsr();
      }),
    { query: t.Object({ model: t.String() }) }
  )
  .post("/wordTimestamps", ({ query }) =>
    respondWithOperation(async () => {
      return runOperation(`Generate word-level timestamps`, async (o) => {
        await operationIdStore.set("word_timestamps", o.id);
        const asrResult = await loadResult<SpeechmaticsASRResult>(
          "full_asr_speechmatics"
        );
        return generateWordTimestampsFromSpeechmatics(asrResult);
      });
    })
  )
  .post("/partitions", () =>
    respondWithOperation(async () => {
      return runOperation("Generate partitions", async (o) => {
        await operationIdStore.set("partitions", o.id);
        const wordTimestamps = await loadResult<WordTimestamps>(
          "word_timestamps"
        );
        return partition(wordTimestamps, o.log);
      });
    })
  )
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

function speechmaticsAsr() {
  return runOperation(`ASR with Speechmatics`, async (o) => {
    await operationIdStore.set("full_asr_speechmatics", o.id);
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
      return transcript;
    } catch (error) {
      o.log("ASR failed.");
      throw error;
    }
  });
}

async function operationLink(
  key: string,
  options: {
    actions: { action: string; title: string }[];
  }
) {
  const id = await operationIdStore.get<string>(key);
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
    ? html`<a href="${href}" class="btn ${btnClass}">${key}</a>`
    : html`<button class="btn ${btnClass}" disabled>${key}</button>`;
  return html`
    <div class="btn-group">
      ${mainButton}
      <button
        type="button"
        class="btn ${btnClass} dropdown-toggle dropdown-toggle-split"
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
                href="javascript:doPost(${encodeURIComponent(
                  JSON.stringify(x.action)
                )})"
                >${x.title}</a
              >
            </li>`
        )}
      </ul>
    </div>
  `;
}

async function loadResult<T>(key: string) {
  const id = await operationIdStore.get<string>(key);
  if (!id) {
    throw new Error(`Operation "${key}" not found`);
  }
  const operation = await getOperation(id);
  if (operation.status === "completed") {
    return operation.result as T;
  } else {
    throw new Error(`Operation "${key}" is not completed`);
  }
}

async function tryLoadResult<T>(key: string) {
  const id = await operationIdStore.get<string>(key);
  if (!id) {
    return undefined;
  }
  const operation = await getOperation(id);
  if (operation.status === "completed") {
    return operation.result as T;
  } else {
    return undefined;
  }
}

async function partsTable() {
  const parts = await tryLoadResult<Partitions>("partitions");
  if (!parts) {
    return null;
  }
  return html`
    <table class="table table-striped table-hover">
      <thead>
        <tr>
          <th>Part</th>
          <th>Start</th>
          <th>End</th>
        </tr>
      </thead>
      <tbody>
        ${parts.partitions.map(
          (part) => html`
            <tr>
              <td>${part.name}</td>
              <td>${part.start.toFixed(2)}</td>
              <td>${part.end.toFixed(2)}</td>
            </tr>
          `
        )}
      </tbody>
    </table>
  `;
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
