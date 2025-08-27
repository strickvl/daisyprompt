import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type {
  ModelId,
  XmlNodeMeta,
  PromptNode,
  TokenCache,
  PerModelTotals,
  SizeBasis,
  ViewMode,
  VisualizationType,
  ParseStatus,
  SearchResult,
  PerformanceConfig,
} from '@/types/models';
import { MODELS } from '@/types/models';

interface AppState {
  // Input state
  rawXML: string;
  xmlError?: string;
  
  // Model and view settings
  modelId: ModelId;
  sizeBasis: SizeBasis;
  viewMode: ViewMode;
  visualizationType: VisualizationType;
  
  // Parsing state
  parseStatus: ParseStatus;
  parseProgress?: { done: number; total?: number };
  rootMeta?: XmlNodeMeta;
  
  // Transformed data for visualization
  promptTree?: PromptNode;
  
  // Statistics
  totals: PerModelTotals;
  tokenCache: TokenCache;
  
  // Navigation and interaction
  selectedNodeId?: string;
  hoveredNodeId?: string;
  zoomPath: string[];
  breadcrumbs: string[];
  
  // UI flags
  legendPinned: boolean;
  
  // Search
  searchQuery: string;
  searchResults: SearchResult[];
  
  // Performance settings
  performanceConfig: PerformanceConfig;
  
  // Theme
  theme: 'light' | 'dark' | 'high-contrast';
  
  // Actions
  actions: {
    // Input actions
    setXML: (xml: string) => void;
    setXMLError: (error?: string) => void;
    
    // Model and view actions
    setModel: (modelId: ModelId) => void;
    setSizeBasis: (basis: SizeBasis) => void;
    setViewMode: (mode: ViewMode) => void;
    setVisualizationType: (type: VisualizationType) => void;
    
    // Parse actions
    setParseStatus: (status: ParseStatus) => void;
    setParseProgress: (progress: { done: number; total?: number }) => void;
    setParsed: (root: XmlNodeMeta) => void;
    
    // Transform actions
    setPromptTree: (tree: PromptNode) => void;
    updateTotals: (modelId: ModelId, totals: { totalTokens: number; totalChars: number }) => void;
    
    // Token cache actions
    addToTokenCache: (hash: string, modelId: ModelId, tokens: number) => void;
    bulkUpdateTokenCache: (updates: Array<{ hash: string; modelId: ModelId; tokens: number }>) => void;
    
    // Navigation actions
    setSelectedNode: (id?: string) => void;
    setHoveredNode: (id?: string) => void;
    zoomToNode: (path: string[]) => void;
    zoomOut: () => void;
    
    // Search actions
    setSearchQuery: (query: string) => void;
    setSearchResults: (results: SearchResult[]) => void;
    
    // Performance actions
    updatePerformanceConfig: (config: Partial<PerformanceConfig>) => void;
    
    // UI actions
    setLegendPinned: (pinned: boolean) => void;
    
    // Theme actions
    setTheme: (theme: 'light' | 'dark' | 'high-contrast') => void;
    
    // Reset
    reset: () => void;
  };
}

const initialPerformanceConfig: PerformanceConfig = {
  maxVisibleNodes: 2000,
  aggregationThreshold: 0.0075, // 0.75%
  enableAnimations: true,
  enableLOD: true,
  debounceMs: 150,
};

const initialState = {
  rawXML: '',
  modelId: 'gpt-5-400k' as ModelId,
  sizeBasis: 'tokens' as SizeBasis,
  viewMode: 'absolute' as ViewMode,
  visualizationType: 'sunburst' as VisualizationType,
  parseStatus: 'idle' as ParseStatus,
  totals: {},
  tokenCache: {},
  zoomPath: [],
  breadcrumbs: ['root'],
  legendPinned: false,
  searchQuery: '',
  searchResults: [],
  performanceConfig: initialPerformanceConfig,
  theme: 'light' as const,
};

export const useStore = create<AppState>()(
  devtools(
    (set, get) => ({
      ...initialState,
      
      actions: {
        // Input actions
        setXML: (rawXML) => set({ rawXML, xmlError: undefined }),
        setXMLError: (xmlError) => set({ xmlError }),
        
        // Model and view actions
        setModel: (modelId) => set({ modelId }),
        setSizeBasis: (sizeBasis) => set({ sizeBasis }),
        setViewMode: (viewMode) => set({ viewMode }),
        setVisualizationType: (visualizationType) => set({ visualizationType }),
        
        // Parse actions
        setParseStatus: (parseStatus) => set({ parseStatus }),
        setParseProgress: (parseProgress) => set({ parseProgress }),
        setParsed: (rootMeta) => set({ 
          rootMeta, 
          parseStatus: 'parsed',
          parseProgress: undefined,
        }),
        
        // Transform actions
        setPromptTree: (promptTree) => set({ promptTree }),
        updateTotals: (modelId, totals) => set((state) => ({
          totals: { ...state.totals, [modelId]: totals }
        })),
        
        // Token cache actions
        addToTokenCache: (hash, modelId, tokens) => set((state) => {
          const key: `${string}:${ModelId}` = `${hash}:${modelId}`;
          return {
            tokenCache: { ...state.tokenCache, [key]: tokens }
          };
        }),
        
        bulkUpdateTokenCache: (updates) => set((state) => {
          const newCache = { ...state.tokenCache };
          updates.forEach(({ hash, modelId, tokens }) => {
            const key: `${string}:${ModelId}` = `${hash}:${modelId}`;
            newCache[key] = tokens;
          });
          return { tokenCache: newCache };
        }),
        
        // Navigation actions
        setSelectedNode: (selectedNodeId) => set({ selectedNodeId }),
        setHoveredNode: (hoveredNodeId) => set({ hoveredNodeId }),
        
        zoomToNode: (path) => set({ 
          zoomPath: path,
          breadcrumbs: ['root', ...path],
        }),
        
        zoomOut: () => set((state) => {
          const newPath = state.zoomPath.slice(0, -1);
          return {
            zoomPath: newPath,
            breadcrumbs: ['root', ...newPath],
          };
        }),
        
        // Search actions
        setSearchQuery: (searchQuery) => set({ searchQuery }),
        setSearchResults: (searchResults) => set({ searchResults }),
        
        // Performance actions
        updatePerformanceConfig: (config) => set((state) => ({
          performanceConfig: { ...state.performanceConfig, ...config }
        })),
        
        // UI actions
        setLegendPinned: (pinned) => set({ legendPinned: pinned }),
        
        // Theme actions
        setTheme: (theme) => {
          document.documentElement.setAttribute('data-theme', theme);
          set({ theme });
        },
        
        // Reset
        reset: () => set(initialState),
      },
    }),
    {
      name: 'daisyprompt-store',
    }
  )
);