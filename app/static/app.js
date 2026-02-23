const state = {
  projects: [],
  view: "discovery",
  mode: "grid",
  search: "",
  sort: "updated",
  deliverableFilter: "all",
  statusFilter: "all",
  currentProject: null,
  detailDraft: null,
  error: "",
  projectStructures: {},
  projectUi: null,
};

const suggestedTags = ["urgent", "client", "internal", "research", "creative", "delivery"];
const deliverableTypes = ["image", "image set", "video", "software", "guide", "design", "product", "custom"];

const app = document.getElementById("app");

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function loadProjects() {
  const res = await fetch("/api/projects");
  const data = await res.json();
  state.projects = data.projects || [];
}

function filteredProjects() {
  let items = [...state.projects];
  if (state.search.trim()) {
    const needle = state.search.trim().toLowerCase();
    items = items.filter((p) =>
      [p.project_name, p.description, ...(p.tags || [])].join(" ").toLowerCase().includes(needle)
    );
  }
  if (state.deliverableFilter !== "all") {
    items = items.filter((p) => p.deliverable_type === state.deliverableFilter);
  }
  if (state.statusFilter !== "all") {
    items = items.filter((p) => p.status === state.statusFilter);
  }
  items.sort((a, b) => {
    if (state.sort === "name") return a.project_name.localeCompare(b.project_name);
    return (b.updated_at || "").localeCompare(a.updated_at || "");
  });
  return items;
}


function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `node-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function ensureProjectUiState() {
  if (!state.projectUi) {
    state.projectUi = { sidebarWidth: 340, sidebarCollapsed: false, collapsedNodes: {}, selectedNodeId: "", editorOpen: false };
  }
}

function ensureStructureLoaded() {
  if (!state.currentProject) return;
  if (!state.projectStructures) state.projectStructures = {};
  if (!state.projectStructures[state.currentProject.slug]) {
    state.projectStructures[state.currentProject.slug] = { nodes: [] };
  }
}

async function loadProjectStructure(slug) {
  const res = await fetch(`/api/project-structure?slug=${encodeURIComponent(slug)}`);
  if (!res.ok) return;
  const data = await res.json();
  if (!state.projectStructures) state.projectStructures = {};
  state.projectStructures[slug] = { nodes: Array.isArray(data.nodes) ? data.nodes : [] };
}

async function persistProjectStructure() {
  if (!state.currentProject) return;
  ensureStructureLoaded();
  await fetch(`/api/project-structure?slug=${encodeURIComponent(state.currentProject.slug)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state.projectStructures[state.currentProject.slug]),
  });
}

function flattenNodes(nodes, depth = 0, parentPath = []) {
  const rows = [];
  for (const node of nodes || []) {
    const path = [...parentPath, node.name || "Untitled"];
    rows.push({ node, depth, path });
    if (Array.isArray(node.children) && node.children.length) {
      rows.push(...flattenNodes(node.children, depth + 1, path));
    }
  }
  return rows;
}

function findNodeAndParent(nodes, nodeId, parent = null) {
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node.id === nodeId) return { node, parent, index: i, siblings: nodes };
    if (node.children?.length) {
      const found = findNodeAndParent(node.children, nodeId, node);
      if (found) return found;
    }
  }
  return null;
}

function duplicateNodeTree(node) {
  const copy = structuredClone(node);
  const visit = (item, parentId = null) => {
    item.id = uid();
    item.parent_id = parentId;
    item.children = item.children || [];
    for (const child of item.children) visit(child, item.id);
  };
  visit(copy, copy.parent_id || null);
  return copy;
}

