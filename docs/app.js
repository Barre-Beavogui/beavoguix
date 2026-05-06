const statusEl = document.querySelector("#status");
const messagesEl = document.querySelector("#messages");
const form = document.querySelector("#composer");
const promptEl = document.querySelector("#prompt");
const attachmentsEl = document.querySelector("#attachments");
const attachEl = document.querySelector("#attach");
const attachmentListEl = document.querySelector("#attachment-list");
const sendEl = document.querySelector("#send");
const newChatEl = document.querySelector("#new-chat");
const workspaceNameEl = document.querySelector("#workspace-name");
const quickPromptEls = document.querySelectorAll("[data-prompt]");
const navItemEls = document.querySelectorAll("[data-view]");
const viewPanelEls = document.querySelectorAll("[data-view-panel]");
const fileListEl = document.querySelector("#file-list");
const filePreviewEl = document.querySelector("#file-preview");
const currentDirEl = document.querySelector("#current-dir");
const folderUpEl = document.querySelector("#folder-up");
const documentsAttachEl = document.querySelector("#documents-attach");
const documentsListEl = document.querySelector("#documents-list");
const configuredApiBase =
  document
    .querySelector('meta[name="beavoguix-api-base"]')
    ?.content?.replace(/\/$/, "") || "";

let threadId;
let activeAssistantMessage;
let turnInProgress = false;
let staticMode = false;
let workspaceRoot = "";
let currentDir = ".";
let pendingFiles = [];
let uploadedFiles = [];

