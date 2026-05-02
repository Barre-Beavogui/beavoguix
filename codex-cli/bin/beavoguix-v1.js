#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { stdin as input, stdout as output } from "node:process";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const DEFAULT_PROVIDER = "ollama";
const DEFAULT_MODEL = "qwen2.5-coder:7b";
const DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434";
const DEFAULT_MAX_FILES = 12;
const DEFAULT_MAX_BYTES_PER_FILE = 24_000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BUNDLED_RG = path.join(__dirname, "rg");

function printUsage() {
  console.log(`BeavoguiX V1

Usage:
  beavoguix-v1 [options] "<request>"

Options:
  --cwd <path>                 Project directory. Default: current directory.
  --provider <name>            Model provider: ollama or openai. Default: ${DEFAULT_PROVIDER}.
  --model <name>               Model name. Default: ${DEFAULT_MODEL}.
  --file <path>                Force a context file. Can be repeated.
  --max-files <n>              Maximum context files. Default: ${DEFAULT_MAX_FILES}.
  --max-bytes-per-file <n>     Per-file read cap. Default: ${DEFAULT_MAX_BYTES_PER_FILE}.
  --dry-run                    Print the patch but do not ask/apply.
  -h, --help                   Show this help.

Environment:
  BEAVOGUIX_PROVIDER           Overrides the default provider.
  BEAVOGUIX_MODEL              Overrides the default model.
  OLLAMA_HOST                  Ollama base URL. Default: ${DEFAULT_OLLAMA_HOST}.
  OPENAI_API_KEY               Required only with --provider openai.
  BEAVOGUIX_MODEL_COMMAND      Optional local command that receives the model prompt JSON on stdin
                               and prints a unified diff on stdout.
`);
}

function parseArgs(argv) {
  const options = {
    cwd: process.cwd(),
    provider: process.env.BEAVOGUIX_PROVIDER || DEFAULT_PROVIDER,
    model: process.env.BEAVOGUIX_MODEL || DEFAULT_MODEL,
    maxFiles: DEFAULT_MAX_FILES,
    maxBytesPerFile: DEFAULT_MAX_BYTES_PER_FILE,
    dryRun: false,
    files: [],
    requestParts: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--cwd":
        options.cwd = requireValue(argv, (index += 1), arg);
        break;
      case "--provider":
        options.provider = requireValue(argv, (index += 1), arg);
        break;
      case "--model":
        options.model = requireValue(argv, (index += 1), arg);
        break;
      case "--file":
        options.files.push(
          normalizeFilePath(requireValue(argv, (index += 1), arg)),
        );
        break;
      case "--max-files":
        options.maxFiles = parsePositiveInt(
          requireValue(argv, (index += 1), arg),
          arg,
        );
        break;
      case "--max-bytes-per-file":
        options.maxBytesPerFile = parsePositiveInt(
          requireValue(argv, (index += 1), arg),
          arg,
        );
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "-h":
      case "--help":
        options.help = true;
        break;
      default:
        options.requestParts.push(arg);
        break;
    }
  }

  options.cwd = path.resolve(options.cwd);
  options.provider = options.provider.toLowerCase();
  options.request = options.requestParts.join(" ").trim();
  return options;
}

