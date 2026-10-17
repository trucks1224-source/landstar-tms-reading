import React, { useState } from 'react';
import * as XLSX from 'xlsx';

// Helper to convert Excel date serial numbers to readable strings
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

// Map equipment text to TMS equipment codes
function parseEquipmentCode(eqText) {
  if (!eqText) return 'V';
  const text = String(eqText).trim().toUpperCase();
  if (text.includes('VAN') || text.includes('V') || text.includes('DRY')) {
    if (text.includes('REZ') || text.includes('REF')) return 'RZ';
    return 'V';
  }
  if (text.includes('REF') || text.includes('REE')) return 'R';
  if (text.includes('FLAT') || text.includes('STEP')) return 'F';
  return 'V';
}

// Equipment description mapping
function getEquipmentDescription(eCode) {
  const code = (eCode || 'V').trim().toUpperCase();
  switch (code) {
    case 'VZ': return 'VAN:VAN, VAN:53VN, REFR:REFR';
    case 'V':
    case 'VAN': return 'VAN:VAN, VAN:53VN';
    case 'VR': return 'VAN:VAN, REFR:REFR';
    case 'R':
    case 'RZ': return 'REFR:REFR';
    case 'F': return 'FLAT:53FL, FLAT:48FL, FLAT:FLAT, STEP:SD';
    case 'SD': return 'STEP:SD';
    default: return 'VAN:VAN, VAN:53VN';
  }
}

// Dynamic DAT Market Rate calculation ($3.18/mi factor)
function calculateDATMarketRate(origCity, destCity, milesStr) {
  const miles = parseFloat(String(milesStr)?.replace(/[^0-9.]/g, '')) || 500;
  const ratePerMile = 3.18; 
  const calculatedTotal = Math.round(miles * ratePerMile * 100) / 100;
  return calculatedTotal.toFixed(2);
}

const defaultATZOrders = [
  { id: '2274611', visibilityGroup: 'ANQ', eCode: 'VZ', status: 'ENT', tag: 'ENT', route: 'NORFOLK, VA → CHARLOTTE, NC', puDate: 'PU: 10/15 0500', delDate: 'DFL: 10/16 0900', pickupTime: '10/15/2026 0500 - 1500', origCity: 'NORFOLK', origSt: 'VA', origZip: '23502', weight: '42,852 lbs', deliveryTime: '10/16/2026 0000 - 1500', destCity: 'CHARLOTTE', destSt: 'NC', destZip: '29217', miles: '343', planningComment: 'Standard Dry Van Load', carrier: '', driver: '', truck: '', trailer: '', rateInput: calculateDATMarketRate('NORFOLK', 'CHARLOTTE', '343'), brokerable: 'false', notes: '' }
];

const defaultRXOOrders = [
  { id: 'RXO-9001', visibilityGroup: 'ANQ', eCode: 'V', status: 'OPEN', tag: 'OPEN', route: 'ATLANTA, GA → CHICAGO, IL', puDate: 'PU: 10/16 0800', delDate: 'DFL: 10/18 1700', pickupTime: '10/16/2026 0800 - 1200', origCity: 'ATLANTA', origSt: 'GA', origZip: '30303', weight: '35,000 lbs', deliveryTime: '10/18/2026 0800 - 1700', destCity: 'CHICAGO', destSt: 'IL', destZip: '60601', miles: '716', planningComment: 'RXO Priority Load', carrier: '', driver: '', truck: '', trailer: '', rateInput: calculateDATMarketRate('ATLANTA', 'CHICAGO', '716'), brokerable: 'false', notes: '' }
];

