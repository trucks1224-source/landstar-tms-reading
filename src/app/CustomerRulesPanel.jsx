// ⚙ Rules window for one customer (Daniel 2026-11-27): anyone sets their own customer's rules
// here, with no code: equipment the import keeps, the 2nd equipment on Landstar, where the rate
// comes from, fixed lane rates, and which Excel column is which for this customer's files.
import { useState } from 'react';
import * as XLSX from 'xlsx';
import {
  normalizeCustomerRules, EQUIPMENT_FAMILIES, EQUIPMENT2_CHOICES, RATE_SOURCES, EXCEL_FIELDS
} from './customerRules.js';

const input = 'bg-[#0b132b] border border-[#1c2541] rounded px-2 py-1 text-xs text-white';
const blankLane = { origCity: '', origSt: '', destCity: '', destSt: '', rate: '' };

export default function CustomerRulesPanel({ customer, rules, onSave, onClose }) {
  const [draft, setDraft] = useState(() => {
    const start = normalizeCustomerRules(rules);
    return { ...start, laneRates: start.laneRates.map(lane => ({ ...lane, rate: String(lane.rate) })) };
  });
  const [headers, setHeaders] = useState(() => [...new Set(Object.values(normalizeCustomerRules(rules).excelColumns))]);
  const [fileNote, setFileNote] = useState('');
  const set = (field, value) => setDraft(current => ({ ...current, [field]: value }));

  const toggleFamily = id => set('importEquipment', draft.importEquipment.includes(id)
    ? draft.importEquipment.filter(item => item !== id)
    : [...draft.importEquipment, id]);

  const setLane = (index, field, value) => set('laneRates', draft.laneRates.map((lane, at) => (at === index ? { ...lane, [field]: value } : lane)));

  // Reads the column names (first row) of a sample file in this customer's layout.
  const readSample = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
      const first = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 })[0] || [];
      const names = first.map(cell => String(cell ?? '').trim()).filter(Boolean);
      if (!names.length) { setFileNote('That file has no column names in its first row.'); return; }
      setHeaders(names);
      // Pre-match columns whose names look like the field.
      const guess = {
        loadId: /load|order|ref|pro\b|shipment/i, equipment: /equip|trailer|mode/i, origCity: /(origin|orig|pick|ship\s*from|from).*city|^origin$/i,
        origSt: /(origin|orig|pick|ship\s*from|from).*(state|st\b)/i, origZip: /(origin|orig|pick|from).*zip/i,
        destCity: /(dest|deliver|consignee|ship\s*to|to).*city|^destination$/i, destSt: /(dest|deliver|consignee|ship\s*to|to).*(state|st\b)/i,
        destZip: /(dest|deliver|consignee|to).*zip/i, pickup: /pick.*(date|time|dt)|ship\s*date|pu\b/i, delivery: /deliv.*(date|time|dt)|del\b/i,
        weight: /weight|wgt|lbs/i, miles: /mile|distance/i, rate: /rate|pay|price|amount|\$/i
      };
      setDraft(current => {
        const columns = { ...current.excelColumns };
        for (const [field, pattern] of Object.entries(guess)) {
          if (!columns[field] || !names.includes(columns[field])) {
            const match = names.find(name => pattern.test(name));
            if (match) columns[field] = match; else delete columns[field];
          }
        }
        return { ...current, excelColumns: columns };
      });
      setFileNote(`Read ${names.length} columns from ${file.name}. Check each match below.`);
    } catch (error) {
      setFileNote(`Could not read that file: ${error.message}`);
    }
  };

  const save = () => onSave(normalizeCustomerRules(draft));

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" role="dialog" aria-label={`Rules for ${customer}`}>
      <div className="w-[44rem] max-w-full max-h-[88vh] overflow-y-auto bg-[#121829] border border-slate-500 rounded-lg shadow-2xl p-4 normal-case tracking-normal text-left text-white">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-bold">⚙ Rules for {customer}</h2>
          <button type="button" onClick={onClose} className="text-gray-300 hover:text-white text-sm px-2 cursor-pointer" aria-label="Close rules">✕</button>
        </div>
        <p className="text-[11px] text-gray-400 mb-3">These apply to your Excel imports and Landstar exports for this customer. Leave a setting as it is to keep the TMS's usual behavior.</p>

        <section className="mb-4">
          <h3 className="text-xs font-bold text-gray-200 mb-1">Import only this equipment</h3>
          <div className="flex flex-wrap gap-3 text-xs">
            {EQUIPMENT_FAMILIES.map(([id, label]) => (
              <label key={id} className="flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={draft.importEquipment.includes(id)} onChange={() => toggleFamily(id)} className="accent-blue-600" />
                {label}
              </label>
            ))}
          </div>
          <p className="text-[10px] text-gray-500 mt-1">{draft.importEquipment.length ? 'Loads with any other equipment are left out of imports.' : 'Nothing checked: every load is imported.'}</p>
        </section>

        <section className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-xs">
            <span className="block font-bold text-gray-200 mb-1">2nd equipment on Landstar</span>
            <select value={draft.equipment2} onChange={event => set('equipment2', event.target.value)} className={`${input} w-full`}>
              {EQUIPMENT2_CHOICES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <label className="text-xs">
            <span className="block font-bold text-gray-200 mb-1">Rate to post</span>
            <select value={draft.rateSource} onChange={event => set('rateSource', event.target.value)} className={`${input} w-full`}>
              {RATE_SOURCES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
        </section>

        <section className="mb-4">
          <h3 className="text-xs font-bold text-gray-200 mb-1">Fixed lane rates <span className="font-normal text-gray-500">(always used for these lanes; leave a city empty for the whole state)</span></h3>
          {draft.laneRates.map((lane, index) => (
            <div key={index} className="flex items-center gap-1 mb-1">
              <input value={lane.origCity} onChange={event => setLane(index, 'origCity', event.target.value)} placeholder="Origin city" aria-label="Origin city" className={`${input} w-32`} />
              <input value={lane.origSt} onChange={event => setLane(index, 'origSt', event.target.value)} placeholder="ST" aria-label="Origin state" maxLength={2} className={`${input} w-12 uppercase`} />
              <span className="text-gray-500">→</span>
              <input value={lane.destCity} onChange={event => setLane(index, 'destCity', event.target.value)} placeholder="Destination city" aria-label="Destination city" className={`${input} w-32`} />
              <input value={lane.destSt} onChange={event => setLane(index, 'destSt', event.target.value)} placeholder="ST" aria-label="Destination state" maxLength={2} className={`${input} w-12 uppercase`} />
              <input value={lane.rate} onChange={event => setLane(index, 'rate', event.target.value)} placeholder="$ rate" aria-label="Rate" className={`${input} w-20`} />
              <button type="button" onClick={() => set('laneRates', draft.laneRates.filter((_, at) => at !== index))} className="text-red-300 hover:text-white text-xs px-1 cursor-pointer" aria-label="Remove lane">✕</button>
            </div>
          ))}
          <button type="button" onClick={() => set('laneRates', [...draft.laneRates, { ...blankLane }])} className="text-xs text-sky-300 hover:text-white cursor-pointer">+ Add a lane</button>
        </section>

        <section className="mb-4">
          <h3 className="text-xs font-bold text-gray-200 mb-1">Excel columns for this customer's files</h3>
          <p className="text-[10px] text-gray-500 mb-1">Only needed when this customer's spreadsheets don't import right. Pick one of their files: the TMS reads its column names, then you say which column is which. Every later file in that layout imports by itself.</p>
          <label className="inline-block text-xs bg-slate-700 hover:bg-slate-600 rounded px-2 py-1 cursor-pointer mb-1">
            📂 Choose a sample file
            <input type="file" accept=".xlsx, .xls, .ods, .csv" onChange={readSample} className="hidden" />
          </label>
          {fileNote && <span className="text-[11px] text-sky-300 ml-2">{fileNote}</span>}
          {headers.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 mt-1">
              {EXCEL_FIELDS.map(([field, label]) => (
                <label key={field} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-gray-300">{label}</span>
                  <select
                    value={draft.excelColumns[field] || ''}
                    onChange={event => set('excelColumns', { ...draft.excelColumns, [field]: event.target.value })}
                    className={`${input} w-44`}
                  >
                    <option value="">(automatic)</option>
                    {headers.map(name => <option key={name} value={name}>{name}</option>)}
                  </select>
                </label>
              ))}
            </div>
          )}
          {Object.keys(draft.excelColumns).length > 0 && (
            <button type="button" onClick={() => set('excelColumns', {})} className="text-[11px] text-red-300 hover:text-white mt-1 cursor-pointer">Clear the column matches</button>
          )}
        </section>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-xs px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 cursor-pointer">Cancel</button>
          <button type="button" onClick={save} className="text-xs px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 font-semibold cursor-pointer">Save rules</button>
        </div>
      </div>
    </div>
  );
}