function nextDuplicateName(name, siblingNames) {
  const base = name.replace(/\s#\d+$/, "");
  let n = 1;
  while (siblingNames.has(`${base} #${n}`)) n += 1;
  return `${base} #${n}`;
}

function getNodeDisplayType(node) {
  if (!node) return "";
  const normalizedNodeType = typeof node.node_type === "string" ? node.node_type.trim().toLowerCase() : "";
  if (normalizedNodeType === "component") {
    const componentType = typeof node.component_type === "string" ? node.component_type.trim().toLowerCase() : "";
    return componentType || "text";
  }
  if (normalizedNodeType === "video") {
    return "video";
  }
  return normalizedNodeType;
}

function ensureTextHistory(node) {
  if (!Array.isArray(node.content_history)) {
    const fallbackText = typeof node.content === "string" ? node.content : "";
    node.content_history = [{ edited_at: new Date().toISOString(), text: fallbackText }];
  }
  if (!node.content_history.length) {
    node.content_history.push({ edited_at: new Date().toISOString(), text: "" });
  }
  return node.content_history;
}

function formatEditedDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function getNodeToolState(node) {
  ensureProjectUiState();
  if (!state.projectUi.toolState) state.projectUi.toolState = {};
  if (!state.projectUi.toolState[node.id]) state.projectUi.toolState[node.id] = {};
  return state.projectUi.toolState[node.id];
}

const imageSetTypes = ["collection", "choice best", "choice group"];

function ensureImageSetState(node) {
  if (!Array.isArray(node.image_set_images)) node.image_set_images = [];
  if (!imageSetTypes.includes(node.image_set_type)) node.image_set_type = "collection";
  node.image_set_images = node.image_set_images.map((item, index) => ({
    id: item?.id || uid(),
    name: item?.name || `Image ${index + 1}`,
    file_path: item?.file_path || "",
    image_url: item?.image_url || "",
    rating: Math.max(0, Math.min(10, Number(item?.rating) || 0)),
    notes: item?.notes || "",
    state: item?.state === "excluded" ? "excluded" : item?.state === "included" ? "included" : "pending",
  }));
  if (typeof node.image_set_selected_index !== "number") node.image_set_selected_index = node.image_set_images.length ? 0 : -1;
  node.image_set_selected_index = Math.max(-1, Math.min(node.image_set_selected_index, node.image_set_images.length - 1));
  return node.image_set_images;
}

function imageSetDisplayUrl(image) {
  if (!image) return "";
  if (image.image_url) return image.image_url;
  if (!image.file_path) return "";
  return `/assets/${encodeURIComponent(state.currentProject.slug)}/${image.file_path}`;
}

function normalizeVideoUrl(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function getVideoEmbedUrl(videoUrl) {
  if (!videoUrl) return "";
  try {
    const parsed = new URL(videoUrl);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0];
      return id ? `https://www.youtube.com/embed/${id}` : "";
    }
    if (host === "youtube.com") {
      const id = parsed.searchParams.get("v");
      if (id) return `https://www.youtube.com/embed/${id}`;
      if (parsed.pathname.startsWith("/embed/")) return parsed.toString();
      if (parsed.pathname.startsWith("/shorts/")) {
        const shortId = parsed.pathname.split("/").filter(Boolean)[1];
        return shortId ? `https://www.youtube.com/embed/${shortId}` : "";
      }
    }
    if (/(\.mp4|\.webm|\.ogg)(\?|#|$)/i.test(parsed.pathname)) {
      return parsed.toString();
    }
  } catch {
    return "";
  }
  return "";
}

function updateImageSetStatus(node) {
  const images = ensureImageSetState(node);
  if (!images.length) {
    node.status = "new";
    return;
  }
  if (node.image_set_type === "collection") {
    node.status = "done";
    return;
  }
  if (node.image_set_type === "choice best") {
    node.status = node.image_set_primary_id ? "done" : "started";
    return;
  }
  const allTagged = images.every((item) => item.state === "included" || item.state === "excluded");
  node.status = allTagged ? "done" : "started";
}

function buildImageSetChildNode(parentNode, name, images) {
  return {
    id: uid(),
    parent_id: parentNode.id,
    name,
    description: "",
    node_type: "component",
    component_type: "image set",
    choice_between_components: false,
    status: "done",
    lock_subnodes: true,
    notes: "",
    discussion: [],
    children: [],
    image_set_type: "collection",
    image_set_images: structuredClone(images),
    image_set_primary_id: "",
    image_set_selected_index: images.length ? 0 : -1,
  };
}

function ensureUnusedImagesChildNode(node, images) {
  if (!images.length) return;
  node.children = node.children || [];
  const existing = node.children.find((child) => child.name === "unused images" && child.component_type === "image set");
  if (existing) {
    ensureImageSetState(existing);
    existing.image_set_type = "collection";
    existing.image_set_images = structuredClone(images);
    existing.image_set_selected_index = images.length ? 0 : -1;
    existing.status = "done";
    existing.lock_subnodes = true;
    return;
  }
  node.children.push(buildImageSetChildNode(node, "unused images", images));
}

function finalizeChoiceBestNode(node) {
  const images = ensureImageSetState(node);
  const selected = images.find((item) => item.id === node.image_set_primary_id);
  if (!selected) return;
  const unused = images.filter((item) => item.id !== selected.id);
  ensureUnusedImagesChildNode(node, unused);
  node.component_type = "image";
  node.file_path = selected.file_path || "";
  node.image_url = selected.image_url || "";
  node.image_notes = selected.notes || "";
  node.status = "done";
  node.lock_subnodes = true;
}

function finalizeChoiceGroupNode(node) {
  const images = ensureImageSetState(node);
  const included = images.filter((item) => item.state === "included");
  const excluded = images.filter((item) => item.state === "excluded");
  ensureUnusedImagesChildNode(node, excluded);
  node.image_set_type = "collection";
  node.image_set_images = included;
  node.image_set_selected_index = included.length ? 0 : -1;
  node.status = "done";
  node.lock_subnodes = true;
}

function renderNodeTool(node) {
  if (!node) return "<div class=\"tool-empty\">Select a node to begin.</div>";
  const type = getNodeDisplayType(node);
  if (type === "text") {
    const history = ensureTextHistory(node);
    const toolState = getNodeToolState(node);
    if (typeof toolState.historyIndex !== "number") toolState.historyIndex = history.length - 1;
    toolState.historyIndex = Math.max(0, Math.min(toolState.historyIndex, history.length - 1));
    const atLatest = toolState.historyIndex === history.length - 1;
    if (typeof toolState.draft !== "string") toolState.draft = history[history.length - 1].text || "";
    const viewText = atLatest ? toolState.draft : history[toolState.historyIndex].text || "";
    const latest = history[history.length - 1];
    const changed = toolState.draft !== (latest.text || "");
    return `<div class="node-tool text-tool">
      <textarea id="text-tool-content" class="text-tool-content" ${atLatest ? "" : "disabled"}>${escapeHtml(viewText)}</textarea>
      <div class="text-tool-actions">
        <button class="btn btn-primary" id="text-tool-save" ${changed && atLatest ? "" : "disabled"}>Save</button>
        <button class="btn btn-muted" id="text-tool-revert" ${changed && atLatest ? "" : "disabled"}>Revert</button>
        <button class="btn btn-muted" id="text-tool-prev" ${toolState.historyIndex > 0 ? "" : "disabled"}>Show Previous</button>
        <button class="btn btn-muted" id="text-tool-next" ${atLatest ? "disabled" : ""}>Show Next</button>
        <span class="last-edited">Last edited: ${escapeHtml(formatEditedDate(latest.edited_at))}</span>
      </div>
    </div>`;
  }
  if (type === "image") {
    const imagePath = node.image_url || (node.file_path ? `/assets/${encodeURIComponent(state.currentProject.slug)}/${node.file_path}` : "");
    const hasImage = !!imagePath;
    return `<div class="node-tool image-tool">
      <div class="image-preview-wrap">${hasImage ? `<img class="image-preview" src="${imagePath}" alt="Node image" />` : "<div class=\"image-placeholder\">No image selected</div>"}</div>
      <div class="image-tool-meta">
        <textarea id="image-tool-notes" rows="3" placeholder="Notes for selected image" ${hasImage ? "" : "disabled"}>${escapeHtml(node.image_notes || "")}</textarea>
      </div>
      <div class="image-tool-actions">
        <button class="btn btn-primary" id="image-tool-upload">Upload</button>
        <input id="image-tool-file" type="file" accept="image/*" class="hidden" />
      </div>
    </div>`;
  }
  if (type === "image set") {
    const images = ensureImageSetState(node);
    const toolState = getNodeToolState(node);
    if (typeof toolState.showIncluded !== "boolean") toolState.showIncluded = false;
    if (typeof toolState.showExcluded !== "boolean") toolState.showExcluded = false;
    const visibleStates = [];
    if (toolState.showIncluded) visibleStates.push("included");
    if (toolState.showExcluded) visibleStates.push("excluded");
    const visibleImages =
      node.image_set_type === "choice group"
        ? images.filter((item) => item.state === "pending" || visibleStates.includes(item.state))
        : images;
    const selectedImage =
      node.image_set_selected_index >= 0 && node.image_set_selected_index < images.length ? images[node.image_set_selected_index] : null;
    const selectedVisible = !!selectedImage && visibleImages.includes(selectedImage);
    const displayImage = selectedVisible ? selectedImage : visibleImages[0] || null;
    const imagePath = imageSetDisplayUrl(displayImage);
    const hasImage = !!imagePath;
    const listHtml = visibleImages
      .map((item, idx) => {
        const sourceIndex = images.findIndex((candidate) => candidate.id === item.id);
        return `<button class="image-set-item ${sourceIndex === node.image_set_selected_index ? "selected" : ""}" data-image-set-select="${sourceIndex}">${escapeHtml(item.name || `Image ${idx + 1}`)} <span class="image-set-state">${escapeHtml(item.state)}</span></button>`;
      })
      .join("");
    const stars = Array.from({ length: 10 }, (_, i) => {
      const value = i + 1;
      const on = displayImage && displayImage.rating >= value;
      return `<button class="image-set-star ${on ? "on" : ""}" data-image-set-rate="${value}" ${displayImage ? "" : "disabled"}>★</button>`;
    }).join("");
    const showControls =
      node.image_set_type === "choice group"
        ? `<span class="image-set-show-label">Show</span><label class="image-set-filter"><input type="checkbox" id="image-set-show-included" ${toolState.showIncluded ? "checked" : ""}/>included</label><label class="image-set-filter"><input type="checkbox" id="image-set-show-excluded" ${toolState.showExcluded ? "checked" : ""}/>excluded</label>`
        : "";
    const modeButtons =
      node.image_set_type === "choice best"
        ? `<button class="btn btn-primary" id="image-set-best" ${displayImage ? "" : "disabled"}>Choose As Best</button>`
        : node.image_set_type === "choice group"
        ? `<button class="btn btn-primary" id="image-set-include" ${displayImage ? "" : "disabled"}>Include Image</button><button class="btn btn-muted" id="image-set-exclude" ${displayImage ? "" : "disabled"}>Exclude Image</button>`
        : "";
    const previewStateClass = displayImage?.state === "included" ? "image-preview-wrap state-included" : displayImage?.state === "excluded" ? "image-preview-wrap state-excluded" : "image-preview-wrap";
    return `<div class="node-tool image-tool image-set-tool">
      <div class="image-set-nav"><button class="btn btn-muted" id="image-set-prev" ${visibleImages.length ? "" : "disabled"}>Previous</button><button class="btn btn-muted" id="image-set-next" ${visibleImages.length ? "" : "disabled"}>Next</button>${showControls}</div>
      <div class="${previewStateClass}">${hasImage ? `<img class="image-preview" src="${imagePath}" alt="Image set selection" />` : "<div class=\"image-placeholder\">No image selected</div>"}</div>
      <div class="image-set-meta">
        <div class="image-set-rating-wrap"><div class="image-set-rating">${stars}</div>${modeButtons}</div>
        <textarea id="image-set-notes" rows="3" placeholder="Notes for selected image" ${displayImage ? "" : "disabled"}>${escapeHtml(displayImage?.notes || "")}</textarea>
      </div>
      <div class="image-tool-actions">
        <button class="btn btn-primary" id="image-set-upload">Upload</button>
        <button class="btn btn-muted" id="image-set-remove" ${displayImage ? "" : "disabled"}>Remove Selected</button>
        <input id="image-set-file" type="file" accept="image/*" multiple class="hidden" />
      </div>
      <div class="image-set-list">${listHtml || '<div class="image-placeholder">No images to show</div>'}</div>
    </div>`;
  }
  if (type === "video") {
    const videoUrl = normalizeVideoUrl(node.video_url || "");
    const hasVideo = !!videoUrl;
    const toolState = getNodeToolState(node);
    if (typeof toolState.videoEmbedExpanded !== "boolean") toolState.videoEmbedExpanded = true;
    const embedUrl = hasVideo ? getVideoEmbedUrl(videoUrl) : "";
    const canEmbed = !!embedUrl;
    const embedKey = Number(toolState.videoEmbedKey) || 0;
    const isDirectVideo = /\.(mp4|webm|ogg)(\?|#|$)/i.test(embedUrl || "");
    const embedPanel = !canEmbed
      ? '<div class="image-placeholder">Embedding is not available for this link.</div>'
      : !toolState.videoEmbedExpanded
      ? '<div class="image-placeholder">Embedded player is collapsed.</div>'
      : isDirectVideo
      ? `<video class="video-tool-embed" controls src="${embedUrl}" data-embed-key="${embedKey}"></video>`
      : `<iframe class="video-tool-embed" src="${embedUrl}" title="Embedded video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen data-embed-key="${embedKey}"></iframe>`;
    return `<div class="node-tool video-tool">
      ${hasVideo
        ? `<div class="video-tool-link-row"><a href="${videoUrl}" target="_blank" rel="noopener noreferrer" class="video-tool-link">${escapeHtml(videoUrl)}</a><button class="btn btn-muted" id="video-tool-copy">Copy Link</button></div>
      <div class="video-tool-embed-wrap"><div class="video-tool-embed-header"><button class="btn btn-muted" id="video-tool-toggle-embed">${toolState.videoEmbedExpanded ? "−" : "+"}</button><span>${toolState.videoEmbedExpanded ? "Hide" : "Show"} embedded video</span></div><div class="video-tool-player">${embedPanel}</div></div>
      <textarea id="video-tool-notes" rows="3" placeholder="Add notes for this video">${escapeHtml(node.video_notes || "")}</textarea>`
        : `<div class="video-tool-set-row"><input id="video-tool-url" type="url" placeholder="https://example.com/video.mp4" value="${escapeHtml(node.video_url || "")}" /><button class="btn btn-primary" id="video-tool-set">Set</button></div><div class="image-placeholder">Paste a video URL and press Enter or click Set.</div>`}
    </div>`;
  }
  return `<div class="node-tool unsupported-tool">Node Type ${escapeHtml(type || "unknown")} not yet supported</div>`;
}

function bindNodeToolEvents(node) {
  if (!node) return;
  const type = getNodeDisplayType(node);
  if (type === "text") {
    const toolState = getNodeToolState(node);
    const area = document.getElementById("text-tool-content");
    const syncTextToolActions = () => {
      const history = ensureTextHistory(node);
      const latest = history[history.length - 1];
      const changed = toolState.draft !== (latest.text || "");
      const atLatest = toolState.historyIndex === history.length - 1;
      const saveBtn = document.getElementById("text-tool-save");
      const revertBtn = document.getElementById("text-tool-revert");
      if (saveBtn) saveBtn.disabled = !(changed && atLatest);
      if (revertBtn) revertBtn.disabled = !(changed && atLatest);
    };
    if (area) {
      area.oninput = () => {
        toolState.draft = area.value;
        syncTextToolActions();
      };
    }
    const saveBtn = document.getElementById("text-tool-save");
    if (saveBtn) saveBtn.onclick = async () => {
      const history = ensureTextHistory(node);
      const latest = history[history.length - 1];
      if (toolState.draft === (latest.text || "")) return;
      history.push({ edited_at: new Date().toISOString(), text: toolState.draft || "" });
      toolState.historyIndex = history.length - 1;
      await persistProjectStructure();
      renderProjectPage();
    };
    const revertBtn = document.getElementById("text-tool-revert");
    if (revertBtn) revertBtn.onclick = () => {
      if (!window.confirm("Discard unsaved changes and revert to the latest saved version?")) return;
      const history = ensureTextHistory(node);
      toolState.historyIndex = history.length - 1;
      toolState.draft = history[history.length - 1].text || "";
      renderProjectPage();
    };
    const prevBtn = document.getElementById("text-tool-prev");
    if (prevBtn) prevBtn.onclick = () => {
      const history = ensureTextHistory(node);
      toolState.historyIndex = Math.max(0, (toolState.historyIndex ?? history.length - 1) - 1);
      renderProjectPage();
    };
    const nextBtn = document.getElementById("text-tool-next");
    if (nextBtn) nextBtn.onclick = () => {
      const history = ensureTextHistory(node);
      toolState.historyIndex = Math.min(history.length - 1, (toolState.historyIndex ?? history.length - 1) + 1);
      if (toolState.historyIndex === history.length - 1) toolState.draft = history[history.length - 1].text || "";
      renderProjectPage();
    };
    syncTextToolActions();
    return;
  }
  if (type === "image") {
    const uploadBtn = document.getElementById("image-tool-upload");
    const input = document.getElementById("image-tool-file");
    const notes = document.getElementById("image-tool-notes");
    if (notes) {
      const commit = async () => {
        if ((node.image_notes || "") === notes.value) return;
        node.image_notes = notes.value;
        await persistProjectStructure();
        renderProjectPage();
      };
      notes.onblur = commit;
      notes.onkeydown = async (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          await commit();
        }
      };
    }
    if (!uploadBtn || !input) return;
    uploadBtn.onclick = () => input.click();
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/project-node-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: state.currentProject.slug, node_id: node.id, filename: file.name, data_url: dataUrl }),
      });
      if (!res.ok) {
        alert("Unable to upload image.");
        return;
      }
      const payload = await res.json();
      node.file_path = payload.file_path;
      node.image_url = payload.asset_url || "";
      node.status = "done";
      node.lock_subnodes = true;
      await persistProjectStructure();
      renderProjectPage();
    };
  }
  if (type === "image set") {
    const images = ensureImageSetState(node);
    const toolState = getNodeToolState(node);
    if (typeof toolState.showIncluded !== "boolean") toolState.showIncluded = false;
    if (typeof toolState.showExcluded !== "boolean") toolState.showExcluded = false;
    const visibleImages = () =>
      node.image_set_type === "choice group"
        ? images.filter(
            (item) =>
              item.state === "pending" ||
              (item.state === "included" && toolState.showIncluded) ||
              (item.state === "excluded" && toolState.showExcluded)
          )
        : images;
    const setSelection = (index) => {
      node.image_set_selected_index = Math.max(-1, Math.min(index, images.length - 1));
    };
    const moveToNextVisible = (step = 1) => {
      const shown = visibleImages();
      if (!shown.length) {
        node.image_set_selected_index = -1;
        return;
      }
      const currentId = images[node.image_set_selected_index]?.id;
      const currentShownIndex = shown.findIndex((item) => item.id === currentId);
      const base = currentShownIndex >= 0 ? currentShownIndex : -1;
      const nextIdx = (base + step + shown.length) % shown.length;
      const next = shown[nextIdx];
      setSelection(images.findIndex((item) => item.id === next.id));
    };
    const maybeFinalizeChoiceGroup = () => {
      if (node.image_set_type !== "choice group") return;
      const allTagged = images.length > 0 && images.every((item) => item.state === "included" || item.state === "excluded");
      if (!allTagged) return;
      finalizeChoiceGroupNode(node);
    };
    const saveAndRender = async () => {
      maybeFinalizeChoiceGroup();
      if (node.component_type === "image set") updateImageSetStatus(node);
      await persistProjectStructure();
      renderProjectPage();
    };
    const selectedImage =
      node.image_set_selected_index >= 0 && node.image_set_selected_index < images.length ? images[node.image_set_selected_index] : null;

    const uploadBtn = document.getElementById("image-set-upload");
    const removeBtn = document.getElementById("image-set-remove");
    const input = document.getElementById("image-set-file");
    const nextBtn = document.getElementById("image-set-next");
    const prevBtn = document.getElementById("image-set-prev");
    const notes = document.getElementById("image-set-notes");
    const showIncluded = document.getElementById("image-set-show-included");
    const showExcluded = document.getElementById("image-set-show-excluded");

    for (const el of document.querySelectorAll("[data-image-set-select]")) {
      el.onclick = () => {
        setSelection(Number(el.dataset.imageSetSelect));
        renderProjectPage();
      };
    }

    if (prevBtn) prevBtn.onclick = () => {
      moveToNextVisible(-1);
      renderProjectPage();
    };
    if (nextBtn) nextBtn.onclick = () => {
      moveToNextVisible(1);
      renderProjectPage();
    };

    if (showIncluded) showIncluded.onchange = () => {
      toolState.showIncluded = showIncluded.checked;
      if (node.image_set_type === "choice group" && !visibleImages().some((item) => item.id === images[node.image_set_selected_index]?.id)) {
        moveToNextVisible(1);
      }
      renderProjectPage();
    };
    if (showExcluded) showExcluded.onchange = () => {
      toolState.showExcluded = showExcluded.checked;
      if (node.image_set_type === "choice group" && !visibleImages().some((item) => item.id === images[node.image_set_selected_index]?.id)) {
        moveToNextVisible(1);
      }
      renderProjectPage();
    };

    if (uploadBtn && input) {
      uploadBtn.onclick = () => input.click();
      input.onchange = async () => {
        const files = Array.from(input.files || []);
        if (!files.length) return;
        for (const file of files) {
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error("Failed to read file"));
            reader.readAsDataURL(file);
          });
          const imageId = uid();
          const res = await fetch("/api/project-node-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slug: state.currentProject.slug, node_id: `${node.id}-${imageId}`, filename: file.name, data_url: dataUrl }),
          });
          if (!res.ok) continue;
          const payload = await res.json();
          images.push({ id: imageId, name: file.name, file_path: payload.file_path, image_url: payload.asset_url || "", rating: 0, notes: "", state: "pending" });
        }
        if (node.image_set_selected_index < 0 && images.length) node.image_set_selected_index = 0;
        input.value = "";
        await saveAndRender();
      };
    }

    if (removeBtn) removeBtn.onclick = async () => {
      if (node.image_set_selected_index < 0) return;
      images.splice(node.image_set_selected_index, 1);
      if (!images.length) node.image_set_selected_index = -1;
      else moveToNextVisible(1);
      await saveAndRender();
    };

    for (const star of document.querySelectorAll("[data-image-set-rate]")) {
      star.onclick = async () => {
        const selected = images[node.image_set_selected_index];
        if (!selected) return;
        selected.rating = Number(star.dataset.imageSetRate) || 0;
        await saveAndRender();
      };
    }

    if (notes) {
      const commit = async () => {
        const selected = images[node.image_set_selected_index];
        if (!selected) return;
        if (selected.notes === notes.value) return;
        selected.notes = notes.value;
        await saveAndRender();
      };
      notes.onblur = commit;
      notes.onkeydown = async (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          await commit();
        }
      };
    }

    const bestBtn = document.getElementById("image-set-best");
    if (bestBtn) bestBtn.onclick = async () => {
      const selected = selectedImage;
      if (!selected) return;
      node.image_set_primary_id = selected.id;
      finalizeChoiceBestNode(node);
      await persistProjectStructure();
      renderProjectPage();
    };

    const includeBtn = document.getElementById("image-set-include");
    const excludeBtn = document.getElementById("image-set-exclude");
    if (includeBtn) includeBtn.onclick = async () => {
      const selected = images[node.image_set_selected_index];
      if (!selected) return;
      selected.state = selected.state === "included" ? "pending" : "included";
      if (node.image_set_type === "choice group") moveToNextVisible(1);
      await saveAndRender();
    };
    if (excludeBtn) excludeBtn.onclick = async () => {
      const selected = images[node.image_set_selected_index];
      if (!selected) return;
      selected.state = selected.state === "excluded" ? "pending" : "excluded";
      if (node.image_set_type === "choice group") moveToNextVisible(1);
      await saveAndRender();
    };

    return;
  }
  if (type === "video") {
    const urlInput = document.getElementById("video-tool-url");
    const setBtn = document.getElementById("video-tool-set");
    const copyBtn = document.getElementById("video-tool-copy");
    const toggleEmbedBtn = document.getElementById("video-tool-toggle-embed");
    const notes = document.getElementById("video-tool-notes");
    const toolState = getNodeToolState(node);

    const setVideo = async () => {
      if (!urlInput) return;
      const normalized = normalizeVideoUrl(urlInput.value);
      if (!normalized) {
        alert("Please enter a valid http(s) video URL.");
        return;
      }
      if (node.video_url === normalized && node.status === "done") return;
      node.video_url = normalized;
      node.status = "done";
      node.lock_subnodes = true;
      toolState.videoEmbedExpanded = true;
      toolState.videoEmbedKey = (Number(toolState.videoEmbedKey) || 0) + 1;
      await persistProjectStructure();
      renderProjectPage();
    };

    if (setBtn) setBtn.onclick = setVideo;
    if (urlInput) {
      urlInput.onkeydown = async (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          await setVideo();
        }
      };
    }

    if (copyBtn) copyBtn.onclick = async () => {
      if (!node.video_url) return;
      try {
        await navigator.clipboard.writeText(node.video_url);
      } catch {
        alert("Unable to copy link to clipboard.");
      }
    };

    if (toggleEmbedBtn) toggleEmbedBtn.onclick = async () => {
      toolState.videoEmbedExpanded = !toolState.videoEmbedExpanded;
      if (toolState.videoEmbedExpanded) toolState.videoEmbedKey = (Number(toolState.videoEmbedKey) || 0) + 1;
      renderProjectPage();
    };

    if (notes) {
      const commitNotes = async () => {
        if ((node.video_notes || "") === notes.value) return;
        node.video_notes = notes.value;
        await persistProjectStructure();
      };
      notes.onblur = async () => {
        await commitNotes();
      };
      notes.onkeydown = async (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          await commitNotes();
        }
      };
    }

    return;
  }
}

