/* AFH Expense Tracker — renderer logic */

const CAT_META = {
  medications: { label: 'Medications & OTC', icon: '💊', color: '#185FA5', care: true },
  medical: { label: 'Medical Supplies', icon: '🩺', color: '#1D9E75', care: true },
  personal_care: { label: 'Personal Care', icon: '🧴', color: '#634ECA', care: true },
  nutrition: { label: 'Nutrition & Diet', icon: '🥗', color: '#854F0B', care: true },
  activities: { label: 'Activities', icon: '🎨', color: '#A32D2D', care: true },
  transport: { label: 'Transportation', icon: '🚗', color: '#378ADD', care: true },
  housekeeping: { label: 'Housekeeping', icon: '🧹', color: '#6B6B67', care: false },
  maintenance: { label: 'Maintenance', icon: '🔧', color: '#5C4D7D', care: false },
  safety: { label: 'Safety', icon: '🦺', color: '#C44D2D', care: false },
  office: { label: 'Admin', icon: '📎', color: '#4A6FA5', care: false },
  food: { label: 'Food & Groceries', icon: '🛒', color: '#3B6D11', care: false },
  utilities: { label: 'Utilities', icon: '💡', color: '#854F0B', care: false },
};

const PAID_LABELS = {
  facility: 'Facility',
  resident: 'Resident funds',
  petty_cash: 'Petty cash',
  caregiver: 'Caregiver (reimb.)',
};

const MED_CATS = new Set(['medications', 'medical']);
const OPS_CATS = new Set(['housekeeping', 'maintenance', 'safety', 'office', 'food', 'utilities']);

let db = { budget: 500, days: {} };
let currentFilter = 'all';
let pieChartInst = null;
let barChartInst = null;
let confirmCallback = null;

