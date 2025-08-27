# DaisyPrompt — XML Prompt Visualizer

DaisyPrompt is a client-only React app that parses XML prompts, tokenizes content for selected LLM models, transforms it into a visualization-friendly tree, and renders interactive sunburst charts.

Workflow: input → parse → tokenize → transform → visualize

## Features

- XML parsing in a Web Worker (fast-xml-parser + saxes streaming fallback)
- Tokenization in a Web Worker (tiktoken cl100k_base by default; heuristic adapters for other models)
- Progressive updates with responsive UI
- Token/char size basis with proxy fallback while tokens stream
- Aggregation ("Other (n items)") for tiny slices, and LOD (max visible nodes, depth)
- Interactive D3 sunburst with zoom, breadcrumbs, tooltips, and keyboard support
- Search by tag/path, model selector, view mode toggle, and token usage display

## Getting Started

Prereqs:
- Node.js v20 LTS recommended
- npm (or pnpm/yarn)

Install dependencies:
- npm install

Run dev server:
- npm run dev

Typecheck:
- npm run typecheck

Build for production:
- npm run build

Preview production build:
- npm run preview

## Project Structure

- src/pages/Home.tsx — main page composition and workflow orchestration
- src/components/input — XMLEditor, FileDrop, ValidationPanel
- src/components/controls — ModelSelector, ViewModeToggle, SizeBasisToggle, TokenDisplay, SearchBox
- src/components/viz — SunburstChart, useSunburstD3 hook, Breadcrumbs
- src/state/useStore.ts — Zustand store for app state
- src/utils — hashing, tokenizer adapter, tree transforms
- src/workers — parser.worker.ts, tokenize.worker.ts

## How It Works

1. Input
   - Paste or drop XML in XMLEditor/FileDrop. The parser worker sanitizes input (no DTD/PI) and builds a tree with charCount and a stable hash per node.

2. Parse
   - The app receives parse progress and final root (XmlNodeMeta). It builds an initial PromptNode tree sized by characters.

3. Tokenize
   - On parse complete (and on model change), the tokenizer worker walks the tree breadth-first, counting tokens per node using a model-specific adapter (tiktoken for OpenAI by default).
   - Partial updates stream every ~16ms. The UI updates token cache and re-transforms the tree progressively.

4. Transform
   - XmlNodeMeta → PromptNode with:
     - Aggregation of tiny siblings into "Other"
     - LOD (maxVisibleNodes, maxDepth)
     - Previews (escaped)
     - Totals (tokens and chars)

5. Visualize
   - SunburstChart renders arcs sized by node.value (not totalValue), supports zoom, tooltips, breadcrumbs, and accessibility labels.

## Security

- Untrusted XML: DTDs and processing instructions are removed.
- Workers sandbox parsing and tokenization.
- Previews are escaped; no raw HTML from XML is injected.

## Notes

- Token counts may be approximated by characters until precise counts arrive. The UI shows a "proxy" badge in this state.
- Switching models reuses cache for identical content hashes and computes only missing nodes.

## License

MIT