function renderDiscovery() {
  const items = filteredProjects();
  const cards = items
    .map((project) => {
      const tags = (project.tags || []).slice(0, 4).map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join("");
      if (state.mode === "list") {
        return `<article class="card card-row" data-open-project="${project.slug}">
          <img class="thumb" src="${project.thumbnail_url}" alt="${escapeHtml(project.project_name)} thumbnail" />
          <div class="card-content">
            <h3 class="card-title">${escapeHtml(project.project_name)}</h3>
            <p class="card-desc">${escapeHtml(project.description || "No description yet.")}</p>
            <div class="badges"><span class="badge">${project.status}</span><span class="badge">${project.deliverable_type}</span>${tags}</div>
          </div>
        </article>`;
      }
      return `<article class="card" data-open-project="${project.slug}">
        <img class="thumb" src="${project.thumbnail_url}" alt="${escapeHtml(project.project_name)} thumbnail" />
        <div class="card-content">
          <h3 class="card-title">${escapeHtml(project.project_name)}</h3>
          <p class="card-desc">${escapeHtml(project.description || "No description yet.")}</p>
          <div class="badges"><span class="badge">${project.status}</span><span class="badge">${project.deliverable_type}</span></div>
        </div>
      </article>`;
    })
    .join("");

  app.innerHTML = `<main class="page">
    <header class="top-bar">
      <div class="title-wrap">
        <h1>Branch Bazaar</h1>
        <p class="subtitle">A garden of active projects</p>
      </div>
      <button class="btn btn-primary" id="new-project">Create New Project</button>
    </header>

    <section class="tools">
      <input id="search" placeholder="Search projects or tags" value="${escapeHtml(state.search)}" />
      <select id="sort"><option value="updated" ${state.sort === "updated" ? "selected" : ""}>Sort: Updated</option><option value="name" ${state.sort === "name" ? "selected" : ""}>Sort: Name</option></select>
      <select id="deliverable-filter"><option value="all">All deliverables</option>${deliverableTypes
        .map((d) => `<option value="${d}" ${state.deliverableFilter === d ? "selected" : ""}>${d}</option>`)
        .join("")}</select>
      <div>
        <button class="btn ${state.mode === "grid" ? "btn-primary" : "btn-muted"}" id="mode-grid">Grid</button>
        <button class="btn ${state.mode === "list" ? "btn-primary" : "btn-muted"}" id="mode-list">List</button>
      </div>
    </section>

    ${items.length ? `<section class="projects ${state.mode}">${cards}</section>` : `<p class="empty">No projects match the current filter.</p>`}
  </main>`;

  document.getElementById("new-project").onclick = () => {
    state.detailDraft = {
      project_name: "new project",
      description: "",
      deliverable_type: "custom",
      deliverables: [{ name: "", description: "", type: "custom", link: "" }],
      done_condition: "",
      tags: [],
      icon_mode: "automatic",
      icon_image: "",
      status: "new",
    };
    state.view = "details";
    state.error = "";
    render();
  };

  document.getElementById("search").oninput = (e) => {
    state.search = e.target.value;
    renderDiscovery();
  };
  document.getElementById("sort").onchange = (e) => {
    state.sort = e.target.value;
    renderDiscovery();
  };
  document.getElementById("deliverable-filter").onchange = (e) => {
    state.deliverableFilter = e.target.value;
    renderDiscovery();
  };
  document.getElementById("mode-grid").onclick = () => {
    state.mode = "grid";
    renderDiscovery();
  };
  document.getElementById("mode-list").onclick = () => {
    state.mode = "list";
    renderDiscovery();
  };

  for (const card of document.querySelectorAll("[data-open-project]")) {
    card.onclick = async () => {
      const slug = card.dataset.openProject;
      state.currentProject = state.projects.find((p) => p.slug === slug) || null;
      state.view = "project";
      await loadProjectStructure(slug);
      render();
    };
  }
}

