/**
 * Notification Settings — SMTP email configuration, notification profiles,
 * and SMS-via-email gateway setup for the eisy smart home controller.
 *
 * SOAP operations used:
 *   - GetSMTPConfig  (read current SMTP settings)
 *   - SetSMTPConfig  (save SMTP settings)
 *   - SendTestEmail  (send a test email)
 *
 * NOTE: These SOAP actions are not yet wired in src/api/soap.ts.
 *       They must be added to that module before this component will
 *       communicate with a live eisy controller.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Mail,
  Send,
  Phone,
  Settings,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ChevronDown,
  HelpCircle,
  Shield,
  Plus,
  Trash2,
} from 'lucide-react';
import { soapCall } from '@/api/client.ts';
import { SOAP_SERVICE } from '@/api/types.ts';

// ─── Types ───────────────────────────────────────────────────────

interface SMTPConfig {
  server: string;
  port: string;
  username: string;
  password: string;
  from: string;
  timeout: string;
  useTLS: boolean;
}

interface NotificationProfile {
  id: string;
  name: string;
  email: string;
}

type FeedbackStatus = 'idle' | 'loading' | 'success' | 'error';

interface Feedback {
  status: FeedbackStatus;
  message: string;
}

// ─── Constants ───────────────────────────────────────────────────

const SMTP_PRESETS: {
  label: string;
  server: string;
  port: string;
  tls: boolean;
  note?: string;
}[] = [
  { label: 'Gmail', server: 'smtp.gmail.com', port: '587', tls: true, note: 'Requires an App Password (see guide below)' },
  { label: 'Outlook / Office 365', server: 'smtp.office365.com', port: '587', tls: true },
  { label: 'Yahoo', server: 'smtp.mail.yahoo.com', port: '587', tls: true },
  { label: 'Custom', server: '', port: '', tls: false },
];

const SMS_CARRIERS: { label: string; gateway: string }[] = [
  { label: 'AT&T', gateway: 'txt.att.net' },
  { label: 'T-Mobile', gateway: 'tmomail.net' },
  { label: 'Verizon', gateway: 'vtext.com' },
  { label: 'Sprint', gateway: 'messaging.sprintpcs.com' },
  { label: 'US Cellular', gateway: 'email.uscc.net' },
  { label: 'Cricket', gateway: 'sms.cricketwireless.net' },
  { label: 'Boost Mobile', gateway: 'sms.myboostmobile.com' },
  { label: 'Metro PCS', gateway: 'mymetropcs.com' },
];

const DEFAULT_SMTP: SMTPConfig = {
  server: '',
  port: '587',
  username: '',
  password: '',
  from: '',
  timeout: '30',
  useTLS: true,
};

// ─── Helpers ─────────────────────────────────────────────────────

/** Extract a text value from an XML tag within raw SOAP response */
function extractXmlValue(raw: string, tag: string): string {
  const re = new RegExp(`<${tag}>([^<]*)</${tag}>`);
  const m = raw.match(re);
  return m?.[1] ?? '';
}

/** Format a US phone number (digits only) */
function cleanPhone(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 10);
}

