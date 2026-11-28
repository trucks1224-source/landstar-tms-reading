// Moved out of App.jsx (Daniel 2026-11-27: splitting the TMS's main file). App.jsx imports
// everything here, so it is used exactly as before.
import { useState, useEffect } from 'react';
import { summarizeBookings } from './bookings.js';

// ---------- Bookings report ----------
// Every booked load is logged here (customer, line haul, when), so weekly and monthly
// booking totals survive deliveries, imports and deletions (Daniel's rule, 2026-11-13).
const bookingLogKey = 'landstar_bookingLog';

// Weekly and monthly booking totals from the booking log: how many loads were booked,
// for which customers, and the total line haul.
function BookingsReportPage({ onBack, fuelRates = null }) {
  const [log, setLog] = useState([]);
  useEffect(() => {
    const read = () => {
      try {
        setLog(JSON.parse(localStorage.getItem(bookingLogKey) || '[]'));
      } catch {
        setLog([]);
      }
    };
    read();
    // Stays current while open: removals, new bookings and cloud sync all re-read the log.
    window.addEventListener('landstar-data-changed', read);
    const timer = setInterval(read, 5000);
    return () => {
      window.removeEventListener('landstar-data-changed', read);
      clearInterval(timer);
    };
  }, []);
  const { weeks, months } = summarizeBookings(log, fuelRates);
  const money = value => `$${(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const dayLabel = time => {
    const date = new Date(time);
    return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
  };
  const weekLabel = start => `${dayLabel(start)} - ${dayLabel(start + 6 * 86400000)}/${String(new Date(start + 6 * 86400000).getFullYear()).slice(2)}`;
  const monthLabel = key => {
    const [year, month] = key.split('-').map(Number);
    return new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold tracking-wide">📊 Bookings Report</h2>
        <button type="button" onClick={onBack} className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-1 rounded text-xs font-semibold cursor-pointer">Back to loads</button>
      </div>
      {!weeks.length && <p className="text-gray-400 text-sm">No bookings recorded yet. Book a load and it shows up here.</p>}
      <div className="space-y-4">
        {weeks.map(week => (
          <div key={week.start} className="bg-[#161f36]/40 border border-[#1c2541] rounded-xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <h3 className="font-bold text-sky-300">Week {weekLabel(week.start)}</h3>
              <span className="text-sm text-gray-100 font-semibold">{week.loads} load{week.loads === 1 ? '' : 's'} booked · Line haul {money(week.lineHaul)} · Total booked {money(week.total)} · Potential {money(week.potential)}</span>
            </div>
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="text-gray-400"><th className="py-1 font-semibold">Customer</th><th className="py-1 font-semibold text-right">Loads</th><th className="py-1 font-semibold text-right">Line haul</th><th className="py-1 font-semibold text-right" title="Line haul + miles × the pickup region's fuel surcharge rate">Total booked</th><th className="py-1 font-semibold text-right" title="5% of the line haul; straight trucks (D-ST, D-LG, D-RF) pay 11%">Potential</th></tr>
              </thead>
              <tbody>
                {week.customers.map(entry => (
                  <tr key={entry.customer} className={`border-t border-[#1c2541]${entry.snb ? ' text-amber-200 italic' : ''}`} title={entry.snb ? "Ivan's bookings (R X O 2429200 - SNB); included in the week total" : undefined}>
                    <td className="py-1">{entry.customer}</td>
                    <td className="py-1 text-right">{entry.loads}</td>
                    <td className="py-1 text-right">{money(entry.lineHaul)}</td>
                    <td className="py-1 text-right">{money(entry.total)}</td>
                    <td className="py-1 text-right">{money(entry.potential)}</td>
                  </tr>
                ))}
                <tr className="border-t border-[#1c2541] font-bold text-gray-100">
                  <td className="py-1">Week total</td>
                  <td className="py-1 text-right">{week.loads}</td>
                  <td className="py-1 text-right">{money(week.lineHaul)}</td>
                  <td className="py-1 text-right">{money(week.total)}</td>
                  <td className="py-1 text-right">{money(week.potential)}</td>
                </tr>
                {week.snb.loads > 0 && (
                  <tr className="text-[11px] text-gray-400">
                    <td className="py-1">Yours without Ivan</td>
                    <td className="py-1 text-right">{week.loads - week.snb.loads}</td>
                    <td className="py-1 text-right">{money(week.lineHaul - week.snb.lineHaul)}</td>
                    <td className="py-1 text-right">{money(week.total - week.snb.total)}</td>
                    <td className="py-1 text-right">{money(week.potential - week.snb.potential)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      {months.length > 0 && (
        <div className="bg-[#161f36]/40 border border-[#1c2541] rounded-xl p-4 mt-6">
          <h3 className="font-bold text-emerald-300 mb-2">Monthly totals</h3>
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="text-gray-400"><th className="py-1 font-semibold">Month</th><th className="py-1 font-semibold text-right">Loads booked</th><th className="py-1 font-semibold text-right">Line haul</th><th className="py-1 font-semibold text-right" title="Line haul + miles × the pickup region's fuel surcharge rate">Total booked</th><th className="py-1 font-semibold text-right" title="5% of the line haul; straight trucks (D-ST, D-LG, D-RF) pay 11%">Potential</th></tr>
            </thead>
            <tbody>
              {months.map(month => (
                <tr key={month.month} className="border-t border-[#1c2541]">
                  <td className="py-1">{monthLabel(month.month)}{month.snb.loads > 0 && <span className="block text-[10px] text-amber-200">Ivan (SNB): {month.snb.loads} load{month.snb.loads === 1 ? '' : 's'} · {money(month.snb.lineHaul)}</span>}</td>
                  <td className="py-1 text-right">{month.loads}</td>
                  <td className="py-1 text-right">{money(month.lineHaul)}</td>
                  <td className="py-1 text-right">{money(month.total)}</td>
                  <td className="py-1 text-right">{money(month.potential)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export {
  bookingLogKey,
  BookingsReportPage
};
