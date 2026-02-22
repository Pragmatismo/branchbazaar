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
  if (node.node_type === "component") return node.component_type || "text";
  return node.node_type || "";
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
      <div class="image-tool-actions">
        <button class="btn btn-primary" id="image-tool-upload">Upload</button>
        <input id="image-tool-file" type="file" accept="image/*" class="hidden" />
      </div>
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
          <label class="field ${selectedNode.node_type === "component" ? "" : "hidden"}">Component Type <select id="component-type"><option value="image" ${selectedNode.component_type === "image" ? "selected" : ""}>image</option><option value="video" ${selectedNode.component_type === "video" ? "selected" : ""}>video</option><option value="text" ${selectedNode.component_type === "text" ? "selected" : ""}>text</option><option value="link" ${selectedNode.component_type === "link" ? "selected" : ""}>link</option><option value="file" ${selectedNode.component_type === "file" ? "selected" : ""}>file</option></select></label>
          <label class="field ${selectedNode.node_type === "choice" ? "" : "hidden"}"><input type="checkbox" id="choice-between" ${selectedNode.choice_between_components ? "checked" : ""} /> between components</label>
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
    const newNode = { id: uid(), parent_id: selectedNode.id, name: "", description: "", node_type: "component", component_type: "text", choice_between_components: false, status: "new", lock_subnodes: false, notes: "", discussion: [], children: [] };
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
      selectedNode.node_type = e.target.value;
      await applyAndSave();
    };
    const componentType = document.getElementById("component-type");
    if (componentType) componentType.onchange = async (e) => {
      selectedNode.component_type = e.target.value;
      await applyAndSave();
    };
    const choiceBetween = document.getElementById("choice-between");
    if (choiceBetween) choiceBetween.onchange = async (e) => {
      selectedNode.choice_between_components = e.target.checked;
      await applyAndSave();
    };
  }

  bindNodeToolEvents(selectedNode);
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
