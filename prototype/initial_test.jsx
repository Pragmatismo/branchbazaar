const { useEffect, useMemo, useState } = React;

/**
 * Jumble Project Garden v0.1 — single-file browser prototype
 * - Local-first: stores everything in localStorage
 * - Import/Export: JSON files
 * - Projects -> Nodes tree -> Node workspace
 * - Done condition required for deliverables/components
 * - Done collapses children (hidden by default); toggle to show done
 * - Documentation node at top level; Mark Done prompts to add to Documentation
 *
 * Notes:
 * - Attachments in this prototype are simple URL strings (you can paste links).
 * - "File exists" done conditions are simulated by checking for an attachment whose name matches.
 */

// ---------- helpers ----------
const LS_KEY = "jumble_project_garden_v01";
const nowISO = () => new Date().toISOString();
const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

const DEFAULT_PROJECT_TYPE = "mixed";

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { projects: {}, projectOrder: [] };
    const parsed = JSON.parse(raw);
    if (!parsed.projects) return { projects: {}, projectOrder: [] };
    return parsed;
  } catch {
    return { projects: {}, projectOrder: [] };
  }
}

function saveState(state) {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

function downloadJSON(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function pickJSONFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const text = await file.text();
      try {
        resolve(JSON.parse(text));
      } catch {
        resolve({ __error: "Invalid JSON" });
      }
    };
    input.click();
  });
}

// ---------- data model ----------
/**
 * Project shape:
 * {
 *  id, name, description, project_type, group_path, tags[], links[], version,
 *  created_at, updated_at,
 *  root_node_id,
 *  nodes: { [nodeId]: Node }
 * }
 *
 * Node shape:
 * {
 *  id, parent_id, title,
 *  node_type: 'deliverable'|'component'|'discussion'|'resource'|'documentation',
 *  deliverable_kind?: 'choice'|'image'|'text'|'software'|'data'|'build'|'video'|'audio'|'mixed',
 *  status: 'new'|'planning'|'active'|'review'|'done'|'parked',
 *  done_condition?: { type: 'answer'|'file'|'checklist'|'link'|'data_spec', details: any },
 *  text_content,
 *  attachments: [{ id, label, url }],
 *  children: string[],
 *  documented: boolean,
 *  created_at, updated_at
 * }
 */