function apiUrl(path) {
  return `${configuredApiBase}${path}`;
}

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
  activeAssistantMessage.classList.remove("pending");
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
  const response = await fetch(apiUrl(url), {
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
  sendEl.disabled = disabled;
  documentsAttachEl.disabled = disabled;
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
  documentsListEl.replaceChildren();

  pendingFiles.forEach((file, index) => {
    const chip = document.createElement("span");
    chip.className = "attachment-chip";
    chip.textContent = `+ ${file.name}`;
    attachmentListEl.append(chip);

    const row = document.createElement("div");
    row.className = "document-row";

    const name = document.createElement("span");
    name.textContent = file.name;

    const meta = document.createElement("small");
    meta.textContent = formatBytes(file.size);

    const remove = document.createElement("button");
    remove.className = "secondary-button";
    remove.type = "button";
    remove.textContent = "Retirer";
    remove.addEventListener("click", () => {
      pendingFiles.splice(index, 1);
      renderAttachments();
    });

    row.append(name, meta, remove);
    documentsListEl.append(row);
  });

  if (pendingFiles.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Aucun document en attente.";
    documentsListEl.append(empty);
  }
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) {
    return `${bytes} o`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} Ko`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

function resetConversation() {
  threadId = undefined;
  activeAssistantMessage = undefined;
  turnInProgress = false;
  pendingFiles = [];
  uploadedFiles = [];
  renderAttachments();
  messagesEl.replaceChildren();
  setComposerDisabled(false);
  setStatus("Pret", "ready");
  addMessage("system", "Nouvelle discussion. Que veux-tu construire ?");
  promptEl.focus();
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
  threadId =
    result.threadId ?? result.thread_id ?? result.thread?.id ?? result.id;
  setStatus("Pret", "ready");
  return threadId;
}

async function loadConfig() {
  try {
    const response = await fetch(apiUrl("/api/config"));
    if (!response.ok) {
      throw new Error("Beavoguix API unavailable");
    }
    const config = await response.json();
    workspaceRoot = config.workspaceRoot || config.repoRoot;
    workspaceNameEl.textContent =
      workspaceRoot.split("/").filter(Boolean).at(-1) || workspaceRoot;
  } catch {
    staticMode = true;
    workspaceRoot = "";
    workspaceNameEl.textContent = "GitHub Pages";
    setStatus("Mode web", "error");
  }
}

async function getJson(url) {
  const response = await fetch(apiUrl(url));
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || response.statusText);
  }
  return data;
}

function switchView(view) {
  for (const item of navItemEls) {
    item.classList.toggle("active", item.dataset.view === view);
  }
  for (const panel of viewPanelEls) {
    const active = panel.dataset.viewPanel === view;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  }
  if (view === "code") {
    if (staticMode) {
      fileListEl.textContent =
        "Workspace disponible avec le serveur Beavoguix.";
      filePreviewEl.textContent =
        "GitHub Pages sert seulement les fichiers statiques. Pour explorer et modifier un depot en ligne, il faut connecter cette page a un backend Beavoguix deploye.";
    } else {
      loadWorkspaceFiles(currentDir);
    }
  }
}

function parentDir(dir) {
  if (!dir || dir === ".") {
    return ".";
  }
  const parts = dir.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/") || ".";
}

async function loadWorkspaceFiles(dir = ".") {
  currentDir = dir;
  currentDirEl.textContent = dir;
  folderUpEl.disabled = dir === ".";
  fileListEl.textContent = "Chargement...";

  try {
    const result = await getJson(`/api/files?dir=${encodeURIComponent(dir)}`);
    fileListEl.replaceChildren();

    if (result.entries.length === 0) {
      fileListEl.textContent = "Dossier vide.";
      return;
    }

    for (const entry of result.entries) {
      const row = document.createElement("button");
      row.className = "file-row";
      row.type = "button";
      row.dataset.path = entry.path;

      const icon = document.createElement("span");
      icon.className = "file-icon";
      icon.textContent = entry.type === "directory" ? "/" : ".";

      const name = document.createElement("span");
      name.className = "file-name";
      name.textContent = entry.name;

      row.append(icon, name);
      row.addEventListener("click", () => {
        if (entry.type === "directory") {
          loadWorkspaceFiles(entry.path);
        } else {
          previewWorkspaceFile(entry.path, row);
        }
      });
      fileListEl.append(row);
    }
  } catch (error) {
    fileListEl.textContent = error.message;
  }
}

async function previewWorkspaceFile(filePath, selectedRow) {
  for (const row of fileListEl.querySelectorAll(".file-row")) {
    row.classList.toggle("active", row === selectedRow);
  }
  filePreviewEl.textContent = "Chargement...";

  try {
    const result = await getJson(
      `/api/file?path=${encodeURIComponent(filePath)}`,
    );
    filePreviewEl.textContent = result.text || "(fichier vide)";
  } catch (error) {
    filePreviewEl.textContent = error.message;
  }
}

let events;

if (
  configuredApiBase ||
  location.hostname === "127.0.0.1" ||
  location.hostname === "localhost"
) {
  events = new EventSource(apiUrl("/events"));
}

events?.addEventListener("rpc", (event) => {
  handleRpc(JSON.parse(event.data));
});

events?.addEventListener("server-exit", (event) => {
  const detail = JSON.parse(event.data);
  setStatus("Serveur arrete", "error");
  addMessage(
    "system",
    `Beavoguix s'est arrete: ${detail.code ?? detail.signal}`,
  );
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = promptEl.value.trim();
  if ((!text && pendingFiles.length === 0) || turnInProgress) {
    return;
  }

  if (staticMode) {
    addMessage("user", text || "Analyse les documents ajoutés.");
    addMessage(
      "system",
      "Cette page GitHub Pages affiche l'interface Beavoguix, mais elle n'a pas de serveur agent connecte. Deploie web/server.mjs sur un serveur Node, puis configure beavoguix-api-base pour echanger et travailler en ligne.",
    );
    return;
  }

  turnInProgress = true;
  setComposerDisabled(true);
  promptEl.value = "";
  addMessage("user", text || "Analyse les documents ajoutés.");
  activeAssistantMessage = addMessage("assistant");
  activeAssistantMessage.classList.add("pending");
  setStatus(
    pendingFiles.length > 0
      ? "Analyse des documents..."
      : "Beavoguix travaille...",
    "",
  );

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
    if (activeAssistantMessage && !activeAssistantMessage.textContent) {
      activeAssistantMessage.remove();
    }
    activeAssistantMessage = undefined;
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

newChatEl.addEventListener("click", resetConversation);
documentsAttachEl.addEventListener("click", () => attachmentsEl.click());
folderUpEl.addEventListener("click", () =>
  loadWorkspaceFiles(parentDir(currentDir)),
);

for (const item of navItemEls) {
  item.addEventListener("click", () => switchView(item.dataset.view));
}

for (const promptButton of quickPromptEls) {
  promptButton.addEventListener("click", () => {
    promptEl.value = promptButton.dataset.prompt || "";
    switchView("chat");
    promptEl.focus();
  });
}

attachmentsEl.addEventListener("change", () => {
  pendingFiles = [...pendingFiles, ...attachmentsEl.files];
  attachmentsEl.value = "";
  renderAttachments();
});

await loadConfig();
if (!staticMode) {
  setStatus("Pret", "ready");
}
addMessage(
  "system",
  staticMode
    ? "Interface Beavoguix chargee sur GitHub Pages. Connecte un backend Beavoguix pour activer les conversations et le workspace en ligne."
    : "Que veux-tu construire aujourd'hui ?",
);
filePreviewEl.textContent = "Selectionne un fichier pour l'afficher ici.";
renderAttachments();