/** Format phone for display: (123) 456-7890 */
function formatPhone(digits: string): string {
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** Generate a simple unique ID */
function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ─── Input class constants ───────────────────────────────────────

const INPUT_CLS =
  'w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:focus:border-blue-500 dark:focus:ring-blue-500';

const INPUT_CLS_SM =
  'w-full max-w-sm rounded border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:focus:border-blue-500 dark:focus:ring-blue-500';

const BTN_PRIMARY =
  'flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50';

const BTN_SUCCESS =
  'flex items-center gap-1.5 rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50';

const BTN_OUTLINE =
  'flex items-center gap-1.5 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800 disabled:opacity-50';


// ═══════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════

export function NotificationSettings() {
  // ── SMTP State ──
  const [smtp, setSmtp] = useState<SMTPConfig>(DEFAULT_SMTP);
  const [presetIdx, setPresetIdx] = useState<number>(-1);
  const [showPassword, setShowPassword] = useState(false);
  const [smtpFeedback, setSmtpFeedback] = useState<Feedback>({ status: 'idle', message: '' });
  const [testFeedback, setTestFeedback] = useState<Feedback>({ status: 'idle', message: '' });
  const [loadingConfig, setLoadingConfig] = useState(true);

  // ── Notification Profiles State ──
  const [profiles, setProfiles] = useState<NotificationProfile[]>([]);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileEmail, setNewProfileEmail] = useState('');
  const [profileFeedback, setProfileFeedback] = useState<Feedback>({ status: 'idle', message: '' });

  // ── SMS Gateway State ──
  const [smsCarrierIdx, setSmsCarrierIdx] = useState<number>(0);
  const [smsPhone, setSmsPhone] = useState('');
  const [smsProfileName, setSmsProfileName] = useState('');

  // ── Help Section State ──
  const [helpOpen, setHelpOpen] = useState(false);

  // ── Load SMTP config on mount ──
  const loadSmtpConfig = useCallback(async () => {
    setLoadingConfig(true);
    try {
      const resp = await soapCall('GetSMTPConfig', SOAP_SERVICE.INSTEON, '');
      if (resp.ok && resp.raw) {
        const raw = resp.raw;
        setSmtp({
          server: extractXmlValue(raw, 'SMTPServer') || extractXmlValue(raw, 'host') || '',
          port: extractXmlValue(raw, 'Port') || extractXmlValue(raw, 'port') || '587',
          username: extractXmlValue(raw, 'UID') || extractXmlValue(raw, 'uid') || '',
          password: extractXmlValue(raw, 'PWD') || extractXmlValue(raw, 'pwd') || '',
          from: extractXmlValue(raw, 'From') || extractXmlValue(raw, 'from') || '',
          timeout: extractXmlValue(raw, 'Timeout') || extractXmlValue(raw, 'timeout') || '30',
          useTLS: (extractXmlValue(raw, 'UseTLS') || extractXmlValue(raw, 'tls') || '1') === '1',
        });
      }
    } catch {
      // Config might not exist yet — leave defaults
    }
    setLoadingConfig(false);
  }, []);

  const loadProfiles = useCallback(async () => {
    // Try to load notification profiles from the NOTIF.CFG via REST
    try {
      const resp = await soapCall('GetSMTPConfig', SOAP_SERVICE.INSTEON, '');
      // Notification profiles may also be in the SMTP config response
      // or loaded separately. For now we parse what we get.
      if (resp.ok && resp.raw) {
        const profileRegex = /<notification>([\s\S]*?)<\/notification>/g;
        const parsed: NotificationProfile[] = [];
        let match: RegExpExecArray | null;
        while ((match = profileRegex.exec(resp.raw)) !== null) {
          const xml = match[1]!;
          const name = extractXmlValue(xml, 'name');
          const email = extractXmlValue(xml, 'email') || extractXmlValue(xml, 'address');
          const id = extractXmlValue(xml, 'id') || uid();
          if (name || email) {
            parsed.push({ id, name: name || email, email: email || '' });
          }
        }
        if (parsed.length > 0) {
          setProfiles(parsed);
        }
      }
    } catch {
      // Profiles may not be available yet
    }
  }, []);

  useEffect(() => {
    loadSmtpConfig();
    loadProfiles();
  }, [loadSmtpConfig, loadProfiles]);

  // ── SMTP Handlers ──

  const handlePresetChange = (idx: number) => {
    setPresetIdx(idx);
    if (idx >= 0 && idx < SMTP_PRESETS.length) {
      const preset = SMTP_PRESETS[idx]!;
      if (preset.server) {
        setSmtp((prev) => ({
          ...prev,
          server: preset.server,
          port: preset.port,
          useTLS: preset.tls,
        }));
      }
    }
  };

  const handleSaveSMTP = async () => {
    setSmtpFeedback({ status: 'loading', message: 'Saving SMTP configuration...' });
    try {
      const innerXml = `
        <SMTPServer>${smtp.server}</SMTPServer>
        <Port>${smtp.port}</Port>
        <UID>${smtp.username}</UID>
        <PWD>${smtp.password}</PWD>
        <From>${smtp.from}</From>
        <Timeout>${smtp.timeout}</Timeout>
        <UseTLS>${smtp.useTLS ? '1' : '0'}</UseTLS>`;

      const resp = await soapCall('SetSMTPConfig', SOAP_SERVICE.INSTEON, innerXml);
      if (resp.ok) {
        setSmtpFeedback({ status: 'success', message: 'SMTP configuration saved successfully.' });
      } else {
        setSmtpFeedback({
          status: 'error',
          message: resp.error || `Failed to save (HTTP ${resp.status}).`,
        });
      }
    } catch (err) {
      setSmtpFeedback({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unexpected error saving SMTP config.',
      });
    }
    setTimeout(() => setSmtpFeedback({ status: 'idle', message: '' }), 5000);
  };

  const handleTestEmail = async () => {
    setTestFeedback({ status: 'loading', message: 'Sending test email...' });
    try {
      const resp = await soapCall('SendTestEmail', SOAP_SERVICE.INSTEON, '');
      if (resp.ok) {
        setTestFeedback({ status: 'success', message: 'Test email sent. Check your inbox.' });
      } else {
        setTestFeedback({
          status: 'error',
          message: resp.error || `Test email failed (HTTP ${resp.status}).`,
        });
      }
    } catch (err) {
      setTestFeedback({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unexpected error sending test email.',
      });
    }
    setTimeout(() => setTestFeedback({ status: 'idle', message: '' }), 5000);
  };

  // ── Profile Handlers ──

  const handleAddProfile = () => {
    if (!newProfileName.trim() || !newProfileEmail.trim()) {
      setProfileFeedback({ status: 'error', message: 'Name and email are required.' });
      setTimeout(() => setProfileFeedback({ status: 'idle', message: '' }), 3000);
      return;
    }
    const profile: NotificationProfile = {
      id: uid(),
      name: newProfileName.trim(),
      email: newProfileEmail.trim(),
    };
    setProfiles((prev) => [...prev, profile]);
    setNewProfileName('');
    setNewProfileEmail('');
    setProfileFeedback({ status: 'success', message: `Profile "${profile.name}" added.` });
    setTimeout(() => setProfileFeedback({ status: 'idle', message: '' }), 3000);
  };

  const handleDeleteProfile = (id: string) => {
    setProfiles((prev) => prev.filter((p) => p.id !== id));
  };

  // ── SMS Gateway Handlers ──

  const smsEmail =
    smsPhone.length === 10 && smsCarrierIdx >= 0
      ? `${smsPhone}@${SMS_CARRIERS[smsCarrierIdx]!.gateway}`
      : '';

  const handleAddSmsProfile = () => {
    if (!smsEmail) return;
    const name = smsProfileName.trim() || `SMS ${formatPhone(smsPhone)}`;
    const profile: NotificationProfile = {
      id: uid(),
      name,
      email: smsEmail,
    };
    setProfiles((prev) => [...prev, profile]);
    setSmsPhone('');
    setSmsProfileName('');
    setProfileFeedback({ status: 'success', message: `SMS profile "${name}" added.` });
    setTimeout(() => setProfileFeedback({ status: 'idle', message: '' }), 3000);
  };

  // ── Render ──

  return (
    <div className="space-y-6">
      {/* ─── SMTP Configuration ─────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <Mail size={16} className="text-blue-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            SMTP Email Configuration
          </h3>
        </div>

        <div className="space-y-4 p-4">
          {loadingConfig ? (
            <div className="flex items-center gap-2 py-4 text-sm text-gray-500 dark:text-gray-400">
              <Loader2 size={16} className="animate-spin" />
              Loading SMTP configuration...
            </div>
          ) : (
            <>
              {/* Provider Preset */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Provider Preset
                </label>
                <select
                  value={presetIdx}
                  onChange={(e) => handlePresetChange(Number(e.target.value))}
                  className={INPUT_CLS_SM}
                >
                  <option value={-1}>Select a provider...</option>
                  {SMTP_PRESETS.map((p, i) => (
                    <option key={p.label} value={i}>
                      {p.label}
                    </option>
                  ))}
                </select>
                {presetIdx >= 0 && SMTP_PRESETS[presetIdx]?.note && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                    <AlertCircle size={12} />
                    {SMTP_PRESETS[presetIdx]!.note}
                  </p>
                )}
              </div>

              {/* SMTP Server + Port */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    SMTP Server
                  </label>
                  <input
                    type="text"
                    value={smtp.server}
                    onChange={(e) => setSmtp((s) => ({ ...s, server: e.target.value }))}
                    placeholder="smtp.example.com"
                    className={INPUT_CLS}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Port
                  </label>
                  <input
                    type="text"
                    value={smtp.port}
                    onChange={(e) => setSmtp((s) => ({ ...s, port: e.target.value }))}
                    placeholder="587"
                    className={INPUT_CLS}
                  />
                </div>
              </div>

              {/* Username + Password */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Username
                  </label>
                  <input
                    type="text"
                    value={smtp.username}
                    onChange={(e) => setSmtp((s) => ({ ...s, username: e.target.value }))}
                    placeholder="user@example.com"
                    className={INPUT_CLS}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={smtp.password}
                      onChange={(e) => setSmtp((s) => ({ ...s, password: e.target.value }))}
                      placeholder="App password or SMTP password"
                      className={INPUT_CLS}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
              </div>

              {/* From Address */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  From Address
                </label>
                <input
                  type="email"
                  value={smtp.from}
                  onChange={(e) => setSmtp((s) => ({ ...s, from: e.target.value }))}
                  placeholder="eisy@example.com"
                  className={INPUT_CLS_SM}
                />
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  The sender address shown in notification emails.
                </p>
              </div>

              {/* TLS + Timeout row */}
              <div className="flex flex-wrap items-end gap-6">
                <div className="flex items-center gap-2">
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input
                      type="checkbox"
                      checked={smtp.useTLS}
                      onChange={(e) => setSmtp((s) => ({ ...s, useTLS: e.target.checked }))}
                      className="peer sr-only"
                    />
                    <div className="h-5 w-9 rounded-full bg-gray-300 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:bg-blue-600 peer-checked:after:translate-x-full dark:bg-gray-600 dark:peer-checked:bg-blue-500" />
                  </label>
                  <span className="text-sm text-gray-700 dark:text-gray-300">Use TLS</span>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Timeout (seconds)
                  </label>
                  <input
                    type="number"
                    min="5"
                    max="120"
                    value={smtp.timeout}
                    onChange={(e) => setSmtp((s) => ({ ...s, timeout: e.target.value }))}
                    className="w-24 rounded border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4 dark:border-gray-700/50">
                <button onClick={handleSaveSMTP} disabled={smtpFeedback.status === 'loading'} className={BTN_SUCCESS}>
                  {smtpFeedback.status === 'loading' ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : smtpFeedback.status === 'success' ? (
                    <CheckCircle2 size={14} />
                  ) : (
                    <Settings size={14} />
                  )}
                  {smtpFeedback.status === 'success' ? 'Saved!' : 'Save SMTP Settings'}
                </button>

                <button
                  onClick={handleTestEmail}
                  disabled={!smtp.server || testFeedback.status === 'loading'}
                  className={BTN_OUTLINE}
                >
                  {testFeedback.status === 'loading' ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Send size={14} />
                  )}
                  Test Connection
                </button>
              </div>

              {/* SMTP Feedback */}
              <FeedbackBanner feedback={smtpFeedback} />
              <FeedbackBanner feedback={testFeedback} />
            </>
          )}
        </div>
      </div>

      {/* ─── Notification Profiles ──────────────────────────── */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <Mail size={16} className="text-green-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Notification Profiles
          </h3>
          <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 dark:bg-gray-700 dark:text-gray-400">
            {profiles.length}
          </span>
        </div>

        <div className="space-y-4 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Notification profiles define where the eisy sends email alerts when a program triggers
            a notify action. Each profile stores a name and one or more email addresses.
          </p>

          {/* Existing profiles */}
          {profiles.length > 0 && (
            <div className="space-y-2">
              {profiles.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800/50"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {p.name}
                    </div>
                    <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                      {p.email}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteProfile(p.id)}
                    className="ml-2 flex-shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                    title="Delete profile"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {profiles.length === 0 && (
            <div className="rounded-lg border border-dashed border-gray-300 py-6 text-center text-sm text-gray-400 dark:border-gray-600 dark:text-gray-500">
              No notification profiles yet. Add one below.
            </div>
          )}

          {/* Add new profile */}
          <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-3 dark:border-gray-700 dark:bg-gray-800/30">
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400">
              <Plus size={12} /> Add Profile
            </h4>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
              <div className="sm:col-span-2">
                <input
                  type="text"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  placeholder="Profile name (e.g. Email Misha)"
                  className={INPUT_CLS}
                />
              </div>
              <div className="sm:col-span-2">
                <input
                  type="email"
                  value={newProfileEmail}
                  onChange={(e) => setNewProfileEmail(e.target.value)}
                  placeholder="email@example.com"
                  className={INPUT_CLS}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddProfile();
                  }}
                />
              </div>
              <div>
                <button
                  onClick={handleAddProfile}
                  disabled={!newProfileName.trim() || !newProfileEmail.trim()}
                  className={BTN_PRIMARY + ' w-full justify-center py-2'}
                >
                  <Plus size={14} /> Add
                </button>
              </div>
            </div>
          </div>

          <FeedbackBanner feedback={profileFeedback} />
        </div>
      </div>

      {/* ─── SMS via Email Gateway ──────────────────────────── */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <Phone size={16} className="text-purple-500" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            SMS via Email Gateway
          </h3>
        </div>

        <div className="space-y-4 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Most US carriers offer an email-to-SMS gateway. Send an email to a special address and
            it arrives as a text message. Select your carrier and enter the phone number to
            auto-generate the gateway address.
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Carrier */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Carrier
              </label>
              <select
                value={smsCarrierIdx}
                onChange={(e) => setSmsCarrierIdx(Number(e.target.value))}
                className={INPUT_CLS}
              >
                {SMS_CARRIERS.map((c, i) => (
                  <option key={c.gateway} value={i}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Phone number */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Phone Number
              </label>
              <input
                type="tel"
                value={formatPhone(smsPhone)}
                onChange={(e) => setSmsPhone(cleanPhone(e.target.value))}
                placeholder="(555) 123-4567"
                className={INPUT_CLS}
              />
            </div>
          </div>

          {/* Generated gateway address */}
          {smsEmail && (
            <div className="rounded-lg border border-purple-200 bg-purple-50 p-3 dark:border-purple-800 dark:bg-purple-900/20">
              <div className="mb-1 text-xs font-medium text-purple-700 dark:text-purple-300">
                Gateway Email Address
              </div>
              <code className="block break-all text-sm font-mono text-purple-900 dark:text-purple-200">
                {smsEmail}
              </code>
            </div>
          )}

          {/* Profile name + add button */}
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Profile Name (optional)
              </label>
              <input
                type="text"
                value={smsProfileName}
                onChange={(e) => setSmsProfileName(e.target.value)}
                placeholder={smsPhone ? `SMS ${formatPhone(smsPhone)}` : 'SMS Profile Name'}
                className={INPUT_CLS}
              />
            </div>
            <button
              onClick={handleAddSmsProfile}
              disabled={!smsEmail}
              className={BTN_PRIMARY + ' py-2'}
            >
              <Plus size={14} /> Add as Notification Profile
            </button>
          </div>
        </div>
      </div>

      {/* ─── Setup Guide / Help ─────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setHelpOpen(!helpOpen)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left"
        >
          <HelpCircle size={16} className="text-amber-500" />
          <h3 className="flex-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
            Setup Guide & Help
          </h3>
          <ChevronDown
            size={16}
            className={`text-gray-400 transition-transform ${helpOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {helpOpen && (
          <div className="space-y-4 border-t border-gray-200 p-4 dark:border-gray-700">
            {/* How notifications work */}
            <HelpSection
              icon={<Mail size={14} className="text-blue-500" />}
              title="How Notifications Work"
            >
              <p>
                The eisy controller has a built-in SMTP email client. When a program&apos;s THEN or
                ELSE clause includes a <strong>Notify</strong> action, the eisy sends an email to the
                configured notification profile(s).
              </p>
              <p>
                You must configure the SMTP server above so the eisy can authenticate with your email
                provider. Then create notification profiles with the recipient email addresses. Finally,
                add a <code className="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-700">Notify</code> action
                in your programs to trigger the email.
              </p>
            </HelpSection>

            {/* Gmail App Password */}
            <HelpSection
              icon={<Shield size={14} className="text-red-500" />}
              title="Gmail App Password Setup"
            >
              <p>
                Gmail blocks sign-ins from apps that use only a username and password. You need to
                generate an <strong>App Password</strong> specifically for the eisy.
              </p>
              <ol className="ml-4 list-decimal space-y-1">
                <li>
                  Go to your Google Account &rarr; <strong>Security</strong> &rarr;{' '}
                  <strong>2-Step Verification</strong> (must be enabled first).
                </li>
                <li>
                  At the bottom of the 2-Step Verification page, select <strong>App passwords</strong>.
                </li>
                <li>
                  Enter a name like &quot;eisy Controller&quot; and click <strong>Create</strong>.
                </li>
                <li>
                  Copy the 16-character password and paste it into the <strong>Password</strong> field
                  above. Do not use your regular Gmail password.
                </li>
              </ol>
            </HelpSection>

            {/* Using notifications in programs */}
            <HelpSection
              icon={<Settings size={14} className="text-green-500" />}
              title="Using Notifications in Programs"
            >
              <p>To send a notification from a program:</p>
              <ol className="ml-4 list-decimal space-y-1">
                <li>
                  Open the program editor and go to the <strong>THEN</strong> or <strong>ELSE</strong>{' '}
                  actions section.
                </li>
                <li>
                  Add a <strong>Send Notification</strong> action.
                </li>
                <li>Select the notification profile(s) to receive the email.</li>
                <li>Optionally customize the message subject and body.</li>
              </ol>
              <p>
                The eisy will send the email immediately when the program&apos;s THEN or ELSE clause
                executes and reaches the notify action.
              </p>
            </HelpSection>

            {/* SMS limitations */}
            <HelpSection
              icon={<Phone size={14} className="text-purple-500" />}
              title="SMS via Email Limitations"
            >
              <ul className="ml-4 list-disc space-y-1">
                <li>
                  SMS delivery depends on the carrier&apos;s email-to-SMS gateway. Delivery is not
                  guaranteed and may have delays of several minutes.
                </li>
                <li>
                  Messages are limited to 160 characters. Longer messages may be truncated or split.
                </li>
                <li>
                  Some carriers may charge standard text message rates for received gateway messages.
                </li>
                <li>
                  MMS (picture messages) is not supported through this gateway method.
                </li>
                <li>
                  If the carrier changes or discontinues their gateway, notifications will stop
                  working without any error from the eisy.
                </li>
              </ul>
            </HelpSection>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════

/** Inline feedback banner for success/error messages */
function FeedbackBanner({ feedback }: { feedback: Feedback }) {
  if (feedback.status === 'idle' || !feedback.message) return null;

  const isError = feedback.status === 'error';
  const isSuccess = feedback.status === 'success';

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border p-2.5 text-xs ${
        isError
          ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400'
          : isSuccess
            ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400'
            : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400'
      }`}
    >
      {isError ? (
        <AlertCircle size={14} className="flex-shrink-0" />
      ) : isSuccess ? (
        <CheckCircle2 size={14} className="flex-shrink-0" />
      ) : (
        <Loader2 size={14} className="flex-shrink-0 animate-spin" />
      )}
      {feedback.message}
    </div>
  );
}

/** Collapsible help sub-section */
function HelpSection({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        {icon}
        <span className="flex-1 text-sm font-medium text-gray-800 dark:text-gray-200">
          {title}
        </span>
        <ChevronDown
          size={14}
          className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="space-y-2 border-t border-gray-100 px-3 pb-3 pt-2 text-xs leading-relaxed text-gray-600 dark:border-gray-700/50 dark:text-gray-400">
          {children}
        </div>
      )}
    </div>
  );
}
