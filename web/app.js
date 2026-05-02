const statusEl = document.querySelector("#status");
const messagesEl = document.querySelector("#messages");
const form = document.querySelector("#composer");
const promptEl = document.querySelector("#prompt");
const cwdEl = document.querySelector("#cwd");
const modelEl = document.querySelector("#model");

let threadId;
let activeAssistantMessage;
let turnInProgress = false;

function setStatus(text, state = "") {
  statusEl.textContent = text;
  statusEl.className = `status ${state}`.trim();
}

function addMessage(role, text = "") {
  const el = document.createElement("article");
  el.className = `message ${role}`;
  el.textContent = text;
  messagesEl.append(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return el;
}

function appendAssistantDelta(text) {
  if (!activeAssistantMessage) {
    activeAssistantMessage = addMessage("assistant");
  }
  activeAssistantMessage.textContent += text;
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function extractDelta(params) {
  return (
    params?.delta ??
    params?.text ??
    params?.message?.delta ??
    params?.item?.delta ??
    ""
  );
}

function extractFinalText(params) {
  return params?.item?.text ?? params?.item?.message ?? params?.text ?? "";
}

function handleRpc(message) {
  const { method, params } = message;

  if (!method) {
    return;
  }

  if (method.includes("agentMessage/delta")) {
    appendAssistantDelta(extractDelta(params));
    return;
  }

  if (method === "item/completed") {
    const finalText = extractFinalText(params);
    if (finalText && !activeAssistantMessage) {
      addMessage("assistant", finalText);
    }
    return;
  }

  if (method === "turn/completed") {
    activeAssistantMessage = undefined;
    turnInProgress = false;
    form.querySelector("button").disabled = false;
    setStatus("Pret", "ready");
    return;
  }

  if (method === "turn/failed" || method === "error") {
    activeAssistantMessage = undefined;
    turnInProgress = false;
    form.querySelector("button").disabled = false;
    setStatus("Erreur", "error");
    addMessage("system", params?.message || "La requete a echoue.");
  }
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || response.statusText);
  }
  return data;
}

async function startThread() {
  if (threadId) {
    return threadId;
  }

  setStatus("Demarrage...", "");
  const result = await postJson("/api/start", {
    cwd: cwdEl.value,
    model: modelEl.value || undefined,
    personality: "pragmatic",
  });
  threadId = result.threadId ?? result.thread_id ?? result.thread?.id ?? result.id;
  setStatus("Pret", "ready");
  return threadId;
}

async function loadConfig() {
  const response = await fetch("/api/config");
  const config = await response.json();
  cwdEl.value = config.repoRoot;
}

const events = new EventSource("/events");

events.addEventListener("rpc", (event) => {
  handleRpc(JSON.parse(event.data));
});

events.addEventListener("server-exit", (event) => {
  const detail = JSON.parse(event.data);
  setStatus("Serveur arrete", "error");
  addMessage("system", `Beavoguix s'est arrete: ${detail.code ?? detail.signal}`);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = promptEl.value.trim();
  if (!text || turnInProgress) {
    return;
  }

  turnInProgress = true;
  form.querySelector("button").disabled = true;
  promptEl.value = "";
  addMessage("user", text);
  activeAssistantMessage = undefined;
  setStatus("Beavoguix travaille...", "");

  try {
    const id = await startThread();
    await postJson("/api/turn", {
      threadId: id,
      text,
      cwd: cwdEl.value,
      model: modelEl.value || undefined,
      personality: "pragmatic",
    });
  } catch (error) {
    turnInProgress = false;
    form.querySelector("button").disabled = false;
    setStatus("Erreur", "error");
    addMessage("system", error.message);
  }
});

promptEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    form.requestSubmit();
  }
});

await loadConfig();
setStatus("Pret", "ready");
addMessage("system", "Interface locale prete. Demarre une question pour ouvrir une session Beavoguix.");