function renderProjectPage() {
  const activeEl = document.activeElement;
  const focusSnapshot =
    activeEl && activeEl.id === "text-tool-content"
      ? {
          id: activeEl.id,
          start: activeEl.selectionStart,
          end: activeEl.selectionEnd,
          scrollTop: activeEl.scrollTop,
        }
      : null;

  ensureProjectUiState();
  ensureStructureLoaded();
  const structure = state.projectStructures[state.currentProject.slug];
  const nodes = structure.nodes;
  const visibleNodes = (items, depth = 0, parentPath = []) => {
    const list = [];
    for (const node of items || []) {
      const path = [...parentPath, node.name || "Untitled"];
      list.push({ node, depth, path });
      if (node.children?.length && !state.projectUi.collapsedNodes[node.id]) {
        list.push(...visibleNodes(node.children, depth + 1, path));
      }
    }
    return list;
  };
  const rows = visibleNodes(nodes);
  if (!state.projectUi.selectedNodeId && rows[0]) state.projectUi.selectedNodeId = rows[0].node.id;
  const selected = rows.find((row) => row.node.id === state.projectUi.selectedNodeId) || rows[0] || null;
  const selectedNode = selected?.node || null;
  const selectedPath = selected ? selected.path.join(" : ") : "";
  const selectedType = getNodeDisplayType(selectedNode) || "component";

  const treeHtml = rows
    .map(({ node, depth }) => {
      const hasChildren = Array.isArray(node.children) && node.children.length > 0;
      const isCollapsed = !!state.projectUi.collapsedNodes[node.id];
      const isSelected = node.id === state.projectUi.selectedNodeId;
      const toggle = hasChildren
        ? `<button class="tree-toggle" data-toggle-node="${node.id}">${isCollapsed ? "+" : "-"}</button>`
        : `<span class="tree-toggle-placeholder"></span>`;
      return `<tr class="tree-row ${isSelected ? "selected" : ""}" data-select-node="${node.id}"><td style="padding-left:${12 + depth * 18}px">${toggle}<span>${escapeHtml(node.name || "Untitled")}</span></td><td>${escapeHtml(node.status || "new")}</td></tr>`;
    })
    .join("");

  const canEdit = selectedNode && !selectedNode.is_top_level;
  const showEditor = state.projectUi.editorOpen && !!selectedNode;
  app.innerHTML = `<main class="project-page">
    <aside class="project-sidebar ${state.projectUi.sidebarCollapsed ? "collapsed" : ""}" style="width:${state.projectUi.sidebarCollapsed ? 0 : state.projectUi.sidebarWidth}px">
      <div class="sidebar-top">
        <h2>${escapeHtml(state.currentProject.project_name || "")}</h2>
        <p>${escapeHtml(state.currentProject.description || "")}</p>
      </div>
      <div class="tree-wrap">
        <table class="tree-table"><thead><tr><th>Node</th><th>Status</th></tr></thead><tbody>${treeHtml}</tbody></table>
      </div>
      <div class="tree-actions"><button class="btn btn-primary" id="add-node">Add</button><button class="btn btn-muted" id="duplicate-node">Duplicate</button><button class="btn btn-muted" id="edit-node">Edit</button><button class="btn btn-muted" id="remove-node">Remove</button></div>
      <div class="resize-handle" id="resize-handle"></div>
    </aside>
    <section class="project-main">
      <div class="project-main-top"><button class="btn btn-muted" id="toggle-sidebar">${state.projectUi.sidebarCollapsed ? "Show tree" : "Hide tree"}</button><button class="btn btn-muted" id="back-main">Back</button></div>
      <div class="active-panel">
        <div class="active-header">
          <h3>${selectedPath ? escapeHtml(selectedPath) : "No node selected"}</h3>
          <p>Node type: <strong>${escapeHtml(selectedType)}</strong></p>
        </div>
        <div class="active-tool-body">${renderNodeTool(selectedNode)}</div>
      </div>
      <div class="editor-panel ${showEditor ? "" : "hidden"}">
        <div class="editor-header"><h4>Node Editor</h4><button class="btn btn-muted" id="toggle-editor">${showEditor ? "Hide" : "Show"}</button></div>
        ${selectedNode ? `<div class="editor-grid">
          <label class="field">Name <input id="node-name" value="${escapeHtml(selectedNode.name || "")}" ${selectedNode.immutable_name ? "disabled" : ""} /></label>
          <label class="field">Description <textarea id="node-description" rows="2">${escapeHtml(selectedNode.description || "")}</textarea></label>
          <label class="field">Node Type <select id="node-type"><option value="component" ${selectedNode.node_type === "component" ? "selected" : ""}>component</option><option value="choice" ${selectedNode.node_type === "choice" ? "selected" : ""}>choice</option><option value="tool" ${selectedNode.node_type === "tool" ? "selected" : ""}>tool</option></select></label>
          <label class="field ${selectedNode.node_type === "component" ? "" : "hidden"}">Component Type <select id="component-type"><option value="image" ${selectedNode.component_type === "image" ? "selected" : ""}>image</option><option value="video" ${selectedNode.component_type === "video" ? "selected" : ""}>video</option><option value="text" ${selectedNode.component_type === "text" ? "selected" : ""}>text</option><option value="link" ${selectedNode.component_type === "link" ? "selected" : ""}>link</option><option value="file" ${selectedNode.component_type === "file" ? "selected" : ""}>file</option><option value="image set" ${selectedNode.component_type === "image set" ? "selected" : ""}>image set</option></select></label>
          <label class="field ${selectedNode.node_type === "choice" ? "" : "hidden"}"><input type="checkbox" id="choice-between" ${selectedNode.choice_between_components ? "checked" : ""} /> between components</label>
          <label class="field ${selectedNode.node_type === "component" && selectedNode.component_type === "image set" ? "" : "hidden"}">Image Set Type <select id="image-set-type">${imageSetTypes
            .map((value) => `<option value="${value}" ${selectedNode.image_set_type === value ? "selected" : ""}>${value}</option>`)
            .join("")}</select></label>
        </div>` : ""}
      </div>
    </section>
  </main>`;

  document.getElementById("back-main").onclick = () => {
    state.view = "discovery";
    render();
  };

  document.getElementById("toggle-sidebar").onclick = () => {
    state.projectUi.sidebarCollapsed = !state.projectUi.sidebarCollapsed;
    renderProjectPage();
  };

  const toggleEditorBtn = document.getElementById("toggle-editor");
  if (toggleEditorBtn) toggleEditorBtn.onclick = () => {
    state.projectUi.editorOpen = !state.projectUi.editorOpen;
    renderProjectPage();
  };

  for (const rowEl of document.querySelectorAll("[data-select-node]")) {
    rowEl.onclick = (e) => {
      if (e.target.closest("[data-toggle-node]")) return;
      state.projectUi.selectedNodeId = rowEl.dataset.selectNode;
      const nextNode = rows.find((row) => row.node.id === state.projectUi.selectedNodeId)?.node;
      if (nextNode && getNodeDisplayType(nextNode) === "text") {
        const toolState = getNodeToolState(nextNode);
        const history = ensureTextHistory(nextNode);
        if (typeof toolState.historyIndex !== "number") toolState.historyIndex = history.length - 1;
        if (typeof toolState.draft !== "string") toolState.draft = history[history.length - 1].text || "";
      }
      renderProjectPage();
    };
  }
  for (const toggle of document.querySelectorAll("[data-toggle-node]")) {
    toggle.onclick = (e) => {
      e.stopPropagation();
      const id = toggle.dataset.toggleNode;
      state.projectUi.collapsedNodes[id] = !state.projectUi.collapsedNodes[id];
      renderProjectPage();
    };
  }

  const selectedInfo = selectedNode ? findNodeAndParent(nodes, selectedNode.id) : null;
  document.getElementById("add-node").onclick = async () => {
    if (!selectedNode || selectedNode.lock_subnodes) return;
    selectedNode.children = selectedNode.children || [];
    const newNode = { id: uid(), parent_id: selectedNode.id, name: "", description: "", node_type: "component", component_type: "text", choice_between_components: false, status: "new", lock_subnodes: false, notes: "", discussion: [], children: [], image_set_type: "collection", image_set_images: [], image_set_primary_id: "", image_set_selected_index: -1 };
    selectedNode.children.push(newNode);
    state.projectUi.selectedNodeId = newNode.id;
    state.projectUi.editorOpen = true;
    await persistProjectStructure();
    renderProjectPage();
    setTimeout(() => document.getElementById("node-name")?.focus(), 0);
  };

  document.getElementById("duplicate-node").onclick = async () => {
    if (!selectedInfo || selectedInfo.node.is_top_level) return;
    const clone = duplicateNodeTree(selectedInfo.node);
    const siblingNames = new Set((selectedInfo.siblings || []).map((n) => n.name));
    clone.name = nextDuplicateName(selectedInfo.node.name || "Untitled", siblingNames);
    clone.parent_id = selectedInfo.parent ? selectedInfo.parent.id : null;
    selectedInfo.siblings.splice(selectedInfo.index + 1, 0, clone);
    state.projectUi.selectedNodeId = clone.id;
    await persistProjectStructure();
    renderProjectPage();
  };

  document.getElementById("remove-node").onclick = async () => {
    if (!selectedInfo || selectedInfo.node.is_top_level) return;
    selectedInfo.siblings.splice(selectedInfo.index, 1);
    state.projectUi.selectedNodeId = rows[0]?.node.id || "";
    await persistProjectStructure();
    renderProjectPage();
  };

  document.getElementById("edit-node").onclick = () => {
    if (!canEdit) return;
    state.projectUi.editorOpen = true;
    renderProjectPage();
    setTimeout(() => document.getElementById("node-name")?.focus(), 0);
  };

  const resizeHandle = document.getElementById("resize-handle");
  if (resizeHandle) {
    resizeHandle.onmousedown = (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = state.projectUi.sidebarWidth;
      const onMove = (ev) => {
        const next = Math.max(240, Math.min(620, startWidth + (ev.clientX - startX)));
        state.projectUi.sidebarWidth = next;
        const sidebar = document.querySelector(".project-sidebar");
        if (sidebar && !state.projectUi.sidebarCollapsed) sidebar.style.width = `${next}px`;
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
  }

  if (selectedNode) {
    const applyAndSave = async () => {
      await persistProjectStructure();
      renderProjectPage();
    };
    const name = document.getElementById("node-name");
    if (name) {
      name.onblur = async (e) => {
        selectedNode.name = e.target.value;
        await applyAndSave();
      };
      name.onkeydown = async (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          selectedNode.name = e.target.value;
          await applyAndSave();
        }
      };
    }
    const desc = document.getElementById("node-description");
    if (desc) desc.onblur = async (e) => {
      selectedNode.description = e.target.value;
      await applyAndSave();
    };
    const nodeType = document.getElementById("node-type");
    if (nodeType) nodeType.onchange = async (e) => {
      selectedNode.node_type = String(e.target.value || "").trim().toLowerCase();
      await applyAndSave();
    };
    const componentType = document.getElementById("component-type");
    if (componentType) componentType.onchange = async (e) => {
      selectedNode.component_type = String(e.target.value || "").trim().toLowerCase();
      if (selectedNode.component_type === "image set") {
        ensureImageSetState(selectedNode);
        updateImageSetStatus(selectedNode);
      }
      await applyAndSave();
    };
    const imageSetType = document.getElementById("image-set-type");
    if (imageSetType) imageSetType.onchange = async (e) => {
      selectedNode.image_set_type = e.target.value;
      updateImageSetStatus(selectedNode);
      await applyAndSave();
    };
    const choiceBetween = document.getElementById("choice-between");
    if (choiceBetween) choiceBetween.onchange = async (e) => {
      selectedNode.choice_between_components = e.target.checked;
      await applyAndSave();
    };
  }

  bindNodeToolEvents(selectedNode);

  if (focusSnapshot?.id === "text-tool-content") {
    const refreshedArea = document.getElementById("text-tool-content");
    if (refreshedArea && !refreshedArea.disabled) {
      refreshedArea.focus();
      if (typeof focusSnapshot.start === "number" && typeof focusSnapshot.end === "number") {
        refreshedArea.setSelectionRange(focusSnapshot.start, focusSnapshot.end);
      }
      if (typeof focusSnapshot.scrollTop === "number") {
        refreshedArea.scrollTop = focusSnapshot.scrollTop;
      }
    }
  }
}

function renderDetailsPage() {
  const d = state.detailDraft;
  if (!Array.isArray(d.deliverables) || !d.deliverables.length) {
    d.deliverables = [{ name: "", description: "", type: d.deliverable_type || "custom", link: "" }];
  }
  app.innerHTML = `<main class="page"><section class="panel">
    <h2>Project Details</h2>
    <p class="subtitle">Create and save details used for the project thumbnail and discovery list.</p>
    ${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ""}
    <div class="form-grid">
      <label class="field wide">Project Name <input id="project_name" value="${escapeHtml(d.project_name)}" /></label>
      <label class="field wide">Description <textarea id="description" rows="2">${escapeHtml(d.description)}</textarea></label>
      <div class="status-pill" aria-label="Current status">${escapeHtml((d.status || "new").toUpperCase())}</div>
      <div class="field wide">
        <div class="deliverables-header">Deliverables</div>
        <div id="deliverables-list" class="deliverables-list"></div>
        <div class="deliverable-actions">
          <button type="button" class="btn btn-muted" id="add-deliverable">Add</button>
          <button type="button" class="btn btn-muted" id="duplicate-deliverable">Duplicate</button>
          <button type="button" class="btn btn-muted" id="remove-deliverable">Remove</button>
        </div>
      </div>
      <label class="field wide">Done Condition <textarea id="done_condition" rows="2">${escapeHtml(d.done_condition)}</textarea></label>
      <label class="field">Tags (comma separated)<input id="tags" value="${escapeHtml((d.tags || []).join(", "))}"/></label>
      <label class="field">Tag Suggestions<select id="tag_pick"><option value="">Select a tag to add</option>${suggestedTags
        .map((tag) => `<option value="${tag}">${tag}</option>`)
        .join("")}</select></label>
      <label class="field">Icon Mode <select id="icon_mode"><option value="automatic" ${d.icon_mode === "automatic" ? "selected" : ""}>automatic</option><option value="custom" ${
    d.icon_mode === "custom" ? "selected" : ""
  }>custom</option></select></label>
      <label class="field">Icon Image ID <input id="icon_image" value="${escapeHtml(d.icon_image)}" /></label>
    </div>
    <div class="actions"><button class="btn btn-muted" id="cancel">Cancel</button><button class="btn btn-primary" id="save">Save</button></div>
  </section></main>`;

  const bind = (id, prop) => {
    document.getElementById(id).oninput = (e) => (state.detailDraft[prop] = e.target.value);
    document.getElementById(id).onchange = (e) => (state.detailDraft[prop] = e.target.value);
  };
  bind("project_name", "project_name");
  bind("description", "description");
  bind("done_condition", "done_condition");
  bind("icon_mode", "icon_mode");
  bind("icon_image", "icon_image");


  const normalizeDeliverables = () => {
    if (!Array.isArray(state.detailDraft.deliverables) || !state.detailDraft.deliverables.length) {
      state.detailDraft.deliverables = [{ name: "", description: "", type: "custom", link: "" }];
    }
    state.detailDraft.deliverables = state.detailDraft.deliverables.map((item) => ({
      name: item?.name || "",
      description: item?.description || "",
      type: deliverableTypes.includes(item?.type) ? item.type : "custom",
      link: item?.link || "",
    }));
    state.detailDraft.selectedDeliverableIndex = Math.min(
      Math.max(state.detailDraft.selectedDeliverableIndex || 0, 0),
      state.detailDraft.deliverables.length - 1
    );
    state.detailDraft.deliverable_type = state.detailDraft.deliverables[0].type;
  };

  const renderDeliverables = () => {
    normalizeDeliverables();
    const list = document.getElementById("deliverables-list");
    list.innerHTML = state.detailDraft.deliverables
      .map((item, index) => `<div class="deliverable-item ${index === state.detailDraft.selectedDeliverableIndex ? "selected" : ""}" data-deliverable-index="${index}">
        <label class="field">Name <input data-deliverable-field="name" data-deliverable-index="${index}" value="${escapeHtml(item.name)}" /></label>
        <label class="field">Description <textarea rows="2" data-deliverable-field="description" data-deliverable-index="${index}">${escapeHtml(item.description)}</textarea></label>
        <label class="field">Type <select data-deliverable-field="type" data-deliverable-index="${index}">${deliverableTypes
          .map((value) => `<option value="${value}" ${item.type === value ? "selected" : ""}>${value}</option>`)
          .join("")}</select></label>
      </div>`)
      .join("");

    for (const el of list.querySelectorAll(".deliverable-item")) {
      el.onclick = (e) => {
        const idx = Number(e.currentTarget.dataset.deliverableIndex);
        if (Number.isNaN(idx)) return;
        state.detailDraft.selectedDeliverableIndex = idx;
        renderDeliverables();
      };
    }

    for (const field of list.querySelectorAll("[data-deliverable-field]")) {
      const eventName = field.tagName === "SELECT" ? "change" : "input";
      field.addEventListener(eventName, (e) => {
        const idx = Number(e.target.dataset.deliverableIndex);
        const key = e.target.dataset.deliverableField;
        state.detailDraft.deliverables[idx][key] = e.target.value;
        state.detailDraft.deliverable_type = state.detailDraft.deliverables[0].type;
      });
    }
  };

  normalizeDeliverables();
  renderDeliverables();

  document.getElementById("add-deliverable").onclick = () => {
    state.detailDraft.deliverables.push({ name: "", description: "", type: "custom", link: "" });
    state.detailDraft.selectedDeliverableIndex = state.detailDraft.deliverables.length - 1;
    renderDeliverables();
  };

  document.getElementById("duplicate-deliverable").onclick = () => {
    normalizeDeliverables();
    const idx = state.detailDraft.selectedDeliverableIndex || 0;
    const source = state.detailDraft.deliverables[idx];
    state.detailDraft.deliverables.splice(idx + 1, 0, { ...source, link: "" });
    state.detailDraft.selectedDeliverableIndex = idx + 1;
    renderDeliverables();
  };

  document.getElementById("remove-deliverable").onclick = () => {
    normalizeDeliverables();
    if (state.detailDraft.deliverables.length <= 1) return;
    const idx = state.detailDraft.selectedDeliverableIndex || 0;
    state.detailDraft.deliverables.splice(idx, 1);
    state.detailDraft.selectedDeliverableIndex = Math.max(0, idx - 1);
    renderDeliverables();
  };
  document.getElementById("tags").oninput = (e) => {
    state.detailDraft.tags = e.target.value
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  };

  document.getElementById("tag_pick").onchange = (e) => {
    const value = e.target.value;
    if (!value) return;
    const tagSet = new Set([...(state.detailDraft.tags || []), value]);
    state.detailDraft.tags = [...tagSet];
    document.getElementById("tags").value = state.detailDraft.tags.join(", ");
    e.target.value = "";
  };

  document.getElementById("cancel").onclick = () => {
    state.view = "discovery";
    state.error = "";
    render();
  };

  document.getElementById("save").onclick = async () => {
    state.error = "";
    const payload = { ...state.detailDraft };
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (!res.ok) {
      state.error = body.error || "Unable to save project.";
      renderDetailsPage();
      return;
    }
    await loadProjects();
    state.view = "discovery";
    state.detailDraft = null;
    render();
  };
}

function render() {
  if (state.view === "details") return renderDetailsPage();
  if (state.view === "project") return renderProjectPage();
  return renderDiscovery();
}

(async () => {
  await loadProjects();
  if (!state.projectStructures) state.projectStructures = {};
  render();
})();