function normalizeFilePath(filePath) {
  return filePath.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function requireValue(argv, index, optionName) {
  const value = argv[index];
  if (!value) {
    throw new Error(`${optionName} requires a value.`);
  }
  return value;
}

function parsePositiveInt(value, optionName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer.`);
  }
  return parsed;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    input: options.input,
    maxBuffer: options.maxBuffer || 10 * 1024 * 1024,
  });

  if (result.error) {
    if (options.allowMissing && result.error.code === "ENOENT") {
      return { missingCommand: true, status: 127, stdout: "", stderr: "" };
    }
    throw result.error;
  }

  return result;
}

function listProjectFiles(cwd) {
  let result = run("rg", ["--files"], { cwd, allowMissing: true });
  if (result.missingCommand) {
    result = run(BUNDLED_RG, ["--files"], { cwd, allowFailure: true });
  }
  if (result.status !== 0) {
    result = run("git", ["ls-files"], { cwd, allowFailure: true });
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || "file scan failed.");
  }

  return result.stdout
    .split("\n")
    .map((file) => file.trim())
    .filter(Boolean);
}

function chooseRelevantFiles(files, request, maxFiles, forcedFiles = []) {
  const availableFiles = new Set(files.map(normalizeFilePath));
  const validForcedFiles = forcedFiles.filter((file) =>
    availableFiles.has(file),
  );
  if (validForcedFiles.length > 0) {
    return validForcedFiles;
  }

  const requestTokens = new Set(
    request
      .toLowerCase()
      .split(/[^a-z0-9_./-]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3),
  );

  return files
    .filter(isReadableSourceFile)
    .map((file) => ({ file, score: scoreFile(file, requestTokens) }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.file.split("/").length - right.file.split("/").length ||
        left.file.length - right.file.length ||
        left.file.localeCompare(right.file),
    )
    .slice(0, maxFiles)
    .map(({ file }) => file);
}

function isReadableSourceFile(file) {
  const normalized = file.replaceAll("\\", "/");
  if (
    /(^|\/)(node_modules|target|dist|build|coverage|vendor|\.git)\//u.test(
      normalized,
    )
  ) {
    return false;
  }

  const ext = path.extname(normalized).toLowerCase();
  return new Set([
    "",
    ".c",
    ".cc",
    ".cpp",
    ".css",
    ".go",
    ".html",
    ".java",
    ".js",
    ".json",
    ".jsx",
    ".md",
    ".mjs",
    ".py",
    ".rs",
    ".sh",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".yaml",
    ".yml",
  ]).has(ext);
}

function scoreFile(file, requestTokens) {
  const lowerFile = file.toLowerCase();
  const lowerBase = path.basename(lowerFile);
  let score = 0;

  for (const token of requestTokens) {
    if (lowerFile === token) {
      score += 80;
    }
    if (lowerBase === token) {
      score += 60;
    }
    if (lowerFile.includes(token)) {
      score += 10;
    }
  }

  if (lowerFile === "readme.md") {
    score += 40;
  }
  if (/(^|\/)(readme|agents)\.md$/iu.test(file)) {
    score += 6;
  }
  if (/(^|\/)(package\.json|cargo\.toml|pyproject\.toml)$/iu.test(file)) {
    score += 5;
  }
  if (/(^|\/)(src|app|lib|bin)\//u.test(file)) {
    score += 3;
  }

  return score;
}

function readContextFiles(cwd, files, maxBytesPerFile) {
  const context = [];

  for (const file of files) {
    const absolutePath = path.join(cwd, file);
    let content;
    try {
      content = readFileSync(absolutePath);
    } catch {
      continue;
    }

    if (content.includes(0)) {
      continue;
    }

    const text = content.toString("utf8");
    context.push({
      path: file,
      content:
        text.length > maxBytesPerFile
          ? `${text.slice(0, maxBytesPerFile)}\n\n[truncated]\n`
          : text,
    });
  }

  return context;
}

function buildPrompt({ request, files }) {
  const system = [
    "You are BeavoguiX, a local coding agent.",
    "Return only a unified diff patch that can be applied with git apply.",
    "Do not include Markdown fences, explanations, or commands.",
    "Do not propose dangerous commands.",
    "Keep edits minimal and limited to the files needed for the user request.",
  ].join("\n");

  const fileBlocks = files
    .map(({ path: filePath, content }) => `--- FILE: ${filePath}\n${content}`)
    .join("\n\n");

  const user = [
    `User request:\n${request}`,
    "",
    "Relevant project files:",
    fileBlocks || "(No readable files selected.)",
  ].join("\n");

  return { system, user };
}

async function requestPatch(prompt, options) {
  const command = process.env.BEAVOGUIX_MODEL_COMMAND;
  if (command) {
    const [program, ...args] = splitCommandLine(command);
    const result = run(program, args, {
      input: JSON.stringify({ model: options.model, ...prompt }, null, 2),
      maxBuffer: 20 * 1024 * 1024,
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || `${command} failed.`);
    }
    return result.stdout.trim();
  }

  if (options.provider === "ollama") {
    return requestOllamaPatch(prompt, options.model);
  }

  if (options.provider !== "openai") {
    throw new Error(
      `Unsupported provider: ${options.provider}. Use ollama or openai.`,
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required with --provider openai.");
  }

  const payload = JSON.stringify({
    model: options.model,
    input: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
  });

  const response = await postJson("api.openai.com", "/v1/responses", payload, {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  });

  const text = extractText(response);
  if (!text) {
    throw new Error("Model returned no patch text.");
  }
  return text.trim();
}

async function requestOllamaPatch(prompt, model) {
  const ollamaHost = process.env.OLLAMA_HOST || DEFAULT_OLLAMA_HOST;
  const payload = JSON.stringify({
    model,
    stream: false,
    messages: [
      {
        role: "system",
        content: [
          prompt.system,
          "You are a strict patch generator.",
          "If the request is a normal code or documentation edit, produce the edit.",
          "Never apologize.",
          "Never say you cannot help unless the request is unsafe.",
          "Output must be a unified diff only.",
        ].join("\n"),
      },
      { role: "user", content: prompt.user },
    ],
    options: {
      temperature: 0,
      num_ctx: 8192,
    },
  });
  const response = await postJsonUrl(
    new URL("/api/chat", ollamaHost),
    payload,
    {
      "Content-Type": "application/json",
    },
  );
  const content = response.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Ollama returned no patch text.");
  }
  return content.trim();
}

function splitCommandLine(command) {
  const parts = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/gu) || [];
  return parts.map((part) => {
    const quoted =
      (part.startsWith('"') && part.endsWith('"')) ||
      (part.startsWith("'") && part.endsWith("'"));
    return quoted ? part.slice(1, -1) : part;
  });
}

function postJsonUrl(url, payload, headers) {
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (response) => {
        readJsonResponse(response, resolve, reject);
      },
    );

    request.on("error", (error) => {
      if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
        reject(
          new Error(
            `Cannot reach Ollama at ${url.origin}. Start it with: ollama serve`,
          ),
        );
        return;
      }
      reject(error);
    });
    request.write(payload);
    request.end();
  });
}

function postJson(hostname, requestPath, payload, headers) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname,
        path: requestPath,
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (response) => {
        readJsonResponse(response, resolve, reject);
      },
    );

    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

function readJsonResponse(response, resolve, reject) {
  let body = "";
  response.setEncoding("utf8");
  response.on("data", (chunk) => {
    body += chunk;
  });
  response.on("end", () => {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      reject(new Error(`Invalid JSON response: ${body}`));
      return;
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      reject(new Error(parsed.error?.message || body));
      return;
    }

    resolve(parsed);
  });
}

function extractText(response) {
  if (typeof response.output_text === "string") {
    return response.output_text;
  }

  const chunks = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join("\n");
}

function validatePatch(patch) {
  if (!patch) {
    throw new Error("Empty patch.");
  }
  if (!looksLikePatch(patch)) {
    throw new Error("The model output does not look like a unified diff.");
  }
  if (
    /(^|\n)(diff --git a\/previous_output\.json b\/previous_output\.json|--- a\/previous_output\.json|\+\+\+ b\/previous_output\.json)/u.test(
      patch,
    )
  ) {
    throw new Error(
      "The model patched its previous output instead of the project.",
    );
  }
}

function normalizePatch(outputText) {
  const trimmed = outputText.trim();
  const fenced = trimmed.match(/```(?:diff|patch)?\s*\n([\s\S]*?)```/iu);
  if (fenced) {
    return fenced[1].trim();
  }

  const diffIndex = trimmed.search(/(^|\n)(diff --git|--- |\+\+\+ )/u);
  if (diffIndex >= 0) {
    return trimmed.slice(diffIndex).trim();
  }

  return trimmed;
}

function looksLikePatch(patch) {
  return /(^|\n)(diff --git|--- |\+\+\+ )/u.test(patch);
}

function buildStrictRetryPrompt(originalPrompt, previousOutput) {
  return {
    system: [
      "You are BeavoguiX, a local coding agent.",
      "The previous response was invalid because it was not a project patch.",
      "Answer the original user request using the original project files below.",
      "Return only a unified diff patch that can be applied with git apply.",
      "Patch real project paths only.",
      "Never patch previous_output.json or any file representing model output.",
      "Do not include Markdown fences or explanations.",
    ].join("\n"),
    user: [
      "Previous invalid model output:",
      previousOutput,
      "",
      "Original project request and files:",
      originalPrompt.user,
    ].join("\n"),
  };
}

async function askToApply() {
  const rl = readline.createInterface({ input, output });
  const answer = await new Promise((resolve) => {
    rl.question("Apply? y/N ", resolve);
  });
  rl.close();
  return answer.trim().toLowerCase() === "y";
}

function applyPatch(cwd, patch) {
  const check = run("git", ["apply", "--check", "-"], { cwd, input: patch });
  if (check.status !== 0) {
    throw new Error(check.stderr || "git apply --check failed.");
  }

  const apply = run("git", ["apply", "-"], { cwd, input: patch });
  if (apply.status !== 0) {
    throw new Error(apply.stderr || "git apply failed.");
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  if (!options.request) {
    printUsage();
    process.exitCode = 2;
    return;
  }

  console.error(`BeavoguiX: scanning ${options.cwd}`);
  const files = listProjectFiles(options.cwd);
  const selectedFiles = chooseRelevantFiles(
    files,
    options.request,
    options.maxFiles,
    options.files,
  );
  const contextFiles = readContextFiles(
    options.cwd,
    selectedFiles,
    options.maxBytesPerFile,
  );

  console.error(
    `BeavoguiX: sending ${contextFiles.length} file(s) to ${options.provider}/${options.model}`,
  );
  const prompt = buildPrompt({ request: options.request, files: contextFiles });
  let patch = normalizePatch(await requestPatch(prompt, options));
  if (!looksLikePatch(patch) && options.provider === "ollama") {
    console.error(
      "BeavoguiX: retrying because the model did not return a patch.",
    );
    patch = normalizePatch(
      await requestPatch(buildStrictRetryPrompt(prompt, patch), options),
    );
  }
  validatePatch(patch);

  console.log(patch);

  if (options.dryRun) {
    return;
  }

  if (!(await askToApply())) {
    console.error("BeavoguiX: patch not applied.");
    return;
  }

  applyPatch(options.cwd, patch);
  console.error("BeavoguiX: patch applied with git apply.");
}

main().catch((error) => {
  console.error(`BeavoguiX: ${error.message}`);
  process.exit(1);
});