export default function App() {
  const [customerOrdersMap, setCustomerOrdersMap] = useState({
    'Para 1522166 - ATZ': defaultATZOrders,
    'RXO 2429200 - ATZ': defaultRXOOrders
  });

  const [brokers, setBrokers] = useState(['Para 1522166 - ATZ', 'RXO 2429200 - ATZ']);
  const [selectedBroker, setSelectedBroker] = useState('RXO 2429200 - ATZ');

  const orders = customerOrdersMap[selectedBroker] || [];
  const [selectedOrder, setSelectedOrder] = useState(orders[0] || null);

  const [filter, setFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  
  const [isAddingBroker, setIsAddingBroker] = useState(false);
  const [newBrokerInput, setNewBrokerInput] = useState('');
  
  const [editingBroker, setEditingBroker] = useState(null);
  const [editBrokerInput, setEditBrokerInput] = useState('');

  const [selectedIds, setSelectedIds] = useState([]);

  const updateCurrentOrders = (newOrders) => {
    setCustomerOrdersMap(prev => ({
      ...prev,
      [selectedBroker]: newOrders
    }));
  };

  const handleSelectBroker = (broker) => {
    setSelectedBroker(broker);
    setSelectedIds([]);
    const brokerLoads = customerOrdersMap[broker] || [];
    setSelectedOrder(brokerLoads[0] || null);
  };

  const handleInputChange = (field, value) => {
    if (!selectedOrder) return;
    const updatedOrder = { ...selectedOrder, [field]: value };
    if (field === 'miles') {
      updatedOrder.rateInput = calculateDATMarketRate(updatedOrder.origCity, updatedOrder.destCity, value);
    }
    setSelectedOrder(updatedOrder);
    updateCurrentOrders(orders.map(o => o.id === selectedOrder.id ? updatedOrder : o));
  };

  const handleSave = () => {
    if (!selectedOrder) return;
    alert(`Order #${selectedOrder.id} saved successfully for ${selectedBroker}!`);
  };

  const handleDelete = () => {
    if (!selectedOrder) return;
    const remaining = orders.filter(o => o.id !== selectedOrder.id);
    updateCurrentOrders(remaining);
    if (remaining.length > 0) setSelectedOrder(remaining[0]);
    else setSelectedOrder(null);
  };

  const handleToggleSelect = (id, e) => {
    e.stopPropagation();
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter(item => item !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const handleSelectAll = (filteredOrders) => {
    const filteredIds = filteredOrders.map(o => o.id);
    const allSelected = filteredIds.every(id => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds(selectedIds.filter(id => !filteredIds.includes(id)));
    } else {
      const combined = Array.from(new Set([...selectedIds, ...filteredIds]));
      setSelectedIds(combined);
    }
  };

  const handleSelectFirst25 = () => {
    const first25Ids = filteredOrders.slice(0, 25).map(o => o.id);
    setSelectedIds(first25Ids);
  };

  const handleDeleteSelected = () => {
    if (selectedIds.length === 0) return;
    if (window.confirm(`Are you sure you want to delete ${selectedIds.length} selected loads for ${selectedBroker}?`)) {
      const remaining = orders.filter(o => !selectedIds.includes(o.id));
      updateCurrentOrders(remaining);
      setSelectedIds([]);
      if (remaining.length > 0) setSelectedOrder(remaining[0]);
      else setSelectedOrder(null);
    }
  };

  const handleStatusChange = (newStatus) => {
    if (!selectedOrder) return;
    const updatedOrder = { 
      ...selectedOrder, 
      status: newStatus, 
      tag: newStatus === 'ENT' ? 'ENT' : newStatus === 'ON HOLD' ? 'HOLD' : 'OPEN' 
    };
    setSelectedOrder(updatedOrder);
    updateCurrentOrders(orders.map(o => o.id === updatedOrder.id ? updatedOrder : o));
  };

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text);
    alert(`Copied ${label}: ${text}`);
  };

  const handleAddBroker = (e) => {
    e.preventDefault();
    const name = newBrokerInput.trim();
    if (name && !brokers.includes(name)) {
      const updatedBrokers = [...brokers, name];
      setBrokers(updatedBrokers);
      setCustomerOrdersMap(prev => ({ ...prev, [name]: [] }));
      handleSelectBroker(name);
      setNewBrokerInput('');
      setIsAddingBroker(false);
    }
  };

  const handleSaveEditBroker = (oldName, e) => {
    e.preventDefault();
    const newName = editBrokerInput.trim();
    if (newName && !brokers.includes(newName)) {
      const updatedBrokers = brokers.map(b => b === oldName ? newName : b);
      setBrokers(updatedBrokers);
      setCustomerOrdersMap(prev => {
        const copy = { ...prev };
        copy[newName] = copy[oldName] || [];
        delete copy[oldName];
        return copy;
      });
      if (selectedBroker === oldName) {
        setSelectedBroker(newName);
      }
      setEditingBroker(null);
      setEditBrokerInput('');
    }
  };

  const handleDeleteBroker = (brokerToDelete, e) => {
    e.stopPropagation();
    if (brokers.length <= 1) {
      alert("You must keep at least one customer/broker.");
      return;
    }
    if (window.confirm(`Delete customer "${brokerToDelete}" and all its loads?`)) {
      const updatedBrokers = brokers.filter(b => b !== brokerToDelete);
      setBrokers(updatedBrokers);
      setCustomerOrdersMap(prev => {
        const copy = { ...prev };
        delete copy[brokerToDelete];
        return copy;
      });
      if (selectedBroker === brokerToDelete) {
        handleSelectBroker(updatedBrokers[0]);
      }
    }
  };

  const handleExportToLandstar = () => {
    const loadsToExport = selectedIds.length > 0 
      ? orders.filter(o => selectedIds.includes(o.id))
      : filteredOrders.slice(0, 25);

    if (loadsToExport.length === 0) {
      alert("No loads selected for export!");
      return;
    }

    if (loadsToExport.length > 25) {
      alert("Please select 25 or fewer loads to comply with Landstar's upload limit!");
      return;
    }

    let customerIdVal = "1522166";
    if (selectedBroker.toLowerCase().includes('rxo')) {
      customerIdVal = "2429200";
    } else if (selectedBroker.includes('-')) {
      customerIdVal = selectedBroker.split('-')[0].replace(/[^0-9]/g, '') || "1522166";
    }
    if (customerIdVal.length > 12) {
      customerIdVal = customerIdVal.substring(0, 12);
    }

    const exportData = loadsToExport.map(ord => {
      const puParts = (ord.pickupTime || '').split(' - ');
      const delParts = (ord.deliveryTime || '').split(' - ');
      const eCodeUpper = (ord.eCode || '').trim().toUpperCase();

      let commodityVal = 'CONSUMER GOODS OR APPLIANCES';
      if (eCodeUpper === 'VZ' || eCodeUpper === 'RZ' || eCodeUpper === 'Z') {
        commodityVal = 'HAZMAT NON-HIGH RISK OR AA&E';
      } else if (eCodeUpper === 'VE') {
        commodityVal = 'CHEMICALS (NON-HAZ/REGULATED)';
      }

      return {
        "Customer ID\n(Required)": customerIdVal,
        "Posting Call Back 10 Digits Phone Number": "4845756486",
        "Origin City": ord.origCity,
        "Origin Zipcode\n(Required)": ord.origZip,
        "Origin Country\n(Required)": "USA",
        "Destination City": ord.destCity,
        "Destination Zipcode\n(Required)": ord.destZip,
        "Destination Country\n(Required)": "USA",
        "Pickup Date (From)\n(Required)": puParts[0] || ord.pickupTime || '',
        "Pickup Date (Thru)\n(Required)": puParts[1] || puParts[0] || '',
        "Delivery Date (From)\n(Required)": delParts[0] || ord.deliveryTime || '',
        "Delivery Date (Thru)\n(Required)": delParts[1] || delParts[0] || '',
        "Load Posting Code": ord.id,
        "Visibility Code": ord.visibilityGroup || "ANQ",
        "Bill as Miles": ord.miles,
        "Equipment 1\n(Required)": ord.eCode,
        "Equipment 2": "",
        "Equipment 3": "",
        "Weight\n(Required)": ord.weight ? ord.weight.replace(/[^0-9]/g, '') : '40000',
        "Rate Type\n(Required)": "Flat",
        "Rate\n(Required)": ord.rateInput > 0 ? ord.rateInput : calculateDATMarketRate(ord.origCity, ord.destCity, ord.miles),
        "Commodity\n": commodityVal,
        "Brokerable": ord.brokerable || "false",
        "Carrier Amt": ord.rateInput > 0 ? ord.rateInput : calculateDATMarketRate(ord.origCity, ord.destCity, ord.miles),
        "Carrier Load Alerts": "",
        "Load Attributes": "ENT",
        "Comments": ord.planningComment,
        "Fuel Surcharge Rate Type": "",
        "Fuel Surcharge": ""
      };
    });

    const exportedIds = loadsToExport.map(o => o.id);
    const updatedOrders = orders.map(ord => {
      if (exportedIds.includes(ord.id)) {
        return { ...ord, status: 'ENT', tag: 'ENT' };
      }
      return ord;
    });
    updateCurrentOrders(updatedOrders);
    if (selectedOrder && exportedIds.includes(selectedOrder.id)) {
      setSelectedOrder(prev => ({ ...prev, status: 'ENT', tag: 'ENT' }));
    }

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Loads");
    XLSX.writeFile(workbook, `Landstar_Bulk_${selectedBroker.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`);
    alert(`Successfully exported ${loadsToExport.length} loads for ${selectedBroker}!`);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target.result;
        const workbook = XLSX.read(bstr, { type: 'binary' });
        const wsname = workbook.SheetNames[0];
        const ws = workbook.Sheets[wsname];
        
        const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1 });
        if (!rawRows || rawRows.length <= 1) {
          alert("The uploaded spreadsheet contains no rows.");
          return;
        }

        const dataRows = rawRows.slice(1);

        const importedLoads = dataRows
          .filter(rowArr => rowArr && rowArr.length > 0 && rowArr[0] !== undefined && rowArr[0] !== null && String(rowArr[0]).trim() !== '')
          .map((rowArr, index) => {
            const id = String(rowArr[0] || `IMP-${Date.now()}-${index}`);
            
            const origCity = String(rowArr[6] !== undefined ? rowArr[6] : 'UNKNOWN');
            const origSt = String(rowArr[7] !== undefined ? rowArr[7] : '');
            const origZip = String(rowArr[8] !== undefined ? rowArr[8] : '00000');
            const miles = String(rowArr[9] !== undefined ? rowArr[9] : '500');
            const destCity = String(rowArr[11] !== undefined ? rowArr[11] : 'UNKNOWN');
            const destSt = String(rowArr[12] !== undefined ? rowArr[12] : '');
            const destZip = String(rowArr[13] !== undefined ? rowArr[13] : '00000');
            
            const weight = String(rowArr[15] !== undefined ? rowArr[15] : '40000 lbs');
            const rawEq = rowArr[4] !== undefined ? rowArr[4] : (rowArr[5] !== undefined ? rowArr[5] : 'V');
            const eCode = parseEquipmentCode(rawEq);
            
            const rawPu = rowArr[18] !== undefined ? rowArr[18] : '';
            const rawDel = rowArr[19] !== undefined ? rowArr[19] : '';
            
            const pickupTime = excelDateToReadable(rawPu);
            const deliveryTime = excelDateToReadable(rawDel);
            const planningComment = String(rowArr[22] !== undefined ? rowArr[22] : 'Imported Customer Load');
            
            const rateInput = calculateDATMarketRate(origCity, destCity, miles);

            return {
              id,
              visibilityGroup: 'ANQ',
              eCode,
              status: 'OPEN',
              tag: 'OPEN',
              route: `${origCity}, ${origSt} → ${destCity}, ${destSt}`,
              puDate: `PU: ${pickupTime}`,
              delDate: `DFL: ${deliveryTime}`,
              pickupTime,
              origCity,
              origSt,
              origZip,
              weight,
              deliveryTime,
              destCity,
              destSt,
              destZip,
              miles,
              planningComment,
              carrier: '',
              driver: '',
              truck: '',
              trailer: '',
              rateInput: String(rateInput),
              brokerable: 'false',
              notes: ''
            };
          });

        if (importedLoads.length === 0) {
          alert("No valid loads could be parsed from the file.");
          return;
        }

        updateCurrentOrders(importedLoads);
        setSelectedOrder(importedLoads[0]);
        setSelectedIds([]);
        alert(`Successfully imported ${importedLoads.length} loads for ${selectedBroker}!`);
      } catch (error) {
        console.error(error);
        alert("Error parsing Excel file. Please ensure it is a valid spreadsheet.");
      }
    };
    reader.readAsBinaryString(file);
  };

  const filteredOrders = orders.filter(ord => {
    const matchesFilter = filter === 'ALL' || ord.status === filter;
    const matchesSearch = ord.id.includes(searchQuery) || 
                          ord.route.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          ord.planningComment.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const entCount = orders.filter(o => o.status === 'ENT').length;

  return (
    <div className="flex h-screen bg-[#0b132b] text-white overflow-hidden font-sans">
      {/* Left Sidebar - Order List */}
      <div className="w-96 bg-[#121829] border-r border-[#1c2541] flex flex-col">
        <div className="p-3 border-b border-[#1c2541] bg-[#161f36]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-gray-200">Landstar TMS</span>
            <div className="space-x-1 flex items-center">
              <label className="bg-blue-600 hover:bg-blue-500 px-2 py-0.5 text-[10px] font-bold rounded cursor-pointer text-white inline-flex items-center">
                <span>📂 Upload Excel</span>
                <input type="file" accept=".xlsx, .xls, .csv" onChange={handleFileUpload} className="hidden" />
              </label>
              <button 
                onClick={handleExportToLandstar}
                className="bg-purple-600 hover:bg-purple-500 px-2 py-0.5 text-[10px] font-bold rounded text-white cursor-pointer"
              >
                📥 Export Excel
              </button>
            </div>
          </div>

          {/* Customer / Broker Buttons */}
          <div className="flex flex-col gap-1.5 my-2">
            <span className="text-[11px] text-gray-400 font-bold uppercase tracking-wider">Customers / Brokers:</span>
            {brokers.map(broker => (
              editingBroker === broker ? (
                <form key={broker} onSubmit={(e) => handleSaveEditBroker(broker, e)} className="flex items-center space-x-1 w-full">
                  <input 
                    type="text"
                    value={editBrokerInput}
                    onChange={(e) => setEditBrokerInput(e.target.value)}
                    autoFocus
                    className="bg-[#0b132b] border border-blue-500 rounded px-2 py-1 text-[11px] text-white outline-none flex-1"
                  />
                  <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 text-[11px] rounded font-bold">Save</button>
                  <button type="button" onClick={() => setEditingBroker(null)} className="bg-gray-600 hover:bg-gray-500 text-white px-1.5 py-1 text-[11px] rounded">Cancel</button>
                </form>
              ) : (
                <div 
                  key={broker} 
                  className={`flex items-center justify-between px-2.5 py-1.5 text-[11px] rounded font-medium border transition-colors ${selectedBroker === broker ? 'bg-blue-600/30 border-blue-500 text-white' : 'bg-[#1c2541] border-[#253259] text-gray-300 hover:bg-[#253259]'}`}
                >
                  <span 
                    className="truncate flex-1 cursor-pointer"
                    onClick={() => handleSelectBroker(broker)}
                  >
                    {broker} {selectedBroker === broker && ' ✓'}
                  </span>
                  <div className="flex items-center space-x-1 ml-2">
                    <button 
                      onClick={() => { setEditingBroker(broker); setEditBrokerInput(broker); }}
                      title="Edit Customer"
                      className="bg-slate-700 hover:bg-blue-600 text-gray-200 hover:text-white px-1.5 py-0.5 rounded text-[10px]"
                    >
                      ✏️ Edit
                    </button>
                    <button 
                      onClick={(e) => handleDeleteBroker(broker, e)}
                      title="Delete Customer"
                      className="bg-slate-700 hover:bg-red-600 text-gray-200 hover:text-white px-1.5 py-0.5 rounded text-[10px]"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )
            ))}

            {isAddingBroker ? (
              <form onSubmit={handleAddBroker} className="flex items-center space-x-1 mt-1 w-full">
                <input 
                  type="text"
                  placeholder="Customer ID / Name..."
                  value={newBrokerInput}
                  onChange={(e) => setNewBrokerInput(e.target.value)}
                  autoFocus
                  className="bg-[#0b132b] border border-blue-500 rounded px-2 py-1 text-[11px] text-white outline-none flex-1"
                />
                <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 text-[11px] rounded font-bold">Add</button>
                <button type="button" onClick={() => setIsAddingBroker(false)} className="bg-gray-600 hover:bg-gray-500 text-white px-1.5 py-1 text-[11px] rounded">Cancel</button>
              </form>
            ) : (
              <button 
                onClick={() => setIsAddingBroker(true)}
                className="mt-1 px-2.5 py-1 text-[11px] rounded font-medium bg-[#1c2541] hover:bg-blue-600 text-blue-300 hover:text-white transition-colors text-left"
              >
                + Add Customer
              </button>
            )}
          </div>

          <div className="flex items-center justify-between text-[11px] text-gray-400 mb-2">
            <span>{orders.length} loads · {entCount} ENT</span>
            <span className="text-emerald-400 flex items-center">✅ Auto-saved</span>
          </div>

          <div className="flex items-center justify-between mb-2">
            <div className="flex space-x-1">
              {['ALL', 'OPEN', 'ON HOLD', 'ENT'].map(tab => (
                <button 
                  key={tab}
                  onClick={() => setFilter(tab)} 
                  className={`px-2 py-1 text-[11px] rounded font-semibold ${filter === tab ? 'bg-blue-600 text-white' : 'bg-[#1c2541] text-gray-400'}`}
                >
                  {tab}
                </button>
              ))}
            </div>
            {selectedIds.length > 0 && (
              <button 
                onClick={handleDeleteSelected}
                className="bg-red-600 hover:bg-red-700 text-white text-[10px] px-2 py-1 rounded font-bold cursor-pointer"
              >
                Delete Selected ({selectedIds.length})
              </button>
            )}
          </div>

          <div className="flex items-center justify-between mt-1 mb-1 px-1">
            <div className="flex items-center space-x-2">
              <input 
                type="checkbox"
                onChange={() => handleSelectAll(filteredOrders)}
                checked={filteredOrders.length > 0 && filteredOrders.every(o => selectedIds.includes(o.id))}
                className="cursor-pointer accent-blue-600"
              />
              <span className="text-[11px] text-gray-400">Select All</span>
            </div>
            <button 
              onClick={handleSelectFirst25}
              className="bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold px-2 py-0.5 rounded cursor-pointer"
            >
              Select First 25
            </button>
          </div>

          <div className="relative mt-1">
            <input 
              type="text" 
              placeholder="🔍 Search order, city, comment..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-1.5 text-xs text-white placeholder-gray-500 outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {filteredOrders.length === 0 ? (
            <div className="text-center text-gray-400 text-xs py-8">No loads found for {selectedBroker}. Upload an Excel file or add orders!</div>
          ) : (
            filteredOrders.map((ord) => (
              <div 
                key={ord.id}
                onClick={() => setSelectedOrder(ord)}
                className={`p-3 rounded-lg cursor-pointer border transition-all flex items-start space-x-2.5 ${
                  selectedOrder && selectedOrder.id === ord.id 
                    ? 'bg-[#1c2541] border-blue-500 shadow-md' 
                    : 'bg-[#161f36]/60 border-transparent hover:bg-[#1c2541]/50'
                }`}
              >
                <input 
                  type="checkbox"
                  checked={selectedIds.includes(ord.id)}
                  onChange={(e) => handleToggleSelect(ord.id, e)}
                  className="mt-1 cursor-pointer accent-blue-600"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-sm text-blue-400">{ord.id}</span>
                      <span className="bg-blue-900/60 text-blue-300 text-[10px] px-1.5 py-0.5 rounded font-mono" title={getEquipmentDescription(ord.eCode)}>{ord.eCode}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${ord.status === 'ENT' ? 'bg-emerald-900/60 text-emerald-300' : ord.status === 'ON HOLD' ? 'bg-amber-900/60 text-amber-300' : 'bg-blue-900/60 text-blue-300'}`}>{ord.status}</span>
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${ord.tag === 'ENT' ? 'bg-emerald-600 text-white' : ord.tag === 'HOLD' ? 'bg-amber-600 text-white' : 'bg-blue-600 text-white'}`}>{ord.tag}</span>
                  </div>
                  <div className="text-xs font-medium text-gray-200 mb-1 truncate">{ord.route}</div>
                  <div className="text-[11px] text-gray-400">{ord.puDate} {ord.delDate}</div>
                  {ord.planningComment && <div className="mt-1 text-[11px] text-amber-300 font-semibold truncate">{ord.planningComment}</div>}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-y-auto p-6 bg-[#0b132b]">
        <div className="flex items-center justify-between bg-[#161f36] px-4 py-3 rounded-lg mb-6 border border-[#1c2541]">
          <div className="flex items-center space-x-3">
            <span className="text-xs font-bold text-gray-400">MOVE TO:</span>
            <button onClick={() => handleStatusChange('OPEN')} className="bg-emerald-600 hover:bg-emerald-500 px-3 py-1 text-xs font-bold rounded text-white cursor-pointer">OPEN</button>
            <button onClick={() => handleStatusChange('ON HOLD')} className="bg-amber-600 hover:bg-amber-500 px-3 py-1 text-xs font-bold rounded text-white cursor-pointer">ON HOLD</button>
            <button onClick={() => handleStatusChange('ENT')} className="bg-emerald-700 hover:bg-emerald-600 px-3 py-1 text-xs font-bold rounded text-white cursor-pointer">ENT</button>
          </div>
          <button onClick={handleExportToLandstar} className="bg-purple-600 hover:bg-purple-500 px-3 py-1 text-xs rounded text-white font-medium cursor-pointer">📥 Export to Landstar Bulk Excel & Move to ENT</button>
        </div>

        {selectedOrder ? (
          <>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <h2 className="text-xl font-bold tracking-wide">ORDER #{selectedOrder.id}</h2>
                <button 
                  onClick={() => copyToClipboard(selectedOrder.id, 'Order #')}
                  className="bg-slate-700 hover:bg-slate-600 text-white text-xs px-2.5 py-1 rounded font-medium flex items-center space-x-1 cursor-pointer"
                >
                  <span>📋 Copy Order #</span>
                </button>
              </div>
              <span className={`text-xs px-2.5 py-1 rounded font-semibold ${selectedOrder.tag === 'ENT' ? 'bg-emerald-600 text-white' : selectedOrder.tag === 'HOLD' ? 'bg-amber-600 text-white' : 'bg-blue-600 text-white'}`}>{selectedOrder.tag}</span>
            </div>

            <div className="space-y-4 bg-[#161f36]/40 p-5 rounded-xl border border-[#1c2541]">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">ORDER #</label>
                  <input type="text" value={selectedOrder.id} onChange={(e) => handleInputChange('id', e.target.value)} className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white outline-none" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">VISIBILITY GROUP</label>
                  <input type="text" value={selectedOrder.visibilityGroup || 'ANQ'} onChange={(e) => handleInputChange('visibilityGroup', e.target.value)} className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white font-mono" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">EQUIPMENT</label>
                  <input type="text" value={selectedOrder.eCode} onChange={(e) => handleInputChange('eCode', e.target.value)} className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white outline-none" />
                  <div className="text-[11px] text-emerald-400 mt-1 font-mono">{getEquipmentDescription(selectedOrder.eCode)}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Brokerable (true / false)</label>
                  <input type="text" value={selectedOrder.brokerable || 'false'} onChange={(e) => handleInputChange('brokerable', e.target.value)} className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white font-mono" placeholder="false" />
                </div>
              </div>

              <div className="border border-[#1c2541] bg-[#121829]/60 p-4 rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-wide flex items-center">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 mr-2"></span> Pickup Details
                  </h3>
                  <button 
                    onClick={() => copyToClipboard(`${selectedOrder.origCity}, ${selectedOrder.origSt}`, 'Origin City & State')}
                    className="bg-slate-700 hover:bg-slate-600 text-white text-[11px] px-2 py-0.5 rounded font-medium cursor-pointer"
                  >
                    📋 Copy Origin City/State
                  </button>
                </div>
                
                <div className="mb-3">
                  <label className="text-xs text-gray-400 block mb-1">Pickup Time (Early - Late)</label>
                  <input 
                    type="text" 
                    value={selectedOrder.pickupTime || ''} 
                    onChange={(e) => handleInputChange('pickupTime', e.target.value)} 
                    className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white font-mono" 
                  />
                </div>

                <div className="grid grid-cols-3 gap-2 mb-3">
                  <input type="text" value={selectedOrder.origCity} onChange={(e) => handleInputChange('origCity', e.target.value)} className="bg-[#0b132b] border border-[#1c2541] rounded p-2 text-xs text-white" placeholder="Origin City" />
                  <input type="text" value={selectedOrder.origSt} onChange={(e) => handleInputChange('origSt', e.target.value)} className="bg-[#0b132b] border border-[#1c2541] rounded p-2 text-xs text-white" placeholder="State" />
                  <input type="text" value={selectedOrder.origZip} onChange={(e) => handleInputChange('origZip', e.target.value)} className="bg-[#0b132b] border border-[#1c2541] rounded p-2 text-xs text-white" placeholder="Zip" />
                </div>
                
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Weight</label>
                    <div className="flex space-x-2">
                      <input type="text" value={selectedOrder.weight} onChange={(e) => handleInputChange('weight', e.target.value)} className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-xs text-white" />
                      <button onClick={() => copyToClipboard(selectedOrder.weight, 'Weight')} className="bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded text-xs cursor-pointer">📋 Copy</button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="border border-[#1c2541] bg-[#121829]/60 p-4 rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold text-blue-400 uppercase tracking-wide flex items-center">
                    <span className="w-2 h-2 rounded-full bg-blue-400 mr-2"></span> Delivery Details
                  </h3>
                  <button 
                    onClick={() => copyToClipboard(`${selectedOrder.destCity}, ${selectedOrder.destSt}`, 'Destination City & State')}
                    className="bg-slate-700 hover:bg-slate-600 text-white text-[11px] px-2 py-0.5 rounded font-medium cursor-pointer"
                  >
                    📋 Copy Dest City/State
                  </button>
                </div>

                <div className="mb-3">
                  <label className="text-xs text-gray-400 block mb-1">Delivery Time (Early - Late)</label>
                  <input 
                    type="text" 
                    value={selectedOrder.deliveryTime || ''} 
                    onChange={(e) => handleInputChange('deliveryTime', e.target.value)} 
                    className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white font-mono" 
                  />
                </div>

                <div className="grid grid-cols-3 gap-2 mb-3">
                  <input type="text" value={selectedOrder.destCity} onChange={(e) => handleInputChange('destCity', e.target.value)} className="bg-[#0b132b] border border-[#1c2541] rounded p-2 text-xs text-white" placeholder="Destination City" />
                  <input type="text" value={selectedOrder.destSt} onChange={(e) => handleInputChange('destSt', e.target.value)} className="bg-[#0b132b] border border-[#1c2541] rounded p-2 text-xs text-white" placeholder="State" />
                  <input type="text" value={selectedOrder.destZip} onChange={(e) => handleInputChange('destZip', e.target.value)} className="bg-[#0b132b] border border-[#1c2541] rounded p-2 text-xs text-white" placeholder="Zip" />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Miles</label>
                    <div className="flex space-x-2">
                      <input type="text" value={selectedOrder.miles} onChange={(e) => handleInputChange('miles', e.target.value)} className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-xs text-white" />
                      <button onClick={() => copyToClipboard(selectedOrder.miles, 'Miles')} className="bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded text-xs cursor-pointer">📋 Copy</button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-emerald-400 block mb-1 font-bold">Rate ($) [Auto DAT]</label>
                    <input type="text" value={selectedOrder.rateInput} onChange={(e) => handleInputChange('rateInput', e.target.value)} className="w-full bg-[#0b132b] border border-emerald-500/60 rounded p-2 text-sm text-white font-mono font-bold" />
                  </div>
                </div>
              </div>

              {/* Carrier & Equipment Assignment */}
              <div className="border border-[#1c2541] bg-[#121829]/60 p-4 rounded-lg">
                <h3 className="text-xs font-bold text-purple-400 uppercase tracking-wide mb-3">Carrier & Equipment Assignment</h3>
                <div className="grid grid-cols-2 gap-4 mb-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Carrier Name</label>
                    <input type="text" value={selectedOrder.carrier} onChange={(e) => handleInputChange('carrier', e.target.value)} placeholder="Enter carrier name" className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Driver Name</label>
                    <input type="text" value={selectedOrder.driver} onChange={(e) => handleInputChange('driver', e.target.value)} placeholder="Enter driver name" className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Truck #</label>
                    <input type="text" value={selectedOrder.truck} onChange={(e) => handleInputChange('truck', e.target.value)} placeholder="Truck number" className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Trailer #</label>
                    <input type="text" value={selectedOrder.trailer} onChange={(e) => handleInputChange('trailer', e.target.value)} placeholder="Trailer number" className="w-full bg-[#0b132b] border border-[#1c2541] rounded p-2 text-sm text-white" />
                  </div>
                </div>
              </div>

              {/* Planning Comment Box */}
              <div className="bg-amber-950/30 border border-amber-600/50 p-3 rounded-lg">
                <span className="text-[11px] font-bold text-amber-400 block mb-1 uppercase">Planning Comment</span>
                <input 
                  type="text" 
                  value={selectedOrder.planningComment} 
                  onChange={(e) => handleInputChange('planningComment', e.target.value)} 
                  className="w-full bg-[#0b132b] border border-amber-600/30 rounded p-1.5 text-xs text-amber-200 font-mono outline-none" 
                />
              </div>

              {/* DAT Market Rate Reference */}
              <div className="border border-emerald-500/40 bg-emerald-950/20 p-4 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-emerald-400 uppercase tracking-wide">DAT Market Rate Reference</span>
                  <button onClick={() => window.open('https://iq.dat.com/rateview/torrance-ca~minersville-pa~van', '_blank')} className="bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] px-3 py-1.5 rounded font-semibold cursor-pointer">
                    Open [RateView - DAT iQ](https://iq.dat.com/rateview/torrance-ca~minersville-pa~van)
                  </button>
                </div>
                <div className="text-xs text-gray-300 font-mono bg-[#0b132b] p-2.5 rounded border border-[#1c2541] flex justify-between items-center">
                  <span>30-Day Market Median: ${calculateDATMarketRate(selectedOrder.origCity, selectedOrder.destCity, selectedOrder.miles)} (Best Fit for {selectedOrder.origCity} to {selectedOrder.destCity} @ $3.18/mi)</span>
                  <span className="text-emerald-400 font-bold">Auto-Filled</span>
                </div>
              </div>

              <div className="flex justify-between items-center pt-4 border-t border-[#1c2541]">
                <button onClick={handleDelete} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded text-sm font-medium transition-colors cursor-pointer">Delete</button>
                <button onClick={handleSave} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded text-sm font-semibold flex-1 ml-4 transition-colors shadow-lg cursor-pointer">Save Changes</button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            No order selected. Upload an Excel spreadsheet or select an order from the list.
          </div>
        )}
      </div>
    </div>
  );
}