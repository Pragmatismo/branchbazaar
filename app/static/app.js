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
    card.onclick = () => {
      const slug = card.dataset.openProject;
      state.currentProject = state.projects.find((p) => p.slug === slug) || null;
      state.view = "project";
      render();
    };
  }
}

function renderProjectPage() {
  app.innerHTML = `<main class="page"><section class="panel"><h2>Project pages coming soon</h2><p>This placeholder confirms navigation for project <strong>${escapeHtml(
    state.currentProject?.project_name || ""
  )}</strong>.</p><button class="btn btn-primary" id="back-main">Back to discovery</button></section></main>`;
  document.getElementById("back-main").onclick = () => {
    state.view = "discovery";
    render();
  };
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
  render();
})();
