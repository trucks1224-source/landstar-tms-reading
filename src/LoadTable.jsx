// ▦ Table view of the load list (Daniel 2026-11-27): for big lists (RXO's 183 loads), one row
// per load so 30+ fit on screen, sorted by clicking any column title, checkboxes down the side.
// Clicking a row opens the load like clicking its card. The TMS builds the rows (App.jsx).
import { useState } from 'react';
import { LOAD_TABLE_COLUMNS, sortLoadRows, nextLoadTableSort } from './lib/loadTable';

const PAGE = 300;
const money = value => (value > 0 ? `$${Math.round(value).toLocaleString('en-US')}` : '');

const statusClass = status => (status === 'ENT' ? 'tms-ent' : status === 'ON HOLD' ? 'bg-red-900/60 text-red-300'
  : status === 'OPEN' ? 'tms-open' : status === 'BOOKED' ? 'bg-purple-900/60 text-purple-200' : 'bg-blue-900/60 text-blue-300');

export default function LoadTable({ rows = [], selectedKey = '', showCustomer = false, allChecked = false, onToggleAll = null, onToggle, onOpen }) {
  const [sort, setSort] = useState(null);
  const [limit, setLimit] = useState(PAGE);
  const sorted = sort ? sortLoadRows(rows, sort.key, sort.descending) : rows;
  const shown = sorted.slice(0, limit);

  return (
    <div className="tms-load-table">
      <table className="w-full text-[11px] text-gray-200 border-collapse">
        <thead className="sticky top-0 z-10 bg-[#0b132b]">
          <tr className="text-[10px] uppercase text-gray-400 border-b border-slate-600">
            <th className="py-1 px-1 w-5">
              {onToggleAll && <input type="checkbox" checked={allChecked} onChange={onToggleAll} aria-label="Check every load shown" className="cursor-pointer accent-blue-600" />}
            </th>
            {showCustomer && <th className="text-left px-1">Customer</th>}
            {LOAD_TABLE_COLUMNS.map(column => (
              <th key={column.key} className={`px-1 whitespace-nowrap ${column.numeric && column.key !== 'pickupAt' ? 'text-right' : 'text-left'}`}>
                <button
                  type="button"
                  onClick={() => setSort(current => nextLoadTableSort(current, column.key))}
                  title={`Sort by ${column.label}`}
                  className="uppercase hover:text-white cursor-pointer"
                >
                  {column.label}{sort?.key === column.key ? (sort.descending ? ' ▼' : ' ▲') : ''}
                </button>
              </th>
            ))}
            <th className="text-left px-1">Flags</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(row => (
            <tr
              key={row.key}
              id={`load-row-${row.id}`}
              onClick={() => onOpen(row)}
              className={`cursor-pointer border-b border-slate-800 ${row.key === selectedKey ? 'bg-[#2b3d73] outline outline-2 outline-yellow-300' : row.hazmat ? 'bg-[#2a1708] hover:bg-[#3a2010]' : 'bg-[#0d1630] hover:bg-[#1a2647]'}`}
            >
              <td className="py-0.5 px-1" onClick={event => event.stopPropagation()}>
                <input type="checkbox" checked={row.checked} disabled={row.checkDisabled} onChange={event => onToggle(row, event)} aria-label={`Check load ${row.id}`} className="cursor-pointer accent-blue-600" />
              </td>
              {showCustomer && <td className="px-1 text-teal-200 whitespace-nowrap max-w-[8rem] truncate">{row.customer}</td>}
              <td className="px-1 font-mono text-blue-300 whitespace-nowrap">{row.id}</td>
              <td className="px-1 whitespace-nowrap">{row.pickup}</td>
              <td className="px-1 whitespace-nowrap max-w-[10rem] truncate" title={row.origin}>{row.origin}</td>
              <td className="px-1 whitespace-nowrap max-w-[10rem] truncate" title={row.destination}>{row.destination}</td>
              <td className="px-1 whitespace-nowrap text-gray-400">{row.delivery}</td>
              <td className="px-1 font-mono text-blue-300">{row.equipment}</td>
              <td className="px-1 text-right text-gray-400">{row.miles ? row.miles.toLocaleString('en-US') : ''}</td>
              <td className={`px-1 text-right font-bold ${row.rate > 0 ? 'text-emerald-300' : 'text-amber-300 font-normal'}`}>{money(row.rate) || 'no rate'}</td>
              <td className="px-1 text-right text-gray-400">{row.perMile > 0 ? `$${row.perMile.toFixed(2)}` : ''}</td>
              <td className="px-1"><span className={`text-[10px] px-1 rounded font-semibold ${statusClass(row.status)}`}>{row.status}</span></td>
              <td className="px-1 text-right text-emerald-300/80 whitespace-nowrap">{row.exported ? `↑ ${row.exported}` : ''}</td>
              <td className="px-1 whitespace-nowrap">{row.flags.join(' ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length > shown.length && (
        <button type="button" onClick={() => setLimit(value => value + PAGE)} className="w-full mt-2 text-xs text-sky-300 hover:text-white py-1 cursor-pointer">
          Show {Math.min(PAGE, sorted.length - shown.length)} more of {sorted.length - shown.length} loads
        </button>
      )}
    </div>
  );
}
