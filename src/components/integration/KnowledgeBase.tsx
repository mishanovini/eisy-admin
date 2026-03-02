/**
 * Product Knowledge Base — UI for managing product entries,
 * system topology, AI context documents, external references,
 * and troubleshooting history.
 *
 * v2: Product-centric model. Left sidebar shows products grouped
 * by protocol, right panel shows product detail with tabs.
 * Top-level toggle between Products view and System Topology view.
 */
import { useState, useEffect, useRef, useMemo } from 'react';
import {
  BookOpen,
  Plus,
  Trash2,
  Edit,
  Link,
  FileText,
  Wrench,
  Search,
  Download,
  Upload,
  ExternalLink,
  Save,
  Eye,
  ChevronRight,
  ChevronDown,
  Network,
  Package,
  Tag,
  MapPin,
  ArrowRight,
  FolderOpen,
} from 'lucide-react';
import {
  useKnowledgeStore,
} from '@/stores/knowledge-store.ts';
import type {
  ProductEntry,
  ContextDocument,
  ProductProtocol,
} from '@/stores/knowledge-store.ts';
import { ConfirmDialog } from '@/components/common/ConfirmDialog.tsx';
import { useConfirm } from '@/hooks/useConfirm.ts';
import seedData from '@/data/knowledge-base-seed.json';

// ─── Constants ───────────────────────────────────────────────

type DetailTab = 'overview' | 'context' | 'references' | 'troubleshooting';

const TABS: { id: DetailTab; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'Overview', icon: <Eye size={14} /> },
  { id: 'context', label: 'AI Context', icon: <FileText size={14} /> },
  { id: 'references', label: 'References', icon: <Link size={14} /> },
  { id: 'troubleshooting', label: 'Troubleshooting', icon: <Wrench size={14} /> },
];

type KBView = 'products' | 'topology';

const PROTOCOL_LABELS: Record<ProductProtocol, string> = {
  insteon: 'Insteon',
  zwave: 'Z-Wave',
  ir: 'IR / AV Control',
  wifi: 'WiFi',
  cloud: 'Cloud Services',
  usb: 'USB Peripherals',
  platform: 'Platform',
  other: 'Other',
};

const PROTOCOL_ORDER: ProductProtocol[] = ['insteon', 'zwave', 'ir', 'usb', 'cloud', 'platform', 'wifi', 'other'];

const REF_TYPE_LABELS: Record<string, string> = {
  manual: 'Manual',
  'tech-doc': 'Tech Doc',
  forum: 'Forum',
  wiki: 'Wiki',
  video: 'Video',
  config: 'Config File',
  other: 'Other',
};

const REF_TYPE_COLORS: Record<string, string> = {
  manual: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  'tech-doc': 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  forum: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  wiki: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  video: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  config: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  other: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300',
};

// ─── Main component ──────────────────────────────────────────