const $ = (id) => document.getElementById(id);

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function formatDateLabel(iso) {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatMoney(n) {
  return '$' + (Number(n) || 0).toFixed(2);
}

function getTrackDate() {
  return $('trackDate').value || todayISO();
}

function dayEntries() {
  const key = getTrackDate();
  if (!db.days[key]) db.days[key] = [];
  return db.days[key];
}

function getBudget() {
  const v = parseFloat($('budgetInput').value);
  return Number.isFinite(v) && v >= 0 ? v : db.budget || 500;
}

async function persist() {
  db.budget = getBudget();
  if (window.electronAPI) await window.electronAPI.saveDB(db);
}

async function init() {
  if (window.electronAPI) {
    const loaded = await window.electronAPI.loadDB();
    if (loaded && typeof loaded === 'object') {
      db = migrateDB(loaded);
    }
  }
  $('trackDate').value = todayISO();
  $('budgetInput').value = db.budget ?? 500;
  $('trackDate').addEventListener('change', onDateChange);
  $('budgetInput').addEventListener('input', () => { refreshAll(); persist(); });
  $('reportDate').textContent = formatDateLabel(getTrackDate());
  refreshAll();
}

function migrateDB(loaded) {
  if (loaded.days) return loaded;
  const days = {};
  for (const [k, v] of Object.entries(loaded)) {
    if (k === 'budget') continue;
    if (Array.isArray(v)) days[k] = v;
  }
  return { budget: loaded.budget ?? 500, days };
}

function onDateChange() {
  const iso = getTrackDate();
  $('todayPill').style.display = iso === todayISO() ? 'inline-block' : 'none';
  $('reportDate').textContent = formatDateLabel(iso);
  refreshAll();
}

function refreshAll() {
  updateDashboard();
  updateBudgetBar();
  renderEntryList();
  renderReport();
}

function totalForEntries(entries) {
  return entries.reduce((s, e) => s + lineTotal(e), 0);
}

function lineTotal(e) {
  return (Number(e.amount) || 0) * (Number(e.qty) || 1);
}

function updateBudgetBar() {
  const budget = getBudget();
  const spent = totalForEntries(dayEntries());
  const remain = Math.max(0, budget - spent);
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
  const fill = $('budgetBarFill');
  fill.style.width = pct + '%';
  fill.style.background = pct >= 100 ? '#A32D2D' : pct >= 80 ? '#854F0B' : '#3B6D11';
  $('budgetRemain').textContent =
    spent > budget
      ? formatMoney(spent - budget) + ' over budget'
      : formatMoney(remain) + ' remaining';
}

function updateDashboard() {
  const entries = dayEntries();
  const total = totalForEntries(entries);
  const budget = getBudget();
  const reimb = entries.filter((e) => e.reimb).reduce((s, e) => s + lineTotal(e), 0);
  const med = entries.filter((e) => MED_CATS.has(e.category)).reduce((s, e) => s + lineTotal(e), 0);
  const ops = entries.filter((e) => OPS_CATS.has(e.category)).reduce((s, e) => s + lineTotal(e), 0);
  const receipts = entries.filter((e) => e.receipt).length;

  $('totalSpent').textContent = formatMoney(total);
  $('reimbTotal').textContent = formatMoney(reimb);
  $('medTotal').textContent = formatMoney(med);
  $('opsTotal').textContent = formatMoney(ops);
  $('entryCount').textContent = String(entries.length);
  $('receiptCount').textContent = receipts + ' receipt' + (receipts === 1 ? '' : 's') + ' on file';

  const levelPct = budget > 0 ? Math.min(100, (total / budget) * 100) : 0;
  $('moneyFill').style.height = levelPct + '%';
  $('moneyFill').style.background = levelPct >= 100 ? '#A32D2D' : levelPct >= 80 ? '#854F0B' : '#3B6D11';

  if (entries.length === 0) {
    $('spendLevel').textContent = 'No expenses logged';
  } else if (total > budget) {
    $('spendLevel').textContent = 'Over daily budget';
  } else if (levelPct >= 80) {
    $('spendLevel').textContent = Math.round(levelPct) + '% of budget used';
  } else {
    $('spendLevel').textContent = Math.round(levelPct) + '% of budget used';
  }

  const banner = $('alertBanner');
  if (total > budget) {
    banner.style.display = 'flex';
    banner.className = 'alert-banner warn';
    banner.textContent = '⚠ Spending exceeds the daily budget of ' + formatMoney(budget) + '.';
  } else if (levelPct >= 80 && entries.length > 0) {
    banner.style.display = 'flex';
    banner.className = 'alert-banner warn';
    banner.textContent = '⚠ Approaching daily budget (' + Math.round(levelPct) + '% used).';
  } else {
    banner.style.display = 'none';
  }

  updateCharts(entries, total);
  updateCompGrid(entries, total);
}

function categoryTotals(entries) {
  const map = {};
  for (const e of entries) {
    const c = e.category || 'office';
    map[c] = (map[c] || 0) + lineTotal(e);
  }
  return map;
}

function updateCharts(entries, total) {
  const hasData = entries.length > 0 && total > 0;
  $('pieEmpty').style.display = hasData ? 'none' : 'block';
  $('pieWrap').style.display = hasData ? 'block' : 'none';
  $('barEmpty').style.display = hasData ? 'none' : 'block';
  $('barWrap').style.display = hasData ? 'block' : 'none';
  if (!hasData || typeof Chart === 'undefined') return;

  const totals = categoryTotals(entries);
  const labels = [];
  const values = [];
  const colors = [];
  for (const [cat, amt] of Object.entries(totals).sort((a, b) => b[1] - a[1])) {
    const meta = CAT_META[cat] || { label: cat, color: '#888' };
    labels.push(meta.label);
    values.push(amt);
    colors.push(meta.color);
  }

  if (pieChartInst) pieChartInst.destroy();
  pieChartInst = new Chart($('pieChart'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      cutout: '58%',
    },
  });

  const legend = $('pieLegend');
  legend.innerHTML = labels
    .map((name, i) => {
      const pct = total > 0 ? Math.round((values[i] / total) * 100) : 0;
      return `<div class="legend-item"><span class="legend-dot" style="background:${colors[i]}"></span><span class="legend-name">${name}</span><span class="legend-pct">${pct}%</span><span class="legend-amt">${formatMoney(values[i])}</span></div>`;
    })
    .join('');

  if (barChartInst) barChartInst.destroy();
  barChartInst = new Chart($('barChart'), {
    type: 'bar',
    data: {
      labels: labels.map((l) => (l.length > 14 ? l.slice(0, 12) + '…' : l)),
      datasets: [{ data: values, backgroundColor: colors, borderRadius: 4 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { callback: (v) => '$' + v } },
        x: { ticks: { font: { size: 10 } } },
      },
    },
  });
}

