import React, { useState } from 'react';
import * as XLSX from 'xlsx';

function excelDateToReadable(serial) {
  if (!serial) return '10/16/2026 0800';
  if (typeof serial === 'string') return serial;
  const utc_days = Math.floor(serial - 25569);
  const utc_value = utc_days * 86400;
  const date_info = new Date(utc_value * 1000);
  const fractional_day = serial - Math.floor(serial);
  let total_seconds = Math.floor(fractional_day * 86400);
  const hours = Math.floor(total_seconds / 3600);
  total_seconds %= 3600;
  const minutes = Math.floor(total_seconds / 60);
  
  const mm = String(date_info.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date_info.getUTCDate()).padStart(2, '0');
  const yyyy = date_info.getUTCFullYear();
  const hh = String(hours).padStart(2, '0');
  const min = String(minutes).padStart(2, '0');
  
  return `${mm}/${dd}/${yyyy} ${hh}${min}`;
}

function calculateDATMarketRate(milesStr) {
  const miles = parseFloat(String(milesStr)?.replace(/[^0-9.]/g, '')) || 500;
  return (Math.round(miles * 3.18 * 100) / 100).toFixed(2);
}

const defaultOrders = [
  { id: '2274611', status: 'OPEN', route: 'NORFOLK, VA → CHARLOTTE, NC', origCity: 'NORFOLK', origSt: 'VA', origZip: '23502', destCity: 'CHARLOTTE', destSt: 'NC', destZip: '29217', miles: '343', weight: '42,852 lbs', pickupTime: '10/15/2026 0500 - 1500', deliveryTime: '10/16/2026 0000 - 1500', rateInput: '1090.54', planningComment: 'Standard Dry Van Load' }
];

export default function App() {
  const [orders, setOrders] = useState(defaultOrders);
  const [selectedOrder, setSelectedOrder] = useState(orders[0]);
  const [searchQuery, setSearchQuery] = useState('');

  const handleInputChange = (field, value) => {
    if (!selectedOrder) return;
    const updated = { ...selectedOrder, [field]: value };
    if (field === 'miles') {
      updated.rateInput = calculateDATMarketRate(value);
    }
    setSelectedOrder(updated);
    setOrders(orders.map(o => o.id === updated.id ? updated : o));
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target.result;
        const workbook = XLSX.read(bstr, { type: 'binary' });
        const ws = workbook.Sheets[workbook.SheetNames[0]];
        const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1 });
        
        if (!rawRows || rawRows.length <= 1) {
          alert("Spreadsheet has no data.");
          return;
        }

        const imported = rawRows.slice(1)
          .filter(row => row && row[0])
          .map((row, idx) => {
            const id = String(row[0] || `IMP-${idx}`);
            const origCity = String(row[6] || 'UNKNOWN');
            const origSt = String(row[7] || '');
            const origZip = String(row[8] || '00000');
            const miles = String(row[9] || '500');
            const destCity = String(row[11] || 'UNKNOWN');
            const destSt = String(row[12] || '');
            const destZip = String(row[13] || '00000');
            const weight = String(row[15] || '40000 lbs');
            const pickupTime = excelDateToReadable(row[18]);
            const deliveryTime = excelDateToReadable(row[19]);
            const planningComment = String(row[22] || 'Imported Load');
            const rateInput = calculateDATMarketRate(miles);

            return {
              id,
              status: 'OPEN',
              route: `${origCity}, ${origSt} → ${destCity}, ${destSt}`,
              origCity, origSt, origZip,
              destCity, destSt, destZip,
              miles, weight, pickupTime, deliveryTime,
              rateInput, planningComment
            };
          });

        if (imported.length > 0) {
          setOrders(imported);
          setSelectedOrder(imported[0]);
          alert(`Successfully imported ${imported.length} loads!`);
        }
      } catch (err) {
        console.error(err);
        alert("Error reading file.");
      }
    };
    reader.readAsBinaryString(file);
  };

  const filtered = orders.filter(o => 
    o.id.includes(searchQuery) || o.route.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex h-screen bg-[#0b132b] text-white font-sans overflow-hidden">
      <div className="w-96 bg-[#121829] border-r border-[#1c2541] flex flex-col p-3">
        <div className="flex justify-between items-center mb-3">
          <span className="text-xs font-bold">Landstar TMS</span>
          <label className="bg-blue-600 hover:bg-blue-500 px-2.5 py-1 text-xs rounded cursor-pointer font-bold">
            📂 Upload Excel
            <input type="file" accept=".xlsx, .xls, .csv" onChange={handleFileUpload} className="hidden" />
          </label>
        </div>

        <input 
          type="text" 
          placeholder="🔍 Search orders..." 
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-1.5 text-xs mb-3 text-white outline-none"
        />

        <div className="flex-1 overflow-y-auto space-y-2">
          {filtered.map(ord => (
            <div 
              key={ord.id}
              onClick={() => setSelectedOrder(ord)}
              className={`p-3 rounded cursor-pointer border ${selectedOrder?.id === ord.id ? 'bg-[#1c2541] border-blue-500' : 'bg-[#161f36] border-transparent'}`}
            >
              <div className="flex justify-between text-xs font-bold text-blue-400 mb-1">
                <span>{ord.id}</span>
                <span>{ord.status}</span>
              </div>
              <div className="text-xs text-gray-200 truncate">{ord.route}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 p-6 overflow-y-auto bg-[#0b132b]">
        {selectedOrder ? (
          <div className="space-y-4 bg-[#161f36]/40 p-5 rounded-xl border border-[#1c2541] max-w-2xl">
            <h2 className="text-lg font-bold">ORDER #{selectedOrder.id}</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Origin City</label>
                <input type="text" value={selectedOrder.origCity} onChange={e => handleInputChange('origCity', e.target.value)} className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-xs text-white" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Destination City</label>
                <input type="text" value={selectedOrder.destCity} onChange={e => handleInputChange('destCity', e.target.value)} className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-xs text-white" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Miles</label>
                <input type="text" value={selectedOrder.miles} onChange={e => handleInputChange('miles', e.target.value)} className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-xs text-white" />
              </div>
              <div>
                <label className="text-xs text-emerald-400 block mb-1 font-bold">Rate ($) [Auto DAT]</label>
                <input type="text" value={selectedOrder.rateInput} onChange={e => handleInputChange('rateInput', e.target.value)} className="w-full bg-[#0b132b] border border-emerald-500 rounded p-2 text-xs font-bold text-white" />
              </div>
            </div>
          </div>
        ) : (
          <div className="text-gray-400">Select or upload loads to begin.</div>
        )}
      </div>
    </div>
  );
}