function createBaseNode({ parent_id, title, node_type, deliverable_kind, done_condition }) {
  const id = uid();
  return {
    id,
    parent_id: parent_id ?? null,
    title: title || "Untitled",
    node_type,
    deliverable_kind: deliverable_kind ?? null,
    status: "new",
    done_condition: done_condition ?? null,
    text_content: "",
    attachments: [],
    children: [],
    documented: false,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
}

function createNewProject({ name, description, project_type, group_path, tags, links }) {
  const pid = uid();

  // Root node
  const root = createBaseNode({
    parent_id: null,
    title: name || "New Project",
    node_type: "deliverable",
    deliverable_kind: "mixed",
    done_condition: { type: "checklist", details: { note: "Project complete" } },
  });

  // Documentation node
  const doc = createBaseNode({
    parent_id: root.id,
    title: "Documentation (Canon)",
    node_type: "documentation",
    deliverable_kind: "text",
    done_condition: null,
  });

  root.children.push(doc.id);

  const nodes = {
    [root.id]: root,
    [doc.id]: doc,
  };

  return {
    id: pid,
    name: name || "New Project",
    description: description || "",
    project_type: project_type || DEFAULT_PROJECT_TYPE,
    group_path: group_path || "",
    tags: tags || [],
    links: links || [],
    version: "v1.0",
    created_at: nowISO(),
    updated_at: nowISO(),
    root_node_id: root.id,
    nodes,
  };
}

// ---------- status & color logic ----------
function isTextMeaningful(text) {
  return (text || "").trim().length > 0;
}

function nodeHasComponents(node, nodes) {
  return (node.children || []).some((cid) => {
    const c = nodes[cid];
    return c && (c.node_type === "component" || c.node_type === "deliverable");
  });
}

function allChildComponentsDone(node, nodes) {
  const children = (node.children || []).map((id) => nodes[id]).filter(Boolean);
  const relevant = children.filter((c) => c.node_type === "component" || c.node_type === "deliverable");
  if (relevant.length === 0) return false;
  return relevant.every((c) => c.status === "done");
}

function doneConditionAppearsSatisfied(node) {
  const dc = node.done_condition;
  if (!dc) return true;

  if (dc.type === "answer") {
    return isTextMeaningful(node.text_content);
  }

  if (dc.type === "link") {
    return (node.attachments || []).some((a) => (a.url || "").trim().length > 0);
  }

  if (dc.type === "file") {
    const required = (dc.details?.required_label || "").trim();
    if (!required) return false;
    return (node.attachments || []).some((a) => (a.label || "").trim() === required);
  }

  if (dc.type === "data_spec") {
    // simple: require at least one attachment (could be a data file URL)
    return (node.attachments || []).length > 0;
  }

  if (dc.type === "checklist") {
    // checklist satisfaction is handled at parent level by child statuses; here we just say "maybe"
    return true;
  }

  return false;
}

function nodeColor(node, nodes) {
  // Gold: done + documented
  if (node.status === "done" && node.documented) return "gold";

  // Done but not documented: treat as green-ish (finalized but not canon)
  if (node.status === "done") return "green";

  const meaningful = isTextMeaningful(node.text_content);

  // Shell (red): no meaningful content and deliverable lacks structure
  const isDeliverable = node.node_type === "deliverable" || node.node_type === "component";
  if (isDeliverable) {
    const hasDC = !!node.done_condition;
    const hasComps = nodeHasComponents(node, nodes);
    if (!meaningful && (!hasDC || !hasComps)) return "red";
    if (hasDC && hasComps) {
      if (allChildComponentsDone(node, nodes) && doneConditionAppearsSatisfied(node)) return "green"; // ready
      return "orange";
    }
    // some info exists but not structured
    return "orange";
  }

  // Non-deliverables:
  if (!meaningful) return "red";
  return "orange";
}

function colorClasses(color) {
  // Tailwind-ish classes; no custom config needed.
  switch (color) {
    case "red":
      return "border-red-300 bg-red-50 text-red-900";
    case "orange":
      return "border-orange-300 bg-orange-50 text-orange-900";
    case "green":
      return "border-green-300 bg-green-50 text-green-900";
    case "gold":
      return "border-yellow-300 bg-yellow-50 text-yellow-900";
    default:
      return "border-slate-200 bg-white text-slate-900";
  }
}

function badgeClasses(color) {
  switch (color) {
    case "red":
      return "bg-red-100 text-red-800";
    case "orange":
      return "bg-orange-100 text-orange-800";
    case "green":
      return "bg-green-100 text-green-800";
    case "gold":
      return "bg-yellow-100 text-yellow-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

// ---------- UI components ----------
function Modal({ title, open, onClose, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-2xl rounded-2xl bg-white shadow-xl border border-slate-200">
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <div className="font-semibold text-slate-900">{title}</div>
          <button
            className="px-3 py-1 rounded-lg border border-slate-200 hover:bg-slate-50"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function Pill({ children, color }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${badgeClasses(color)}`}>
      {children}
    </span>
  );
}

function TreeItem({ project, nodeId, selectedId, onSelect, showDone, depth = 0 }) {
  const node = project.nodes[nodeId];
  if (!node) return null;

  const color = nodeColor(node, project.nodes);

  const children = (node.children || []).filter((cid) => {
    const c = project.nodes[cid];
    if (!c) return false;
    if (!showDone && c.status === "done") return false;
    return true;
  });

  return (
    <div>
      <button
        onClick={() => onSelect(nodeId)}
        className={`w-full text-left rounded-lg border px-2 py-2 mb-1 flex items-start gap-2 hover:shadow-sm transition ${
          selectedId === nodeId ? "border-slate-400 bg-slate-50" : "border-slate-200 bg-white"
        }`}
        style={{ marginLeft: depth * 10 }}
      >
        <div className="pt-0.5">
          <span className={`inline-block w-2.5 h-2.5 rounded-full ${
            color === "red" ? "bg-red-400" : color === "orange" ? "bg-orange-400" : color === "green" ? "bg-green-400" : "bg-yellow-400"
          }`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="truncate font-medium text-slate-900">{node.title}</div>
            <Pill color={color}>{color}</Pill>
          </div>
          <div className="text-xs text-slate-500">
            {node.node_type}{node.deliverable_kind ? ` • ${node.deliverable_kind}` : ""}{node.status === "done" ? " • done" : ""}
          </div>
        </div>
      </button>

      {children.length > 0 && (
        <div className="ml-3 border-l border-slate-200 pl-2">
          {children.map((cid) => (
            <TreeItem
              key={cid}
              project={project}
              nodeId={cid}
              selectedId={selectedId}
              onSelect={onSelect}
              showDone={showDone}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="block">
      <div className="text-sm font-medium text-slate-700 mb-1">{label}</div>
      <select
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextInput({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <div className="text-sm font-medium text-slate-700 mb-1">{label}</div>
      <input
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function TextArea({ label, value, onChange, placeholder, rows = 8 }) {
  return (
    <label className="block">
      <div className="text-sm font-medium text-slate-700 mb-1">{label}</div>
      <textarea
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm"
        value={value}
        placeholder={placeholder}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function NodeWorkspace({ project, setProject, nodeId, onSelectNode }) {
  const node = project.nodes[nodeId];
  const [tab, setTab] = useState("notes");

  useEffect(() => {
    setTab("notes");
  }, [nodeId]);

  if (!node) return (
    <div className="p-6 text-slate-500">Select a node.</div>
  );

  const color = nodeColor(node, project.nodes);

  function updateNode(patch) {
    setProject((prev) => {
      const next = { ...prev, nodes: { ...prev.nodes } };
      next.nodes[nodeId] = { ...next.nodes[nodeId], ...patch, updated_at: nowISO() };
      next.updated_at = nowISO();
      return next;
    });
  }

  function addAttachment(label, url) {
    if (!url.trim()) return;
    updateNode({
      attachments: [...(node.attachments || []), { id: uid(), label: label || "link", url }],
    });
  }

  function removeAttachment(attId) {
    updateNode({ attachments: (node.attachments || []).filter((a) => a.id !== attId) });
  }

  function addChildNode() {
    const title = prompt("Node title?");
    if (!title) return;

    const node_type = prompt(
      "Node type? (deliverable/component/discussion/resource)\nTip: deliverable/component require a done condition."
    )?.trim();
    if (!node_type) return;

    const normalized = ["deliverable", "component", "discussion", "resource"].includes(node_type)
      ? node_type
      : "discussion";

    let deliverable_kind = null;
    let done_condition = null;

    if (normalized === "deliverable" || normalized === "component") {
      deliverable_kind = prompt(
        "Deliverable kind? (choice/image/text/software/data/build/video/audio/mixed)",
        "mixed"
      )?.trim() || "mixed";

      const dcType = prompt(
        "Done condition type? (answer/file/checklist/link/data_spec)",
        "answer"
      )?.trim() || "answer";

      if (dcType === "file") {
        const required_label = prompt("Required file label (e.g., january.png)?", "") || "";
        done_condition = { type: "file", details: { required_label } };
      } else if (dcType === "checklist") {
        done_condition = { type: "checklist", details: { note: "All child components complete" } };
      } else if (dcType === "link") {
        done_condition = { type: "link", details: { note: "Add at least one link/attachment" } };
      } else if (dcType === "data_spec") {
        const spec = prompt("Data spec note (format/requirements)", "CSV/JSON with fields...") || "";
        done_condition = { type: "data_spec", details: { spec } };
      } else {
        done_condition = { type: "answer", details: { note: "Write the final decision/summary" } };
      }
    }

    const newNode = createBaseNode({
      parent_id: nodeId,
      title,
      node_type: normalized,
      deliverable_kind,
      done_condition,
    });

    setProject((prev) => {
      const next = { ...prev, nodes: { ...prev.nodes } };
      next.nodes[newNode.id] = newNode;
      const parent = next.nodes[nodeId];
      next.nodes[nodeId] = { ...parent, children: [...(parent.children || []), newNode.id], updated_at: nowISO() };
      next.updated_at = nowISO();
      return next;
    });

    onSelectNode(newNode.id);
  }

  function markDone() {
    const appears = doneConditionAppearsSatisfied(node);
    const ok = appears
      ? true
      : confirm(
          "This node's done condition doesn't look satisfied yet. Mark as done anyway?"
        );
    if (!ok) return;

    const addToDoc = confirm("Add this to Documentation (Canon)?");

    setProject((prev) => {
      const next = { ...prev, nodes: { ...prev.nodes } };

      // mark node done
      next.nodes[nodeId] = {
        ...next.nodes[nodeId],
        status: "done",
        documented: addToDoc ? true : next.nodes[nodeId].documented,
        updated_at: nowISO(),
      };

      // if add to documentation, append an entry under Documentation node
      if (addToDoc) {
        const root = next.nodes[next.root_node_id];
        const docNodeId = (root.children || []).find((cid) => next.nodes[cid]?.node_type === "documentation");
        if (docNodeId) {
          const entry = createBaseNode({
            parent_id: docNodeId,
            title: `Doc: ${next.nodes[nodeId].title}`,
            node_type: "resource",
            deliverable_kind: "text",
            done_condition: null,
          });
          entry.text_content = `Source node: ${nodeId}\n\n---\n\n${next.nodes[nodeId].text_content || ""}`;
          entry.attachments = [...(next.nodes[nodeId].attachments || [])];
          entry.status = "done";
          entry.documented = true;

          next.nodes[entry.id] = entry;
          const docNode = next.nodes[docNodeId];
          next.nodes[docNodeId] = {
            ...docNode,
            children: [...(docNode.children || []), entry.id],
            updated_at: nowISO(),
          };
        }
      }

      next.updated_at = nowISO();
      return next;
    });
  }

  function reopen() {
    if (!confirm("Reopen this node (set status back to active)?")) return;
    updateNode({ status: "active" });
  }

  const dc = node.done_condition;

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-slate-200 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-lg font-semibold text-slate-900 truncate">{node.title}</div>
            <Pill color={color}>{color}</Pill>
            {node.status === "done" ? (
              <Pill color={node.documented ? "gold" : "green"}>{node.documented ? "documented" : "done"}</Pill>
            ) : null}
          </div>
          <div className="text-sm text-slate-600">
            {node.node_type}{node.deliverable_kind ? ` • ${node.deliverable_kind}` : ""}
            {dc ? ` • done: ${dc.type}` : ""}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button
            className="px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50"
            onClick={addChildNode}
          >
            + Add child
          </button>
          {node.status === "done" ? (
            <button
              className="px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50"
              onClick={reopen}
            >
              Reopen
            </button>
          ) : (
            <button
              className="px-3 py-2 rounded-xl border border-slate-900 bg-slate-900 text-white hover:bg-slate-800"
              onClick={markDone}
            >
              Mark done
            </button>
          )}
        </div>
      </div>

      <div className="px-4 pt-3">
        <div className="flex items-center gap-2 flex-wrap">
          {[
            { id: "notes", label: "Notes" },
            { id: "special", label: "Special" },
            { id: "attachments", label: "Attachments" },
            { id: "done", label: "Done condition" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-full text-sm border ${
                tab === t.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 overflow-auto">
        {tab === "notes" && (
          <div className="space-y-3">
            <TextArea
              label={node.status === "done" ? "Frozen notes (read-only)" : "Notes"}
              value={node.text_content}
              onChange={(v) => updateNode({ text_content: v })}
              placeholder="Write notes, paste links, capture decisions…"
              rows={14}
            />
            {node.status === "done" && (
              <div className="text-xs text-slate-500">
                Tip: Reopen to edit. In a future version you could allow append-only notes while frozen.
              </div>
            )}
          </div>
        )}

        {tab === "special" && (
          <div className="space-y-3">
            <div className="rounded-2xl border border-slate-200 p-4 bg-white">
              <div className="font-medium text-slate-900">Special area</div>
              <div className="text-sm text-slate-600 mt-1">
                v0.1 placeholder. Later this can show images, collaborative docs, controls, polls, mini tools, etc.
              </div>
              <div className="mt-3 text-sm text-slate-700">
                <ul className="list-disc ml-5">
                  <li>If this is an <b>image</b> deliverable, you can paste image URLs in Attachments and they’ll preview.</li>
                  <li>If this is a <b>choice</b>, you can create child nodes as candidates.</li>
                </ul>
              </div>
            </div>

            {node.deliverable_kind === "image" && (
              <div className="rounded-2xl border border-slate-200 p-4 bg-white">
                <div className="font-medium text-slate-900 mb-2">Image previews</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {(node.attachments || [])
                    .filter((a) => (a.url || "").match(/\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i) || (a.url || "").startsWith("data:image"))
                    .map((a) => (
                      <div key={a.id} className="rounded-xl border border-slate-200 overflow-hidden">
                        <div className="px-3 py-2 text-xs text-slate-600 border-b border-slate-200 bg-slate-50 truncate">
                          {a.label}
                        </div>
                        <img src={a.url} alt={a.label} className="w-full h-48 object-cover" />
                      </div>
                    ))}
                </div>
                {(node.attachments || []).length === 0 && (
                  <div className="text-sm text-slate-500">Add image links in Attachments.</div>
                )}
              </div>
            )}
          </div>
        )}

        {tab === "attachments" && (
          <div className="space-y-3">
            <div className="rounded-2xl border border-slate-200 p-4 bg-white">
              <div className="font-medium text-slate-900">Attachments (links)</div>
              <div className="text-sm text-slate-600">Paste URLs to images, docs, repos, videos, etc.</div>

              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <TextInput label="Label" value={""} onChange={() => {}} placeholder="(type below)" />
                <TextInput label="URL" value={""} onChange={() => {}} placeholder="(type below)" />
              </div>
              <AddAttachmentInline onAdd={addAttachment} />

              <div className="mt-4 space-y-2">
                {(node.attachments || []).map((a) => (
                  <div key={a.id} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-900 truncate">{a.label}</div>
                      <a className="text-xs text-blue-600 truncate block" href={a.url} target="_blank" rel="noreferrer">
                        {a.url}
                      </a>
                    </div>
                    <button
                      className="px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm"
                      onClick={() => removeAttachment(a.id)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {(node.attachments || []).length === 0 && (
                  <div className="text-sm text-slate-500">No attachments yet.</div>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === "done" && (
          <div className="space-y-3">
            <div className="rounded-2xl border border-slate-200 p-4 bg-white">
              <div className="font-medium text-slate-900">Done condition</div>
              {node.node_type === "deliverable" || node.node_type === "component" ? (
                <>
                  {dc ? (
                    <>
                      <div className="text-sm text-slate-700 mt-2">
                        <b>Type:</b> {dc.type}
                      </div>
                      <pre className="mt-2 text-xs bg-slate-50 border border-slate-200 rounded-xl p-3 overflow-auto">
                        {JSON.stringify(dc.details || {}, null, 2)}
                      </pre>
                      <div className="mt-3 text-sm">
                        <b>Appears satisfied:</b> {doneConditionAppearsSatisfied(node) ? "Yes" : "No"}
                      </div>
                      {dc.type === "checklist" && (
                        <div className="mt-2 text-sm">
                          <b>All child components done:</b> {allChildComponentsDone(node, project.nodes) ? "Yes" : "No"}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-sm text-slate-600 mt-2">
                      No done condition set. (In v0.1, deliverables/components should always have one.)
                    </div>
                  )}
                </>
              ) : (
                <div className="text-sm text-slate-600 mt-2">
                  This node type doesn’t require a done condition.
                </div>
              )}

              <div className="mt-4 flex items-center gap-2">
                <button
                  className="px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50"
                  onClick={() => {
                    const nextTitle = prompt("Rename node", node.title);
                    if (nextTitle) updateNode({ title: nextTitle });
                  }}
                >
                  Rename
                </button>
                <button
                  className="px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50"
                  onClick={() => {
                    const s = prompt("Set status (new/planning/active/review/parked)", node.status);
                    if (!s) return;
                    if (["new", "planning", "active", "review", "parked"].includes(s)) updateNode({ status: s });
                  }}
                >
                  Set status
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AddAttachmentInline({ onAdd }) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  return (
    <div className="mt-3 flex flex-col md:flex-row gap-2">
      <input
        className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2"
        placeholder="Label (e.g. january.png, github, ref)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <input
        className="flex-[2] rounded-xl border border-slate-200 bg-white px-3 py-2"
        placeholder="URL (https://… or data:image/…)"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <button
        className="px-4 py-2 rounded-xl border border-slate-900 bg-slate-900 text-white hover:bg-slate-800"
        onClick={() => {
          onAdd(label.trim() || "link", url.trim());
          setLabel("");
          setUrl("");
        }}
      >
        Add
      </button>
    </div>
  );
}

// ---------- main app ----------
function App() {
  const [state, setState] = useState(() => loadState());
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [showProjectCard, setShowProjectCard] = useState(true);
  const [showDone, setShowDone] = useState(false);

  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [npName, setNpName] = useState("");
  const [npDesc, setNpDesc] = useState("");
  const [npType, setNpType] = useState(DEFAULT_PROJECT_TYPE);
  const [npGroup, setNpGroup] = useState("");
  const [npTags, setNpTags] = useState("");
  const [npLinks, setNpLinks] = useState("");

  // Persist
  useEffect(() => {
    saveState(state);
  }, [state]);

  const activeProject = useMemo(() => {
    if (!activeProjectId) return null;
    return state.projects[activeProjectId] || null;
  }, [state, activeProjectId]);

  function upsertProject(project) {
    setState((prev) => {
      const next = { ...prev, projects: { ...prev.projects } };
      next.projects[project.id] = project;
      if (!next.projectOrder.includes(project.id)) next.projectOrder = [project.id, ...(next.projectOrder || [])];
      return next;
    });
  }

  function setProject(mutator) {
    if (!activeProject) return;
    const updated = mutator(activeProject);
    upsertProject(updated);
  }

  function openProject(pid) {
    setActiveProjectId(pid);
    const p = state.projects[pid];
    if (p) setSelectedNodeId(p.root_node_id);
  }

  function createProject() {
    const p = createNewProject({
      name: npName.trim() || "New Project",
      description: npDesc.trim(),
      project_type: npType,
      group_path: npGroup.trim(),
      tags: npTags.split(",").map((s) => s.trim()).filter(Boolean),
      links: npLinks.split(",").map((s) => s.trim()).filter(Boolean),
    });
    upsertProject(p);
    setNewProjectOpen(false);
    setNpName("");
    setNpDesc("");
    setNpType(DEFAULT_PROJECT_TYPE);
    setNpGroup("");
    setNpTags("");
    setNpLinks("");
    openProject(p.id);
  }

  async function importProject() {
    const obj = await pickJSONFile();
    if (!obj) return;
    if (obj.__error) return alert(obj.__error);

    // accept either a single project or a whole state export
    if (obj.projects && obj.projectOrder) {
      if (!confirm("Import will merge projects into your current library. Continue?")) return;
      setState((prev) => {
        const next = { ...prev };
        next.projects = { ...prev.projects, ...obj.projects };
        const incomingOrder = obj.projectOrder || [];
        next.projectOrder = Array.from(new Set([...(incomingOrder || []), ...(prev.projectOrder || [])]));
        return next;
      });
      return;
    }

    if (!obj.id || !obj.nodes || !obj.root_node_id) {
      return alert("That JSON doesn't look like a Project Garden project export.");
    }

    // Ensure unique id if collision
    let imported = obj;
    if (state.projects[imported.id]) {
      imported = { ...imported, id: uid(), name: imported.name + " (imported)" };
    }

    upsertProject(imported);
    openProject(imported.id);
  }

  function exportProject(pid) {
    const p = state.projects[pid];
    if (!p) return;
    const safeName = (p.name || "project").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    downloadJSON(`${safeName || "project"}.project.json`, p);
  }

  function exportLibrary() {
    downloadJSON("jumble_project_garden.library.json", state);
  }

  function deleteProject(pid) {
    const p = state.projects[pid];
    if (!p) return;
    if (!confirm(`Delete project "${p.name}" from this browser? (This cannot be undone.)`)) return;
    setState((prev) => {
      const next = { ...prev, projects: { ...prev.projects }, projectOrder: [...(prev.projectOrder || [])] };
      delete next.projects[pid];
      next.projectOrder = next.projectOrder.filter((x) => x !== pid);
      return next;
    });
    if (activeProjectId === pid) {
      setActiveProjectId(null);
      setSelectedNodeId(null);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-[1400px] mx-auto p-4">
        <header className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-xl font-semibold text-slate-900">Jumble Project Garden</div>
            <div className="text-sm text-slate-600">v0.1 • Local-first • Expand while exploring, contract when decided</div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              className="px-3 py-2 rounded-xl border border-slate-900 bg-slate-900 text-white hover:bg-slate-800"
              onClick={() => setNewProjectOpen(true)}
            >
              + New project
            </button>
            <button
              className="px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50"
              onClick={importProject}
            >
              Import
            </button>
            <button
              className="px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50"
              onClick={exportLibrary}
            >
              Export library
            </button>
          </div>
        </header>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Project list */}
          <div className="lg:col-span-1">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                <div className="font-semibold text-slate-900">Projects</div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-600 flex items-center gap-2">
                    <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
                    show done
                  </label>
                </div>
              </div>
              <div className="p-3 space-y-2">
                {(state.projectOrder || []).length === 0 && (
                  <div className="text-sm text-slate-500">No projects yet. Create one.</div>
                )}
                {(state.projectOrder || []).map((pid) => {
                  const p = state.projects[pid];
                  if (!p) return null;
                  const root = p.nodes[p.root_node_id];
                  const rootColor = root ? nodeColor(root, p.nodes) : "red";
                  return (
                    <div
                      key={pid}
                      className={`rounded-2xl border p-3 ${
                        activeProjectId === pid ? "border-slate-400 bg-slate-50" : "border-slate-200 bg-white"
                      }`}
                    >
                      <button className="w-full text-left" onClick={() => openProject(pid)}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 truncate">{p.name}</div>
                            <div className="text-xs text-slate-600 truncate">{p.group_path || p.project_type}</div>
                          </div>
                          <Pill color={rootColor}>{rootColor}</Pill>
                        </div>
                        {p.description ? (
                          <div className="mt-2 text-sm text-slate-600 line-clamp-2">{p.description}</div>
                        ) : null}
                      </button>
                      <div className="mt-3 flex items-center gap-2 flex-wrap">
                        <button
                          className="px-2.5 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-sm"
                          onClick={() => exportProject(pid)}
                        >
                          Export
                        </button>
                        <button
                          className="px-2.5 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-sm"
                          onClick={() => deleteProject(pid)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Active project workspace */}
          <div className="lg:col-span-2">
            {!activeProject ? (
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-6 text-slate-600">
                Select a project from the left, or create a new one.
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-200 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-lg font-semibold text-slate-900 truncate">{activeProject.name}</div>
                    <div className="text-sm text-slate-600 truncate">{activeProject.group_path || activeProject.project_type}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <button
                      className="px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50"
                      onClick={() => setShowProjectCard((v) => !v)}
                    >
                      {showProjectCard ? "Hide" : "Show"} project card
                    </button>
                    <button
                      className="px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50"
                      onClick={() => downloadJSON(`${activeProject.name}.backup.json`, activeProject)}
                    >
                      Quick backup
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3">
                  {/* Left: project card + tree */}
                  <div className="md:col-span-1 border-r border-slate-200 bg-slate-50">
                    {showProjectCard && (
                      <div className="p-4 border-b border-slate-200">
                        <div className="font-semibold text-slate-900">Project card</div>
                        <div className="mt-2 text-sm text-slate-700">{activeProject.description || "(no description)"}</div>
                        <div className="mt-3 text-xs text-slate-600 space-y-1">
                          <div><b>Type:</b> {activeProject.project_type}</div>
                          <div><b>Version:</b> {activeProject.version}</div>
                          <div><b>Tags:</b> {(activeProject.tags || []).join(", ") || "—"}</div>
                          <div><b>Links:</b> {(activeProject.links || []).join(", ") || "—"}</div>
                        </div>
                      </div>
                    )}

                    <div className="p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-semibold text-slate-900">Tree</div>
                        <button
                          className="px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 text-sm"
                          onClick={() => {
                            setSelectedNodeId(activeProject.root_node_id);
                          }}
                        >
                          Root
                        </button>
                      </div>

                      <TreeItem
                        project={activeProject}
                        nodeId={activeProject.root_node_id}
                        selectedId={selectedNodeId}
                        onSelect={setSelectedNodeId}
                        showDone={showDone}
                      />

                      {!showDone && (
                        <div className="mt-3 text-xs text-slate-500">
                          Done nodes are hidden. Toggle “show done” in the Projects panel.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right: node workspace */}
                  <div className="md:col-span-2 h-[72vh]">
                    <NodeWorkspace
                      project={activeProject}
                      setProject={(mut) => setProject(mut)}
                      nodeId={selectedNodeId || activeProject.root_node_id}
                      onSelectNode={setSelectedNodeId}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal title="New project" open={newProjectOpen} onClose={() => setNewProjectOpen(false)}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <TextInput label="Name" value={npName} onChange={setNpName} placeholder="e.g. Recipe Cards For Home Grown Veg" />
          <TextInput label="Group path" value={npGroup} onChange={setNpGroup} placeholder="e.g. educational resources / food" />
          <TextInput label="Description" value={npDesc} onChange={setNpDesc} placeholder="Short project description" />
          <Select
            label="Project type"
            value={npType}
            onChange={setNpType}
            options={[
              { value: "mixed", label: "mixed" },
              { value: "image_set", label: "image_set" },
              { value: "software", label: "software" },
              { value: "build", label: "build" },
              { value: "research", label: "research" },
              { value: "media_series", label: "media_series" },
            ]}
          />
          <TextInput label="Tags (comma separated)" value={npTags} onChange={setNpTags} placeholder="pigrow, food, calendar" />
          <TextInput label="Links (comma separated)" value={npLinks} onChange={setNpLinks} placeholder="#v1smallplotvegguide, https://…" />
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            className="px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50"
            onClick={() => setNewProjectOpen(false)}
          >
            Cancel
          </button>
          <button
            className="px-3 py-2 rounded-xl border border-slate-900 bg-slate-900 text-white hover:bg-slate-800"
            onClick={createProject}
          >
            Create
          </button>
        </div>

        <div className="mt-4 text-xs text-slate-500">
          Stored in this browser’s localStorage. Export projects/library regularly.
        </div>
      </Modal>
    </div>
  );
}


const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