function updateCompGrid(entries, total) {
  const grid = $('compGrid');
  if (!entries.length) {
    grid.innerHTML = '<div class="no-data" style="grid-column:1/-1">Log expenses to see care spend overview.</div>';
    return;
  }
  const careCats = Object.keys(CAT_META).filter((k) => CAT_META[k].care);
  const careEntries = entries.filter((e) => careCats.includes(e.category));
  const careTotal = totalForEntries(careEntries);
  const byCat = categoryTotals(careEntries);

  grid.innerHTML = careCats
    .filter((c) => byCat[c])
    .map((c) => {
      const meta = CAT_META[c];
      const amt = byCat[c];
      const pct = careTotal > 0 ? Math.round((amt / careTotal) * 100) : 0;
      const barPct = total > 0 ? (amt / total) * 100 : 0;
      return `<div class="comp-item"><div class="comp-cat">${meta.icon} ${meta.label}</div><div class="comp-bar-bg"><div class="comp-bar" style="width:${barPct}%;background:${meta.color}"></div></div><div class="comp-amt">${formatMoney(amt)} <span class="comp-pct">(${pct}% of care)</span></div></div>`;
    })
    .join('') || '<div class="no-data" style="grid-column:1/-1">No resident care expenses yet today.</div>';
}

function filteredEntries() {
  const entries = dayEntries();
  if (currentFilter === 'all') return entries;
  return entries.filter((e) => e.category === currentFilter);
}

function renderEntryList() {
  const list = $('entryList');
  const entries = filteredEntries().slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  if (!entries.length) {
    list.innerHTML = '<div class="no-data">No expenses for this filter.</div>';
    return;
  }
  list.innerHTML = entries
    .map((e) => {
      const meta = CAT_META[e.category] || { label: e.category, icon: '📋', color: '#888' };
      const paid = PAID_LABELS[e.paidBy] || e.paidBy;
      const badges = [
        e.receipt ? '<span class="badge badge-receipt">Receipt</span>' : '',
        e.reimb ? '<span class="badge badge-reimb">Reimb.</span>' : '',
      ].join('');
      return `<div class="entry-card">
        <div class="entry-icon" style="background:${meta.color}22">${meta.icon}</div>
        <div class="entry-main">
          <div class="entry-name">${escapeHtml(e.name)}</div>
          <div class="entry-meta">
            <span>${meta.label}</span>
            <span>·</span>
            <span>${paid}</span>
            ${e.vendor ? `<span>·</span><span>${escapeHtml(e.vendor)}</span>` : ''}
            ${e.resident ? `<span>·</span><span>${escapeHtml(e.resident)}</span>` : ''}
            <span>·</span><span>${formatTime(e.createdAt)}</span>
            ${badges}
          </div>
        </div>
        <div class="entry-amount">${formatMoney(lineTotal(e))}</div>
        <button class="del-btn" onclick="deleteEntry('${e.id}')">✕ Delete</button>
      </div>`;
    })
    .join('');
}

function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderReport() {
  const entries = dayEntries().slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const body = $('reportBody');
  const foot = $('reportFoot');
  $('reportEmpty').style.display = entries.length ? 'none' : 'block';
  $('reportTable').style.display = entries.length ? 'table' : 'none';

  body.innerHTML = entries
    .map((e) => {
      const meta = CAT_META[e.category] || { label: e.category };
      return `<tr>
        <td>${formatTime(e.createdAt)}</td>
        <td>${escapeHtml(e.name)}</td>
        <td>${meta.label}</td>
        <td>${escapeHtml(e.resident || '—')}</td>
        <td>${escapeHtml(e.vendor || '—')}</td>
        <td>${PAID_LABELS[e.paidBy] || e.paidBy}</td>
        <td>${e.qty || 1}</td>
        <td>${formatMoney(lineTotal(e))}</td>
        <td>${e.receipt ? '✓' : '—'}</td>
        <td>${e.reimb ? '✓' : '—'}</td>
      </tr>`;
    })
    .join('');

  const total = totalForEntries(entries);
  foot.innerHTML = entries.length
    ? `<tr><td colspan="7"><strong>Total (${entries.length} entries)</strong></td><td><strong>${formatMoney(total)}</strong></td><td colspan="2"></td></tr>`
    : '';
}

