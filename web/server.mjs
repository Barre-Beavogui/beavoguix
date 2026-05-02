import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const port = Number.parseInt(process.env.BEAVOGUIX_WEB_PORT || "8787", 10);

const staticTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

let appServer;
let initialized;
let nextId = 1;
let stdoutBuffer = "";
const pending = new Map();
const clients = new Set();

function findBeavoguixBinary() {
  const configured = process.env.BEAVOGUIX_BIN;
  if (configured) {
    return configured;
  }

  const candidates = [
    path.join(repoRoot, "codex-rs", "target", "debug", "beavoguix"),
    path.join(repoRoot, "bin", "beavoguix"),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? "beavoguix";
}

function startAppServer() {
  if (appServer) {
    return appServer;
  }

  const binary = findBeavoguixBinary();
  appServer = spawn(binary, ["app-server", "--listen", "stdio://"], {
    cwd: repoRoot,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  appServer.stdout.setEncoding("utf8");
  appServer.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    let newline = stdoutBuffer.indexOf("\n");
    while (newline !== -1) {
      const line = stdoutBuffer.slice(0, newline).trim();
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (line) {
        handleRpcLine(line);
      }
      newline = stdoutBuffer.indexOf("\n");
    }
  });

  appServer.stderr.setEncoding("utf8");
  appServer.stderr.on("data", (chunk) => {
    broadcast("log", { stream: "stderr", text: chunk });
  });

  appServer.on("exit", (code, signal) => {
    appServer = undefined;
    initialized = undefined;
    for (const { reject } of pending.values()) {
      reject(new Error(`Beavoguix app-server exited (${code ?? signal})`));
    }
    pending.clear();
    broadcast("server-exit", { code, signal });
  });

  return appServer;
}

function handleRpcLine(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    broadcast("log", { stream: "stdout", text: line, parseError: error.message });
    return;
  }

  if (message.id !== undefined && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      reject(new Error(message.error.message || JSON.stringify(message.error)));
    } else {
      resolve(message.result);
    }
    return;
  }

  broadcast("rpc", message);
}

function sendRequest(method, params = {}) {
  const child = startAppServer();
  const id = nextId++;
  const payload = { id, method, params };

  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
      if (error) {
        pending.delete(id);
        reject(error);
      }
    });
  });
}

function sendNotification(method, params = {}) {
  const child = startAppServer();
  child.stdin.write(`${JSON.stringify({ method, params })}\n`);
}

async function ensureInitialized() {
  if (!initialized) {
    initialized = sendRequest("initialize", {
      clientInfo: {
        name: "beavoguix_web",
        title: "Beavoguix Web",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    }).then((result) => {
      sendNotification("initialized", {});
      return result;
    });
  }

  return initialized;
}

function broadcast(event, data) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    client.write(message);
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.resolve(__dirname, `.${pathname}`);

  if (!filePath.startsWith(__dirname) || !existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const type = staticTypes.get(path.extname(filePath)) || "application/octet-stream";
  res.writeHead(200, { "content-type": type });
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      res.write(": connected\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    if (req.method === "GET" && req.url === "/api/health") {
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && req.url === "/api/config") {
      const packageJson = await readFile(path.join(repoRoot, "package.json"), "utf8");
      json(res, 200, { repoRoot, package: JSON.parse(packageJson).name });
      return;
    }

    if (req.method === "POST" && req.url === "/api/start") {
      const body = await readJson(req);
      await ensureInitialized();
      const result = await sendRequest("thread/start", {
        cwd: body.cwd || repoRoot,
        model: body.model || undefined,
        personality: body.personality || undefined,
      });
      json(res, 200, result);
      return;
    }

    if (req.method === "POST" && req.url === "/api/turn") {
      const body = await readJson(req);
      if (!body.threadId || !body.text) {
        json(res, 400, { error: "threadId and text are required" });
        return;
      }

      await ensureInitialized();
      const result = await sendRequest("turn/start", {
        threadId: body.threadId,
        input: [
          {
            type: "text",
            text: body.text,
            text_elements: [],
          },
        ],
        cwd: body.cwd || repoRoot,
        model: body.model || undefined,
        personality: body.personality || undefined,
      });
      json(res, 200, result);
      return;
    }

    if (req.method === "GET") {
      await serveStatic(req, res);
      return;
    }

    json(res, 405, { error: "Method not allowed" });
  } catch (error) {
    json(res, 500, { error: error.message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Beavoguix Web listening on http://127.0.0.1:${port}`);
});
