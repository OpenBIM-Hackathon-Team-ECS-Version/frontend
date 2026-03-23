# IFC Git Viewer: Frontend

A web-based viewer for exploring IFC (Industry Foundation Classes) building models across Git history. Built for the [openBIM Hackathon 2026](https://www.buildingsmart.org/events/openbim-hackathon-2026/) by **Team ECS Version**.

![React](https://img.shields.io/badge/React-19-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue) ![Vite](https://img.shields.io/badge/Vite-8-purple) ![License](https://img.shields.io/badge/License-MIT-green)

## What It Does

Connect a GitHub repository containing IFC files and navigate through its commit history in 3D. The viewer lets you:

- **3D Model Visualization** — Render IFC building models in the browser using WebGPU
- **Git Timeline** — Scrub through commits and watch the model evolve over time
- **IFC Diffing** — Compare models between commits with visual change highlighting
- **BCF Support** — Load and manage BCF (Building Collaboration Format) viewpoints, topics, and annotations
- **Query Explorer** — Search and filter building components across versions
- **Properties Panel** — Inspect detailed properties of selected building elements

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19, TypeScript |
| Build | Vite 8 |
| Styling | Tailwind CSS 4 |
| State | Zustand |
| 3D / IFC | @ifc-lite (parser, renderer, geometry, query, bcf) |
| Graph | @xyflow/react, dagre |
| Git | @octokit/rest (GitHub API) |

## Getting Started

### Prerequisites

- Node.js (v18+)
- A browser with WebGPU support (Chrome 113+, Edge 113+)

### Installation

```bash
git clone https://github.com/OpenBIM-Hackathon-Team-ECS-Version/frontend.git
cd frontend
npm install
```

### Environment Setup

Copy the example env file and configure the backend URL:

```bash
cp .env.example .env
```

```env
VITE_API_BASE_URL=http://localhost:5001
```

The backend API is required for IFC diffing and query operations. See the [backend repository](https://github.com/OpenBIM-Hackathon-Team-ECS-Version/backend) for setup instructions.

### Development

```bash
npm run dev
```

Opens the dev server at `http://localhost:5173`.

### Production Build

```bash
npm run build
npm run preview
```

## Project Structure

```
src/
├── components/           # React UI components
│   ├── BcfPanel/         #   BCF topics & viewpoints
│   ├── GitGraph/         #   Commit history graph
│   ├── Header/           #   Navigation & repo controls
│   ├── PropertiesPanel/  #   Element properties
│   ├── RepoFilesPanel/   #   Repository file browser
│   ├── Timeline/         #   Version timeline
│   └── Viewer3D/         #   3D IFC model viewer
├── hooks/                # Custom React hooks
├── lib/                  # Utility functions & API clients
├── store/                # Zustand global state
├── types/                # TypeScript type definitions
└── shims/                # Vite plugin shims
```

## Related

- [Backend](https://github.com/OpenBIM-Hackathon-Team-ECS-Version/backend) — API server for IFC diffing and queries

## License

MIT
