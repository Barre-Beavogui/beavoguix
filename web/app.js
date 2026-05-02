const statusEl = document.querySelector("#status");
const messagesEl = document.querySelector("#messages");
const form = document.querySelector("#composer");
const promptEl = document.querySelector("#prompt");
const attachmentsEl = document.querySelector("#attachments");
const attachEl = document.querySelector("#attach");
const attachmentListEl = document.querySelector("#attachment-list");

let threadId;
let activeAssistantMessage;
let turnInProgress = false;
let workspaceRoot = "";
let pendingFiles = [];
let uploadedFiles = [];

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
    setComposerDisabled(false);
    setStatus("Pret", "ready");
    return;
  }

  if (method === "turn/failed" || method === "error") {
    activeAssistantMessage = undefined;
    turnInProgress = false;
    setComposerDisabled(false);
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

function setComposerDisabled(disabled) {
  promptEl.disabled = disabled;
  attachEl.disabled = disabled;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

async function uploadFile(file) {
  const dataUrl = await readFileAsDataUrl(file);
  const result = await postJson("/api/upload", {
    name: file.name,
    type: file.type || "application/octet-stream",
    dataUrl,
  });
  return result.file;
}

function renderAttachments() {
  attachmentListEl.replaceChildren();

  for (const file of pendingFiles) {
    const chip = document.createElement("span");
    chip.className = "attachment-chip";
    chip.textContent = file.name;
    attachmentListEl.append(chip);
  }
}

function buildInput(text) {
  const lines = [text];
  if (uploadedFiles.length > 0) {
    lines.push("", "Documents et images ajoutes pour analyse:");
    for (const file of uploadedFiles) {
      lines.push(`- ${file.name}: ${file.path}`);
    }
  }

  const input = [
    {
      type: "text",
      text: lines.join("\n"),
      text_elements: [],
    },
  ];

  for (const file of uploadedFiles) {
    if (file.isImage) {
      input.push({ type: "localImage", path: file.path });
    }
  }

  return input;
}

async function startThread() {
  if (threadId) {
    return threadId;
  }

  setStatus("Demarrage...", "");
  const result = await postJson("/api/start", {
    cwd: workspaceRoot,
    personality: "pragmatic",
  });
  threadId = result.threadId ?? result.thread_id ?? result.thread?.id ?? result.id;
  setStatus("Pret", "ready");
  return threadId;
}

async function loadConfig() {
  const response = await fetch("/api/config");
  const config = await response.json();
  workspaceRoot = config.workspaceRoot || config.repoRoot;
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
  if ((!text && pendingFiles.length === 0) || turnInProgress) {
    return;
  }

  turnInProgress = true;
  setComposerDisabled(true);
  promptEl.value = "";
  addMessage("user", text || "Analyse les documents ajoutés.");
  activeAssistantMessage = undefined;
  setStatus(pendingFiles.length > 0 ? "Analyse des documents..." : "Beavoguix travaille...", "");

  try {
    uploadedFiles = [];
    for (const file of pendingFiles) {
      uploadedFiles.push(await uploadFile(file));
    }
    pendingFiles = [];
    renderAttachments();

    const id = await startThread();
    await postJson("/api/turn", {
      threadId: id,
      text: text || "Analyse les documents ajoutés.",
      input: buildInput(text || "Analyse les documents ajoutés."),
      cwd: workspaceRoot,
      personality: "pragmatic",
    });
    uploadedFiles = [];
  } catch (error) {
    turnInProgress = false;
    setComposerDisabled(false);
    setStatus("Erreur", "error");
    addMessage("system", error.message);
  }
});

promptEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

attachEl.addEventListener("click", () => attachmentsEl.click());

attachmentsEl.addEventListener("change", () => {
  pendingFiles = [...pendingFiles, ...attachmentsEl.files];
  attachmentsEl.value = "";
  renderAttachments();
});

await loadConfig();
setStatus("Pret", "ready");
addMessage("system", "Que veux-tu construire aujourd'hui ?");
