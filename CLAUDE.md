# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DaisyPrompt is a client-only React application for visualizing XML prompts. It parses XML, tokenizes content for different LLM models, and renders interactive sunburst charts. The application uses Web Workers for performance-critical operations to keep the UI responsive.

## Development Commands

```bash
# Install dependencies
npm install

# Run development server (port 5173)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Type checking
npm run typecheck

# Linting
npm run lint

# Format code
npm run format

# Run tests (once)
npm run test

# Run tests in watch mode
npm run test:watch
```

## Architecture Overview

### Data Flow Pipeline
1. **Input** → XML input via XMLEditor or FileDrop
2. **Parse** → Worker processes XML, builds tree with character counts and hashes
3. **Tokenize** → Worker counts tokens using model-specific adapters (tiktoken for OpenAI)
4. **Transform** → Convert to PromptNode tree with aggregation and LOD
5. **Visualize** → D3 sunburst/icicle charts with interactive features

### Key Architectural Patterns

#### Web Workers for Performance
- `src/workers/parser.worker.ts`: XML parsing in background thread
- `src/workers/tokenize.worker.ts`: Token counting without blocking UI
- Workers communicate via message passing with progress updates

#### State Management
- Zustand store at `src/state/useStore.ts` manages all application state
- Clear separation between:
  - Raw data (XmlNodeMeta from parser)
  - View models (PromptNode for visualization)
  - Token cache (per model/hash for efficiency)

#### Type-Safe Architecture
- Core types in `src/types/models.ts`
- XmlNodeMeta: Source of truth from parsing
- PromptNode: D3 visualization model
- TokenCache: Hash-based caching per model

#### Component Organization
- `src/pages/Home.tsx`: Main orchestration and worker management
- `src/components/input/`: XML input components
- `src/components/controls/`: UI controls for model selection, view modes
- `src/components/viz/`: D3-based visualization components
- `src/utils/`: Tree transformations, tokenizer adapters, hashing

### Performance Optimizations
- Incremental tokenization with streaming updates
- Hash-based token caching across model switches
- Debounced tree transformations
- Level-of-detail (LOD) rendering for large trees
- Aggregation of small nodes to reduce visual complexity

## Technical Constraints

### Build Configuration
- Vite with ES modules and top-level await support
- WebAssembly enabled for tiktoken tokenizer
- TypeScript strict mode enabled
- Path alias `@/` maps to `src/`

### Worker Considerations
- Workers use ES module format
- WASM dependencies excluded from prebundling
- Message passing includes progress tracking

### Supported Models
- GPT-4 (128k): Uses cl100k_base tokenizer
- Claude 3 Opus/Sonnet (200k): Claude tokenizer adapter
- Gemini 1.5 Pro (1M): Gemini tokenizer adapter

## Security Measures
- DTDs and processing instructions removed from XML
- Workers sandbox parsing and tokenization
- All content previews are escaped before display