function showTab(name) {
  document.querySelectorAll('.tab-content').forEach((el) => el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach((el) => el.classList.remove('active'));
  $('tab-' + name).classList.add('active');
  document.querySelector(`.nav-btn[onclick="showTab('${name}')"]`)?.classList.add('active');
  const titles = { dashboard: 'Dashboard', log: 'Expense Log', add: 'Add Expense', reports: 'Reports' };
  $('topbarTitle').textContent = titles[name] || name;
  if (name === 'reports') $('reportDate').textContent = formatDateLabel(getTrackDate());
  refreshAll();
}

function setFilter(cat, btn) {
  currentFilter = cat;
  document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  renderEntryList();
}

function addExpense() {
  const name = $('itemName').value.trim();
  const amount = parseFloat($('itemAmount').value);
  const category = $('itemCat').value;
  if (!name) {
    alert('Please enter an item description.');
    $('itemName').focus();
    return;
  }
  if (!Number.isFinite(amount) || amount < 0) {
    alert('Please enter a valid amount.');
    $('itemAmount').focus();
    return;
  }
  const entry = {
    id: crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now(),
    name,
    category,
    paidBy: $('itemPaidBy').value,
    amount,
    qty: parseInt($('itemQty').value, 10) || 1,
    vendor: $('itemVendor').value.trim(),
    resident: $('itemResident').value.trim(),
    receipt: $('itemReceipt').checked,
    reimb: $('itemReimb').checked,
    notes: $('itemNotes').value.trim(),
    createdAt: Date.now(),
  };
  dayEntries().push(entry);
  persist();
  clearForm();
  refreshAll();
  showTab('log');
  const banner = $('alertBanner');
  banner.style.display = 'flex';
  banner.className = 'alert-banner info';
  banner.textContent = '✓ Expense saved to ' + formatDateLabel(getTrackDate()) + '.';
  setTimeout(() => {
    if (!banner.classList.contains('warn')) banner.style.display = 'none';
  }, 3000);
}

function clearForm() {
  ['itemName', 'itemAmount', 'itemVendor', 'itemResident', 'itemNotes'].forEach((id) => {
    $(id).value = '';
  });
  $('itemCat').selectedIndex = 0;
  $('itemPaidBy').value = 'facility';
  $('itemQty').value = '1';
  $('itemReceipt').checked = false;
  $('itemReimb').checked = false;
}

function deleteEntry(id) {
  showConfirm('Delete this expense entry?', () => {
    const key = getTrackDate();
    db.days[key] = dayEntries().filter((e) => e.id !== id);
    persist();
    refreshAll();
  });
}

function askClearAll() {
  const date = formatDateLabel(getTrackDate());
  showConfirm(`Clear all expenses for ${date}? This cannot be undone.`, () => {
    db.days[getTrackDate()] = [];
    persist();
    refreshAll();
  }, 'Clear all');
}

function showConfirm(msg, callback, okLabel = 'Delete') {
  $('confirmMsg').textContent = msg;
  $('confirmOkBtn').textContent = okLabel;
  confirmCallback = callback;
  $('confirmOverlay').style.display = 'flex';
}

function cancelConfirm() {
  $('confirmOverlay').style.display = 'none';
  confirmCallback = null;
}

function doConfirm() {
  const fn = confirmCallback;
  cancelConfirm();
  if (fn) fn();
}

function buildCSV() {
  const entries = dayEntries().slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const date = getTrackDate();
  const rows = [
    ['AFH Daily Expense Report', date],
    [],
    ['Time', 'Item', 'Category', 'Resident', 'Vendor', 'Paid By', 'Qty', 'Amount', 'Receipt', 'Reimbursable', 'Notes'],
  ];
  for (const e of entries) {
    const meta = CAT_META[e.category] || { label: e.category };
    rows.push([
      formatTime(e.createdAt),
      e.name,
      meta.label,
      e.resident || '',
      e.vendor || '',
      PAID_LABELS[e.paidBy] || e.paidBy,
      e.qty || 1,
      lineTotal(e).toFixed(2),
      e.receipt ? 'Yes' : 'No',
      e.reimb ? 'Yes' : 'No',
      e.notes || '',
    ]);
  }
  rows.push([]);
  rows.push(['Total', '', '', '', '', '', '', totalForEntries(entries).toFixed(2)]);
  rows.push(['Daily budget', '', '', '', '', '', '', getBudget().toFixed(2)]);
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function exportCSV() {
  const csv = buildCSV();
  const name = `AFH_Expenses_${getTrackDate()}.csv`;
  if (window.electronAPI) {
    await window.electronAPI.exportCSV(csv, name);
  } else {
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
  }
}

document.addEventListener('DOMContentLoaded', init);
