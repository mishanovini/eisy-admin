/**
 * KB Capture Settings — toggle switches for each capture channel,
 * AI research opt-in, and current KB size indicator.
 *
 * Rendered in the SettingsPage AI tab section.
 */
import { BookOpen, Sparkles } from 'lucide-react';
import { useKBCaptureStore } from '@/stores/kb-capture-store.ts';
import { useKnowledgeStore } from '@/stores/knowledge-store.ts';

function Toggle({
  checked,
  onChange,
  label,
  description,
  warning,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  warning?: string;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <div className="relative mt-0.5 flex-shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only peer"
        />
        <div className="h-5 w-9 rounded-full bg-gray-300 transition-colors peer-checked:bg-blue-500 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-300 dark:bg-gray-600 dark:peer-checked:bg-blue-600" />
        <div className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
      </div>
      <div className="min-w-0">
        <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{label}</span>
        {description && (
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{description}</p>
        )}
        {warning && (
          <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">{warning}</p>
        )}
      </div>
    </label>
  );
}

export function KBCaptureSettings() {
  const settings = useKBCaptureStore((s) => s.settings);
  const updateSettings = useKBCaptureStore((s) => s.updateSettings);
  const activeCount = useKBCaptureStore((s) => s.getActiveCount());

  // Calculate current KB size
  const loaded = useKnowledgeStore((s) => s.loaded);
  const exportAll = useKnowledgeStore((s) => s.exportAll);

  let kbSizeKB = 0;
  if (loaded) {
    try {
      const exported = exportAll();
      kbSizeKB = Math.round(new Blob([exported]).size / 1024);
    } catch {
      // ignore
    }
  }

  const sizePercent = Math.min(Math.round((kbSizeKB / 1024) * 100), 100);
  const sizeColor =
    sizePercent > 90 ? 'bg-red-500' :
    sizePercent > 70 ? 'bg-amber-500' : 'bg-blue-500';

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <BookOpen size={16} className="text-blue-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Auto-Capture
          </h3>
          {activeCount > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-100 px-1.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
              {activeCount}
            </span>
          )}
        </div>
        <Toggle
          checked={settings.enabled}
          onChange={(checked) => updateSettings({ enabled: checked })}
          label=""
        />
      </div>

      <div className={`space-y-4 p-4 ${!settings.enabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <Toggle
          checked={settings.captureNewDevices}
          onChange={(checked) => updateSettings({ captureNewDevices: checked })}
          label="Capture new devices"
          description="Automatically create KB entries when new devices are detected"
        />

        <Toggle
          checked={settings.captureSelfHealing}
          onChange={(checked) => updateSettings({ captureSelfHealing: checked })}
          label="Capture self-healing resolutions"
          description="Log resolved incidents as troubleshooting entries"
        />

        <Toggle
          checked={settings.captureErrorPatterns}
          onChange={(checked) => updateSettings({ captureErrorPatterns: checked })}
          label="Detect error patterns"
          description="Log recurring device errors as troubleshooting entries"
        />

        <Toggle
          checked={settings.aiErrorTroubleshooting}
          onChange={(checked) => updateSettings({ aiErrorTroubleshooting: checked })}
          label="AI error troubleshooting"
          description="Use AI to diagnose root causes, attempt fixes, and generate bug reports"
          warning={settings.aiErrorTroubleshooting ? 'Enabled — uses API tokens for diagnosis' : undefined}
        />

        <div className="border-t border-gray-100 pt-3 dark:border-gray-800">
          <Toggle
            checked={settings.useAIResearch}
            onChange={(checked) => updateSettings({ useAIResearch: checked })}
            label="AI device research"
            description="Use AI to research new devices and generate rich documentation"
            warning={settings.useAIResearch ? 'Enabled — uses API tokens for each new device' : undefined}
          />
        </div>

        {/* KB Size Indicator */}
        <div className="border-t border-gray-100 pt-3 dark:border-gray-800">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <Sparkles size={12} className="text-gray-400" />
              <span className="text-gray-500 dark:text-gray-400">KB Storage</span>
            </div>
            <span className="font-medium text-gray-700 dark:text-gray-300">
              {kbSizeKB} KB / 1,024 KB
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              className={`h-full rounded-full transition-all ${sizeColor}`}
              style={{ width: `${sizePercent}%` }}
            />
          </div>
          {sizePercent > 90 && (
            <p className="mt-1 text-[10px] text-red-500">
              KB near capacity — auto-capture will pause when full
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
