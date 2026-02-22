# Branch Bazaar

A new, non-prototype implementation of the Branch Bazaar project workspace.

## Current scope (Phase 1)

This phase delivers the **Project Discovery** workflow:

- Discovery page with title/subtitle and a create button.
- Sort/filter controls and view mode toggle (grid/list).
- Create flow that starts with a blank `new project` draft then opens **Project Details**.
- Save flow that writes project metadata and generates a thumbnail file.
- Basic project page placeholder (`Project pages coming soon`) with back navigation.
- Server-side project loading from the `projects/` folder at startup/request time.

## Structure

- `app/server.py` — stdlib HTTP server + API routes + thumbnail generation.
- `app/static/` — discovery UI and project details UI.
- `projects/<project-slug>/project.json` — per-project metadata.
- `projects/<project-slug>/thumbnail.svg` — generated thumbnail shown in discovery.

## Run locally

```bash
python3 startV1
```

Then open <http://localhost:8080>.

## Notes for next phases

- Hook edit-entry points from inside each project page to the same Project Details model.
- Add support for actual `icon_image` lookup and image-set thumbnail composition.
- Expand project storage to include docs/media artifacts in each project folder.
