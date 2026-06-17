'use client';

import { useCallback, useEffect, useState } from 'react';
import { Zap, Save, FlaskConical, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/useToast';

type DryRunRow = {
  customerName: string;
  wouldAutoProcess: boolean;
  viaOptovik: boolean;
  matchedAdminPatterns: string[];
};

export default function AutoProcessTab() {
  const { showSuccess, showError } = useToast();
  const [text, setText] = useState('');
  const [sampleText, setSampleText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dryRunning, setDryRunning] = useState(false);
  const [dryRows, setDryRows] = useState<DryRunRow[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/auto-process-customers', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Ошибка загрузки');
      setText(typeof data.text === 'string' ? data.text : (data.patterns ?? []).join('\n'));
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Ошибка', 3500);
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/auto-process-customers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Ошибка сохранения');
      setText(data.text ?? text);
      showSuccess('Список сохранён', 2200);
      setDryRows(null);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Ошибка', 3500);
    } finally {
      setSaving(false);
    }
  };

  const handleDryRun = async () => {
    setDryRunning(true);
    setDryRows(null);
    try {
      const res = await fetch('/api/admin/auto-process-customers/dry-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patternsText: text,
          customerNamesText: sampleText,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Ошибка dry-run');
      setDryRows(data.rows ?? []);
      showSuccess(
        `Dry-run: ${data.summary?.wouldProcess ?? 0} из ${data.summary?.total ?? 0} попали бы в автопроведение`,
        3000
      );
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Ошибка', 3500);
    } finally {
      setDryRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
        <Loader2 className="w-6 h-6 animate-spin" />
        Загрузка…
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-xl bg-amber-500/20 border border-amber-500/40">
          <Zap className="w-8 h-8 text-amber-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-100">Автопроведение</h2>
          <p className="text-sm text-slate-400 mt-1 max-w-3xl">
            При приёме заказа из 1С (POST /api/shipments) для подходящих клиентов заказ сразу переводится в
            «processed»: позиции как собранные и подтверждённые, без ручной сборки и проверки на складе.
          </p>
          <p className="text-sm text-amber-200/80 mt-2">
            Всегда включено: если в имени клиента есть подстрока <strong>ОПТОВИК</strong> (как раньше).
            Ниже — дополнительные клиенты: по одному полному имени на строку (точное совпадение, без учёта регистра, Ё→Е).
          </p>
        </div>
      </div>

      <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-5">
        <label className="block text-sm font-medium text-slate-300 mb-2">Дополнительные клиенты (точное совпадение имени)</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          placeholder={'Например:\nООО РОЗНИЦА\nИП ИВАНОВ'}
          className="w-full font-mono text-sm px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-amber-500/40 resize-y min-h-[180px]"
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Сохранить
          </button>
        </div>
      </div>

      <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-5">
        <div className="flex items-center gap-2 mb-2">
          <FlaskConical className="w-5 h-5 text-teal-400" />
          <h3 className="text-lg font-semibold text-slate-100">Dry-run</h3>
        </div>
        <p className="text-sm text-slate-400 mb-3">
          Введите примеры имён клиентов (как в 1С), по одному на строку. Проверка идёт по тексту в поле выше
          (можно не сохранять — удобно проверить перед сохранением).
        </p>
        <textarea
          value={sampleText}
          onChange={(e) => setSampleText(e.target.value)}
          rows={6}
          placeholder="Иванов ИП\nООО ОПТОВИК-ЮГ"
          className="w-full font-mono text-sm px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-teal-500/40 resize-y mb-3"
        />
        <button
          type="button"
          disabled={dryRunning}
          onClick={() => void handleDryRun()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white font-medium disabled:opacity-50"
        >
          {dryRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
          Запустить dry-run
        </button>

        {dryRows && dryRows.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-600">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-900/80 text-left text-slate-400">
                  <th className="px-3 py-2">Имя клиента</th>
                  <th className="px-3 py-2">Автопроведение</th>
                  <th className="px-3 py-2">ОПТОВИК</th>
                  <th className="px-3 py-2">Совпадения из списка</th>
                </tr>
              </thead>
              <tbody>
                {dryRows.map((r, i) => (
                  <tr key={i} className="border-t border-slate-700/60">
                    <td className="px-3 py-2 text-slate-200 max-w-xs truncate" title={r.customerName}>
                      {r.customerName}
                    </td>
                    <td className="px-3 py-2">
                      {r.wouldAutoProcess ? (
                        <span className="text-teal-400 font-medium">да</span>
                      ) : (
                        <span className="text-slate-500">нет</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{r.viaOptovik ? <span className="text-amber-400">да</span> : '—'}</td>
                    <td className="px-3 py-2 text-slate-300">
                      {r.matchedAdminPatterns.length ? r.matchedAdminPatterns.join(', ') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