export function KnowledgeBase() {
  const loaded = useKnowledgeStore((s) => s.loaded);
  const loadAll = useKnowledgeStore((s) => s.loadAll);
  const products = useKnowledgeStore((s) => s.products);
  const exportAll = useKnowledgeStore((s) => s.exportAll);
  const importAll = useKnowledgeStore((s) => s.importAll);

  const [view, setView] = useState<KBView>('products');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [importError, setImportError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loaded) {
      void loadAll();
    }
  }, [loaded, loadAll]);

  // Auto-seed: if KB is empty after loading, import seed data
  const seeded = useRef(false);
  useEffect(() => {
    if (loaded && products.length === 0 && !seeded.current) {
      seeded.current = true;
      console.log('[KB] Empty Knowledge Base — importing seed data...');
      void importAll(JSON.stringify(seedData)).then(() => {
        console.log('[KB] Seed data imported successfully');
      });
    }
  }, [loaded, products.length, importAll]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return products;
    const q = searchQuery.toLowerCase();
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.manufacturer.toLowerCase().includes(q) ||
        p.protocol.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [products, searchQuery]);

  const selected = products.find((p) => p.id === selectedId) ?? null;

  // Auto-select first if current selection is gone
  useEffect(() => {
    if (selectedId && !products.find((p) => p.id === selectedId)) {
      setSelectedId(products[0]?.id ?? null);
    }
  }, [products, selectedId]);

  const handleExport = () => {
    const json = exportAll();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eisy-knowledge-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      await importAll(text);
      setImportError('');
      setSelectedId(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  if (!loaded) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-gray-400 dark:text-gray-500">Loading knowledge base...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top bar: View toggle */}
      <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-2 dark:border-gray-700">
        <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-gray-700 dark:bg-gray-800">
          <button
            onClick={() => setView('products')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              view === 'products'
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <Package size={14} /> Products
          </button>
          <button
            onClick={() => setView('topology')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              view === 'topology'
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <Network size={14} /> System Topology
          </button>
        </div>
        <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">
          {products.length} product{products.length !== 1 ? 's' : ''}
        </span>
      </div>

      {view === 'topology' ? (
        <TopologyView onSelectProduct={(id) => { setSelectedId(id); setView('products'); }} />
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* Left sidebar */}
          <div className="flex w-64 shrink-0 flex-col border-r border-gray-200 dark:border-gray-700">
            <ProductList
              products={filtered}
              selectedId={selectedId}
              searchQuery={searchQuery}
              onSearch={setSearchQuery}
              onSelect={setSelectedId}
            />
          </div>

          {/* Right panel */}
          <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-4">
            {selected ? (
              <ProductDetail product={selected} />
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-gray-400 dark:text-gray-500">
                  {products.length === 0
                    ? 'No products yet. Click + to add one.'
                    : 'Select a product to view details.'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bottom bar */}
      <div className="flex items-center gap-2 border-t border-gray-200 px-4 py-2 dark:border-gray-700">
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          <Download size={14} /> Export All
        </button>
        <button
          onClick={handleImport}
          className="flex items-center gap-1.5 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          <Upload size={14} /> Import
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={(e) => void handleFileChange(e)}
        />
        {importError && (
          <span className="text-xs text-red-500">{importError}</span>
        )}
      </div>
    </div>
  );
}

// ─── Product List (Left sidebar, grouped by protocol) ────────

interface ProductListProps {
  products: ProductEntry[];
  selectedId: string | null;
  searchQuery: string;
  onSearch: (q: string) => void;
  onSelect: (id: string | null) => void;
}

function ProductList({ products, selectedId, searchQuery, onSearch, onSelect }: ProductListProps) {
  const addProduct = useKnowledgeStore((s) => s.addProduct);
  const deleteProduct = useKnowledgeStore((s) => s.deleteProduct);
  const [dialogProps, confirm] = useConfirm();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Group products by protocol
  const grouped = useMemo(() => {
    const groups = new Map<ProductProtocol, ProductEntry[]>();
    for (const p of products) {
      const list = groups.get(p.protocol) ?? [];
      list.push(p);
      groups.set(p.protocol, list);
    }
    // Sort by protocol order
    return PROTOCOL_ORDER
      .filter((proto) => groups.has(proto))
      .map((proto) => ({ protocol: proto, products: groups.get(proto)! }));
  }, [products]);

  const handleAdd = async () => {
    const id = await addProduct({
      name: 'New Product',
      manufacturer: '',
      modelNumber: '',
      protocol: 'other',
      description: '',
      matchPatterns: [],
      isExternal: false,
      instanceCount: 0,
      tags: [],
      source: 'manual',
    });
    onSelect(id);
  };

  const handleDelete = async (e: React.MouseEvent, product: ProductEntry) => {
    e.stopPropagation();
    const ok = await confirm({
      title: 'Delete product?',
      message: `This will permanently delete "${product.name}" and all its documents, references, and troubleshooting entries.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (ok) {
      await deleteProduct(product.id);
    }
  };

  const toggleGroup = (proto: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(proto)) next.delete(proto);
      else next.add(proto);
      return next;
    });
  };

  return (
    <>
      <ConfirmDialog {...dialogProps} />
      {/* Search + Add header */}
      <div className="flex items-center gap-1 border-b border-gray-200 p-2 dark:border-gray-700">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search products..."
            className="w-full rounded border border-gray-300 bg-white py-1.5 pl-7 pr-2 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>
        <button
          onClick={() => void handleAdd()}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-gray-300 text-gray-500 hover:bg-gray-50 hover:text-gray-700 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          title="Add product"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Grouped list */}
      <div className="flex-1 overflow-y-auto">
        {grouped.length === 0 ? (
          <div className="p-3 text-center text-xs text-gray-400 dark:text-gray-500">
            No products found.
          </div>
        ) : (
          grouped.map(({ protocol, products: groupProducts }) => (
            <div key={protocol}>
              {/* Group header */}
              <button
                onClick={() => toggleGroup(protocol)}
                className="flex w-full items-center gap-1.5 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:bg-gray-100 dark:bg-gray-800/50 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                {collapsed.has(protocol) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                {PROTOCOL_LABELS[protocol]}
                <span className="ml-auto font-normal text-gray-400">{groupProducts.length}</span>
              </button>

              {/* Products in group */}
              {!collapsed.has(protocol) &&
                groupProducts.map((p) => (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelect(p.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') onSelect(p.id); }}
                    className={`group flex w-full cursor-pointer items-center gap-2 border-b border-gray-100 px-3 py-2 text-left text-sm transition-colors dark:border-gray-800 ${
                      selectedId === p.id
                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'
                        : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'
                    }`}
                  >
                    <Package size={14} className="shrink-0 text-gray-400 dark:text-gray-500" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{p.name}</div>
                      <div className="truncate text-xs text-gray-400 dark:text-gray-500">
                        {p.manufacturer}{p.instanceCount > 1 ? ` · ×${p.instanceCount}` : ''}
                      </div>
                    </div>
                    {p.isExternal && (
                      <span className="shrink-0 rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                        ext
                      </span>
                    )}
                    <button
                      onClick={(e) => void handleDelete(e, p)}
                      className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                      title="Delete"
                    >
                      <Trash2 size={12} className="text-red-400 hover:text-red-600" />
                    </button>
                  </div>
                ))}
            </div>
          ))
        )}
      </div>
    </>
  );
}

// ─── Product Detail (Right panel) ────────────────────────────

function ProductDetail({ product }: { product: ProductEntry }) {
  const [tab, setTab] = useState<DetailTab>('overview');

  return (
    <div className="space-y-4">
      {/* Product header */}
      <div className="flex items-start gap-3">
        <Package size={24} className="mt-0.5 shrink-0 text-blue-500" />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{product.name}</h2>
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <span>{product.manufacturer}</span>
            {product.modelNumber && (
              <>
                <span className="text-gray-300 dark:text-gray-600">·</span>
                <span>{product.modelNumber}</span>
              </>
            )}
            <span className="text-gray-300 dark:text-gray-600">·</span>
            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
              {PROTOCOL_LABELS[product.protocol]}
            </span>
            {product.isExternal && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                External
              </span>
            )}
            {product.instanceCount > 0 && (
              <span className="text-xs">
                ×{product.instanceCount} installed
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-gray-700 dark:bg-gray-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === t.id
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab product={product} />}
      {tab === 'context' && <ContextTab productId={product.id} />}
      {tab === 'references' && <ReferencesTab productId={product.id} />}
      {tab === 'troubleshooting' && <TroubleshootingTab productId={product.id} />}
    </div>
  );
}

// ─── Tab 1: Overview ─────────────────────────────────────────

function OverviewTab({ product }: { product: ProductEntry }) {
  const updateProduct = useKnowledgeStore((s) => s.updateProduct);

  const [name, setName] = useState(product.name);
  const [manufacturer, setManufacturer] = useState(product.manufacturer);
  const [modelNumber, setModelNumber] = useState(product.modelNumber);
  const [description, setDescription] = useState(product.description);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setName(product.name);
    setManufacturer(product.manufacturer);
    setModelNumber(product.modelNumber);
    setDescription(product.description);
    setSaved(false);
  }, [product.id, product.name, product.manufacturer, product.modelNumber, product.description]);

  const handleSave = async () => {
    await updateProduct(product.id, { name, manufacturer, modelNumber, description });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Editable fields */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <Edit size={16} className="text-blue-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Product Details</h3>
        </div>
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Manufacturer</label>
              <input
                type="text"
                value={manufacturer}
                onChange={(e) => setManufacturer(e.target.value)}
                className="w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Model Number</label>
              <input
                type="text"
                value={modelNumber}
                onChange={(e) => setModelNumber(e.target.value)}
                className="w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Description</label>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleSave()}
              className="flex items-center gap-1.5 rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              <Save size={14} /> Save
            </button>
            {saved && <span className="text-xs text-green-600 dark:text-green-400">Saved!</span>}
          </div>
        </div>
      </div>

      {/* Signal Chain */}
      {product.signalChain && product.signalChain.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
            <ArrowRight size={16} className="text-purple-500" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Signal Chain</h3>
          </div>
          <div className="flex flex-wrap items-center gap-1 p-4">
            {product.signalChain.map((step, i) => (
              <span key={i} className="flex items-center gap-1 text-sm">
                <span className="rounded bg-purple-50 px-2 py-0.5 font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                  {step}
                </span>
                {i < product.signalChain!.length - 1 && (
                  <ArrowRight size={14} className="text-gray-300 dark:text-gray-600" />
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Instance Names */}
      {product.instanceNames && product.instanceNames.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
            <MapPin size={16} className="text-green-500" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Installed Instances ({product.instanceCount})
            </h3>
          </div>
          <div className="flex flex-wrap gap-1.5 p-4">
            {product.instanceNames.map((name, i) => (
              <span
                key={i}
                className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Tags */}
      {product.tags.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
            <Tag size={16} className="text-blue-500" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Tags</h3>
          </div>
          <div className="flex flex-wrap gap-1.5 p-4">
            {product.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab 2: AI Context Documents ─────────────────────────────

function ContextTab({ productId }: { productId: string }) {
  const documents = useKnowledgeStore((s) => s.documents);
  const addDocument = useKnowledgeStore((s) => s.addDocument);
  const updateDocument = useKnowledgeStore((s) => s.updateDocument);
  const deleteDocument = useKnowledgeStore((s) => s.deleteDocument);
  const [dialogProps, confirm] = useConfirm();

  const docs = useMemo(
    () => documents.filter((d) => d.productId === productId),
    [documents, productId],
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');

  const handleAdd = async () => {
    const id = await addDocument({
      productId,
      title: 'New Context Document',
      content: '',
    });
    setEditingId(id);
    setEditTitle('New Context Document');
    setEditContent('');
  };

  const handleEdit = (doc: ContextDocument) => {
    setEditingId(doc.id);
    setEditTitle(doc.title);
    setEditContent(doc.content);
  };

  const handleSave = async () => {
    if (!editingId) return;
    await updateDocument(editingId, { title: editTitle, content: editContent });
    setEditingId(null);
  };

  const handleDelete = async (doc: ContextDocument) => {
    const ok = await confirm({
      title: 'Delete document?',
      message: `Delete "${doc.title}"?`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (ok) {
      await deleteDocument(doc.id);
      if (editingId === doc.id) setEditingId(null);
    }
  };

  return (
    <>
      <ConfirmDialog {...dialogProps} />
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Curated documents that provide context to the AI chatbot.
          </p>
          <button
            onClick={() => void handleAdd()}
            className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            <Plus size={12} /> Add Document
          </button>
        </div>

        {docs.length === 0 && !editingId && (
          <p className="py-6 text-center text-xs text-gray-400">No context documents yet.</p>
        )}

        {docs.map((doc) =>
          editingId === doc.id ? (
            <div key={doc.id} className="rounded-xl border border-blue-200 p-4 dark:border-blue-800">
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="mb-2 w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                placeholder="Document title"
              />
              <textarea
                rows={8}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="mb-2 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm font-mono dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                placeholder="Document content (Markdown supported)"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => void handleSave()}
                  className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                >
                  <Save size={12} /> Save
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="flex items-center gap-1 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div key={doc.id} className="group rounded-xl border border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2 dark:border-gray-700">
                <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">{doc.title}</h4>
                <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={() => handleEdit(doc)}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
                  >
                    <Edit size={12} />
                  </button>
                  <button
                    onClick={() => void handleDelete(doc)}
                    className="rounded p-1 text-red-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap p-4 text-xs text-gray-600 dark:text-gray-400">
                {doc.content || '(empty)'}
              </pre>
            </div>
          ),
        )}
      </div>
    </>
  );
}

// ─── Tab 3: References ───────────────────────────────────────

function ReferencesTab({ productId }: { productId: string }) {
  const references = useKnowledgeStore((s) => s.references);
  const addReference = useKnowledgeStore((s) => s.addReference);
  const deleteReference = useKnowledgeStore((s) => s.deleteReference);
  const defaultConfigLocation = useKnowledgeStore((s) => s.defaultConfigLocation);
  const setDefaultConfigLocation = useKnowledgeStore((s) => s.setDefaultConfigLocation);
  const [dialogProps, confirm] = useConfirm();

  const refs = useMemo(
    () => references.filter((r) => r.productId === productId),
    [references, productId],
  );

  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newRefType, setNewRefType] = useState<string>('manual');
  const [newNotes, setNewNotes] = useState('');
  const [editingConfigLocation, setEditingConfigLocation] = useState(false);
  const [configLocationDraft, setConfigLocationDraft] = useState(defaultConfigLocation);

  const handleAdd = async () => {
    if (!newTitle.trim() || !newUrl.trim()) return;
    await addReference({
      productId,
      title: newTitle,
      url: newUrl,
      refType: newRefType as 'manual' | 'tech-doc' | 'forum' | 'wiki' | 'video' | 'config' | 'other',
      notes: newNotes,
    });
    setNewTitle('');
    setNewUrl('');
    setNewRefType('manual');
    setNewNotes('');
    setShowAdd(false);
  };

  const handleDelete = async (ref: { id: string; title: string }) => {
    const ok = await confirm({
      title: 'Delete reference?',
      message: `Delete "${ref.title}"?`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (ok) {
      await deleteReference(ref.id);
    }
  };

  // When user switches to "config" type, pre-fill URL from default location if URL is empty
  const handleRefTypeChange = (type: string) => {
    setNewRefType(type);
    if (type === 'config' && defaultConfigLocation && !newUrl) {
      setNewUrl(defaultConfigLocation);
    }
  };

  return (
    <>
      <ConfirmDialog {...dialogProps} />
      <div className="space-y-3">
        {/* Default config location banner */}
        <div className="flex items-center gap-2 rounded-lg border border-teal-200 bg-teal-50/50 px-3 py-2 dark:border-teal-800/50 dark:bg-teal-900/10">
          <FolderOpen size={14} className="shrink-0 text-teal-600 dark:text-teal-400" />
          {editingConfigLocation ? (
            <div className="flex flex-1 items-center gap-2">
              <input
                type="text"
                value={configLocationDraft}
                onChange={(e) => setConfigLocationDraft(e.target.value)}
                className="flex-1 rounded border border-teal-300 bg-white px-2 py-1 text-xs dark:border-teal-700 dark:bg-gray-800 dark:text-gray-100"
                placeholder="e.g., https://drive.google.com/drive/folders/... or C:\eisy-configs"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setDefaultConfigLocation(configLocationDraft);
                    setEditingConfigLocation(false);
                  } else if (e.key === 'Escape') {
                    setConfigLocationDraft(defaultConfigLocation);
                    setEditingConfigLocation(false);
                  }
                }}
              />
              <button
                onClick={() => { setDefaultConfigLocation(configLocationDraft); setEditingConfigLocation(false); }}
                className="rounded bg-teal-600 px-2 py-1 text-xs font-medium text-white hover:bg-teal-700"
              >
                Save
              </button>
              <button
                onClick={() => { setConfigLocationDraft(defaultConfigLocation); setEditingConfigLocation(false); }}
                className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400"
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <span className="flex-1 truncate text-xs text-teal-700 dark:text-teal-300">
                {defaultConfigLocation ? (
                  <>
                    <span className="font-medium">Config files location:</span>{' '}
                    <a href={defaultConfigLocation} target="_blank" rel="noopener noreferrer" className="underline hover:text-teal-900 dark:hover:text-teal-100">
                      {defaultConfigLocation}
                    </a>
                  </>
                ) : (
                  <span className="italic text-teal-600/70 dark:text-teal-400/50">No default config location set — click Edit to set one</span>
                )}
              </span>
              <button
                onClick={() => { setConfigLocationDraft(defaultConfigLocation); setEditingConfigLocation(true); }}
                className="shrink-0 rounded border border-teal-300 px-2 py-0.5 text-[10px] font-medium text-teal-700 hover:bg-teal-100 dark:border-teal-700 dark:text-teal-300 dark:hover:bg-teal-800/30"
              >
                Edit
              </button>
            </>
          )}
        </div>

        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Manuals, tech docs, config files, and other external references.
          </p>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            <Plus size={12} /> Add Reference
          </button>
        </div>

        {showAdd && (
          <div className="rounded-xl border border-blue-200 p-4 dark:border-blue-800">
            <div className="grid grid-cols-2 gap-3 mb-3">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                placeholder="Title"
              />
              <select
                value={newRefType}
                onChange={(e) => handleRefTypeChange(e.target.value)}
                className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="manual">Manual</option>
                <option value="tech-doc">Tech Doc</option>
                <option value="forum">Forum</option>
                <option value="wiki">Wiki</option>
                <option value="video">Video</option>
                <option value="config">Config File</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="relative mb-3">
              <input
                type="text"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                className="w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                placeholder={newRefType === 'config' ? 'URL or path (e.g., Google Drive link, C:\\configs\\...)' : 'URL'}
              />
              {newRefType === 'config' && defaultConfigLocation && newUrl !== defaultConfigLocation && (
                <button
                  onClick={() => setNewUrl(defaultConfigLocation)}
                  className="absolute right-1 top-1 rounded bg-teal-100 px-2 py-0.5 text-[10px] font-medium text-teal-700 hover:bg-teal-200 dark:bg-teal-900/30 dark:text-teal-300"
                  title={`Use default: ${defaultConfigLocation}`}
                >
                  Use default
                </button>
              )}
            </div>
            <input
              type="text"
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              className="mb-3 w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              placeholder={newRefType === 'config' ? "Config notes (e.g., 'v2.3 profile, IR codes for Sony TV')" : "Key notes (e.g., 'p23: master code reset')"}
            />
            <div className="flex gap-2">
              <button
                onClick={() => void handleAdd()}
                className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                <Save size={12} /> Add
              </button>
              <button
                onClick={() => setShowAdd(false)}
                className="flex items-center gap-1 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {refs.length === 0 && !showAdd && (
          <p className="py-6 text-center text-xs text-gray-400">No references yet.</p>
        )}

        {refs.map((ref) => (
          <div key={ref.id} className="group flex items-start gap-3 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
            <ExternalLink size={16} className="mt-0.5 shrink-0 text-gray-400" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <a
                  href={ref.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
                >
                  {ref.title}
                </a>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${REF_TYPE_COLORS[ref.refType] ?? REF_TYPE_COLORS.other}`}>
                  {REF_TYPE_LABELS[ref.refType] ?? ref.refType}
                </span>
              </div>
              {ref.notes && (
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{ref.notes}</p>
              )}
              <p className="mt-0.5 truncate text-xs text-gray-400 dark:text-gray-500">{ref.url}</p>
            </div>
            <button
              onClick={() => void handleDelete(ref)}
              className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
              title="Delete"
            >
              <Trash2 size={12} className="text-red-400 hover:text-red-600" />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Tab 4: Troubleshooting ──────────────────────────────────

function TroubleshootingTab({ productId }: { productId: string }) {
  const troubleshooting = useKnowledgeStore((s) => s.troubleshooting);
  const addTroubleshooting = useKnowledgeStore((s) => s.addTroubleshooting);
  const deleteTroubleshooting = useKnowledgeStore((s) => s.deleteTroubleshooting);
  const [dialogProps, confirm] = useConfirm();

  const entries = useMemo(
    () => troubleshooting.filter((t) => t.productId === productId),
    [troubleshooting, productId],
  );

  const [showAdd, setShowAdd] = useState(false);
  const [newIssue, setNewIssue] = useState('');
  const [newResolution, setNewResolution] = useState('');

  const handleAdd = async () => {
    if (!newIssue.trim()) return;
    await addTroubleshooting({
      productId,
      issue: newIssue,
      resolution: newResolution,
    });
    setNewIssue('');
    setNewResolution('');
    setShowAdd(false);
  };

  const handleDelete = async (entry: { id: string; issue: string }) => {
    const ok = await confirm({
      title: 'Delete entry?',
      message: 'Delete this troubleshooting entry?',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (ok) {
      await deleteTroubleshooting(entry.id);
    }
  };

  return (
    <>
      <ConfirmDialog {...dialogProps} />
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Past issues and resolutions — helps the AI recognize recurring problems.
          </p>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            <Plus size={12} /> Add Entry
          </button>
        </div>

        {showAdd && (
          <div className="rounded-xl border border-blue-200 p-4 dark:border-blue-800">
            <textarea
              rows={3}
              value={newIssue}
              onChange={(e) => setNewIssue(e.target.value)}
              className="mb-3 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              placeholder="Describe the issue..."
            />
            <textarea
              rows={3}
              value={newResolution}
              onChange={(e) => setNewResolution(e.target.value)}
              className="mb-3 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              placeholder="Describe the resolution..."
            />
            <div className="flex gap-2">
              <button
                onClick={() => void handleAdd()}
                className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                <Save size={12} /> Add
              </button>
              <button
                onClick={() => setShowAdd(false)}
                className="flex items-center gap-1 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {entries.length === 0 && !showAdd && (
          <p className="py-6 text-center text-xs text-gray-400">No troubleshooting history yet.</p>
        )}

        {entries.map((entry) => (
          <div key={entry.id} className="group rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="border-b border-gray-200 p-3 dark:border-gray-700">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold text-red-600 dark:text-red-400">
                  <Wrench size={12} /> Issue
                </div>
                <button
                  onClick={() => void handleDelete(entry)}
                  className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                  title="Delete"
                >
                  <Trash2 size={12} className="text-red-400 hover:text-red-600" />
                </button>
              </div>
              <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{entry.issue}</p>
            </div>
            <div className="p-3">
              <div className="text-xs font-semibold text-green-600 dark:text-green-400">Resolution</div>
              <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                {entry.resolution || '(no resolution recorded)'}
              </p>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── System Topology View ────────────────────────────────────

function TopologyView({ onSelectProduct }: { onSelectProduct: (id: string) => void }) {
  const topology = useKnowledgeStore((s) => s.topology);
  const products = useKnowledgeStore((s) => s.products);

  const getProductName = (id: string) => {
    const p = products.find((p) => p.id === id);
    return p ? p.name : id;
  };

  const getProductInstanceCount = (id: string) => {
    const p = products.find((p) => p.id === id);
    return p?.instanceCount ?? 0;
  };

  if (!topology) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-gray-400 dark:text-gray-500">
          No system topology defined yet. Import seed data to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Hub (center) */}
        <div className="flex flex-col items-center">
          <div className="rounded-xl border-2 border-blue-500 bg-blue-50 px-8 py-4 text-center dark:bg-blue-900/20">
            <div className="text-lg font-bold text-blue-700 dark:text-blue-300">{topology.hub.name}</div>
            <div className="text-sm text-blue-600 dark:text-blue-400">
              {topology.hub.firmware} · {topology.hub.ip}
            </div>
            <div className="mt-1 flex justify-center gap-1">
              {topology.hub.protocols.map((p) => (
                <span
                  key={p}
                  className="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-800 dark:text-blue-300"
                >
                  {p}
                </span>
              ))}
            </div>
          </div>
          <div className="h-4 w-px bg-gray-300 dark:bg-gray-600" />
        </div>

        {/* Protocol Groups */}
        <div className="grid gap-4">
          {topology.protocolGroups.map((group) => (
            <div
              key={group.protocol}
              className="rounded-xl border border-gray-200 dark:border-gray-700"
            >
              <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-700 dark:bg-gray-800/50">
                <Network size={16} className="text-gray-500" />
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  {group.label}
                </span>
              </div>
              <div className="p-4">
                <div className="flex flex-wrap gap-2">
                  {group.productIds.map((pid) => {
                    const count = getProductInstanceCount(pid);
                    return (
                      <button
                        key={pid}
                        onClick={() => onSelectProduct(pid)}
                        className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-blue-300 hover:bg-blue-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-blue-500 dark:hover:bg-blue-900/20"
                      >
                        <Package size={12} />
                        {getProductName(pid)}
                        {count > 1 && (
                          <span className="rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                            ×{count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {group.notes && (
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{group.notes}</p>
                )}
              </div>
            </div>
          ))}

          {/* External Systems */}
          {topology.externalSystems.map((ext) => (
            <div
              key={ext.name}
              className="rounded-xl border border-dashed border-gray-300 dark:border-gray-600"
            >
              <div className="flex items-center gap-2 border-b border-dashed border-gray-300 bg-gray-50/50 px-4 py-2 dark:border-gray-600 dark:bg-gray-800/30">
                <ExternalLink size={16} className="text-gray-400" />
                <span className="text-sm font-semibold text-gray-600 dark:text-gray-400">
                  {ext.name}
                </span>
                <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">
                  {ext.connectionPath}
                </span>
              </div>
              <div className="p-4">
                <div className="flex flex-wrap gap-2">
                  {ext.productIds.map((pid) => (
                    <button
                      key={pid}
                      onClick={() => onSelectProduct(pid)}
                      className="flex items-center gap-1.5 rounded-lg border border-dashed border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:border-blue-300 hover:bg-blue-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400 dark:hover:border-blue-500"
                    >
                      <Package size={12} />
                      {getProductName(pid)}
                    </button>
                  ))}
                </div>
                {ext.notes && (
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{ext.notes}</p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Narrative (for AI context preview) */}
        {topology.narrative && (
          <div className="rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-2 dark:border-gray-700">
              <BookOpen size={16} className="text-gray-500" />
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                AI Context Narrative
              </span>
            </div>
            <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap p-4 text-xs text-gray-600 dark:text-gray-400">
              {topology.narrative}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
