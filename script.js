(function () {
  'use strict';

  const DEFAULT_API_BASE = 'https://cdcapi.onrender.com/api/';
  const LOCAL_API_BASE = 'http://localhost:3001/api/';

  const databaseSelect = document.getElementById('databaseSelect');
  const refreshBtn = document.getElementById('refreshBtn');
  const resetFiltersBtn = document.getElementById('resetFiltersBtn');
  const saveAllChangesBtn = document.getElementById('saveAllChangesBtn');
  const pendingChangesText = document.getElementById('pendingChangesText');
  const tableBody = document.getElementById('tableBody');
  const recordCount = document.getElementById('recordCount');
  const lastUpdated = document.getElementById('lastUpdated');
  const errorMessage = document.getElementById('errorMessage');

  const filterPoNumber = document.getElementById('filterPoNumber');
  const filterSupplier = document.getElementById('filterSupplier');
  const filterItemCode = document.getElementById('filterItemCode');
  const filterItemName = document.getElementById('filterItemName');
  const filterItemGroup = document.getElementById('filterItemGroup');
  const filterQuality = document.getElementById('filterQuality');
  const filterJobBookingNo = document.getElementById('filterJobBookingNo');
  const filterFromExpectedDate = document.getElementById('filterFromExpectedDate');
  const filterToExpectedDate = document.getElementById('filterToExpectedDate');
  const filterMinPendingQty = document.getElementById('filterMinPendingQty');
  const filterMaxPendingQty = document.getElementById('filterMaxPendingQty');
  const filterExactGsm = document.getElementById('filterExactGsm');
  const filterMinGsm = document.getElementById('filterMinGsm');
  const filterMaxGsm = document.getElementById('filterMaxGsm');
  const filterExactSizeW = document.getElementById('filterExactSizeW');
  const filterMinSizeW = document.getElementById('filterMinSizeW');
  const filterMaxSizeW = document.getElementById('filterMaxSizeW');
  const filterExactSizeL = document.getElementById('filterExactSizeL');
  const filterMinSizeL = document.getElementById('filterMinSizeL');
  const filterMaxSizeL = document.getElementById('filterMaxSizeL');

  const filterInputs = [
    filterPoNumber,
    filterSupplier,
    filterItemCode,
    filterItemName,
    filterItemGroup,
    filterQuality,
    filterJobBookingNo,
    filterFromExpectedDate,
    filterToExpectedDate,
    filterExactGsm,
    filterMinGsm,
    filterMaxGsm,
    filterExactSizeW,
    filterMinSizeW,
    filterMaxSizeW,
    filterExactSizeL,
    filterMinSizeL,
    filterMaxSizeL,
    filterMinPendingQty,
    filterMaxPendingQty
  ];

  let sourceRows = [];
  const editedDates = new Map();
  const rowSaving = new Set();
  const rowClosing = new Set();
  const rowErrors = new Map();
  let isBulkSaving = false;

  function isValidAbsoluteUrl(value) {
    if (!value || typeof value !== 'string') return false;
    const val = value.trim();
    if (!(val.startsWith('http://') || val.startsWith('https://'))) return false;
    try {
      new URL(val);
      return true;
    } catch (_e) {
      return false;
    }
  }

  function isLocalFrontend() {
    try {
      const protocol = String(window.location.protocol || '').toLowerCase();
      const host = String(window.location.hostname || '').toLowerCase();
      return protocol === 'file:' || !host || host === 'localhost' || host === '127.0.0.1' || host === '::1';
    } catch (_e) {
      return false;
    }
  }

  function getApiBaseUrl() {
    try {
      const stored = localStorage.getItem('pending_po_api_base');
      const defaultBase = isLocalFrontend() ? LOCAL_API_BASE : DEFAULT_API_BASE;
      const selected = isValidAbsoluteUrl(stored) ? stored : defaultBase;
      return selected.endsWith('/') ? selected : selected + '/';
    } catch (_e) {
      return isLocalFrontend() ? LOCAL_API_BASE : DEFAULT_API_BASE;
    }
  }

  function toDateOnly(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }

  function formatDate(value) {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('en-GB');
  }

  function isValidDateInput(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
  }

  function getRowKey(row) {
    return `c:${Number(row.poTransactionId || 0)}:${Number(row.itemId || 0)}`;
  }

  function getOriginalExpectedDate(row) {
    return toDateOnly(row.expectedDeliveryDate);
  }

  function getCurrentExpectedDate(row) {
    const key = getRowKey(row);
    if (editedDates.has(key)) return editedDates.get(key);
    return getOriginalExpectedDate(row);
  }

  function isRowDirty(row) {
    const key = getRowKey(row);
    if (!editedDates.has(key)) return false;
    return editedDates.get(key) !== getOriginalExpectedDate(row);
  }

  function formatNumber(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return '0';
    return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  function numberInRange(value, minStr, maxStr) {
    const n = Number(value);
    const minOk = minStr === '' || (Number.isFinite(n) && n >= Number(minStr));
    const maxOk = maxStr === '' || (Number.isFinite(n) && n <= Number(maxStr));
    return minOk && maxOk;
  }

  /** When exactStr is non-empty, value must equal that number (Min/Max ignored for that column). */
  function numberMatchesFilter(value, exactStr, minStr, maxStr) {
    const n = Number(value);
    const exact = exactStr.trim();
    if (exact !== '') {
      const target = Number(exact);
      if (!Number.isFinite(n) || !Number.isFinite(target)) return false;
      return n === target;
    }
    return numberInRange(value, minStr, maxStr);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderRows(rows) {
    if (!rows.length) {
      tableBody.innerHTML = '<tr><td colspan="18" class="empty-row">No records found.</td></tr>';
      recordCount.textContent = '0 records';
      return;
    }

    tableBody.innerHTML = rows.map((row) => {
      const rowKey = getRowKey(row);
      const dateValue = getCurrentExpectedDate(row);
      const dirty = isRowDirty(row);
      const saving = rowSaving.has(rowKey);
      const closing = rowClosing.has(rowKey);

      const dateDisplay = dirty ? formatDate(dateValue) : formatDate(row.expectedDeliveryDate);
      const closeBtnLabel = closing ? 'Closing…' : 'Close';
      const closeBtn = `<button type="button" class="btn-close-po" data-row-key="${escapeHtml(rowKey)}" data-po-transaction-id="${escapeHtml(row.poTransactionId)}" data-po-number="${escapeHtml(row.poNumber || '')}" ${closing ? 'disabled' : ''}>${closeBtnLabel}</button>`;

      const cells = [
        row.poNumber || '-',
        formatDate(row.poDate),
        `<span class="expected-date-display${dirty ? ' is-edited' : ''}" data-row-key="${escapeHtml(rowKey)}" data-date-value="${escapeHtml(dateValue)}" title="Click to edit">${escapeHtml(dateDisplay)}</span>`,
        row.supplier || '-',
        row.itemCode || '-',
        row.itemName || '-',
        row.itemGroupName || '-',
        row.quality || '-',
        row.gsm ?? 0,
        row.sizeW ?? 0,
        row.sizeL ?? 0,
        row.stockUnit || '-',
        formatNumber(row.poQty),
        formatNumber(row.receivedQty),
        formatNumber(row.pendingQty),
        row.jobBookingNo || '-',
        row.jobName || '-',
        closeBtn
      ];

      const rowClasses = [dirty ? 'dirty-row' : '', saving || closing ? 'row-saving' : ''].filter(Boolean).join(' ');
      return `<tr class="${rowClasses}" data-row-key="${escapeHtml(rowKey)}">${cells.map((cell, idx) => {
        if (idx === 2 || idx === 17) return `<td>${cell}</td>`;
        return `<td title="${escapeHtml(cell)}">${escapeHtml(cell)}</td>`;
      }).join('')}</tr>`;
    }).join('');

    recordCount.textContent = `${rows.length} records`;
  }

  function rowMatches(row) {
    const poQuery = filterPoNumber.value.trim().toLowerCase();
    const supplierQuery = filterSupplier.value.trim().toLowerCase();
    const itemCodeQuery = filterItemCode.value.trim().toLowerCase();
    const itemNameQuery = filterItemName.value.trim().toLowerCase();
    const itemGroupQuery = filterItemGroup.value.trim().toLowerCase();
    const qualityQuery = filterQuality.value.trim().toLowerCase();
    const jobBookingQuery = filterJobBookingNo.value.trim().toLowerCase();
    const fromDate = filterFromExpectedDate.value;
    const toDate = filterToExpectedDate.value;
    const minPending = filterMinPendingQty.value.trim();
    const maxPending = filterMaxPendingQty.value.trim();
    const exactGsm = filterExactGsm.value.trim();
    const minGsm = filterMinGsm.value.trim();
    const maxGsm = filterMaxGsm.value.trim();
    const exactSizeW = filterExactSizeW.value.trim();
    const minSizeW = filterMinSizeW.value.trim();
    const maxSizeW = filterMaxSizeW.value.trim();
    const exactSizeL = filterExactSizeL.value.trim();
    const minSizeL = filterMinSizeL.value.trim();
    const maxSizeL = filterMaxSizeL.value.trim();

    if (poQuery && !String(row.poNumber || '').toLowerCase().includes(poQuery)) return false;
    if (supplierQuery && !String(row.supplier || '').toLowerCase().includes(supplierQuery)) return false;
    if (itemCodeQuery && !String(row.itemCode || '').toLowerCase().includes(itemCodeQuery)) return false;
    if (itemNameQuery && !String(row.itemName || '').toLowerCase().includes(itemNameQuery)) return false;
    if (itemGroupQuery && !String(row.itemGroupName || '').toLowerCase().includes(itemGroupQuery)) return false;
    if (qualityQuery && !String(row.quality || '').toLowerCase().includes(qualityQuery)) return false;
    if (jobBookingQuery && !String(row.jobBookingNo || '').toLowerCase().includes(jobBookingQuery)) return false;

    const expectedDate = toDateOnly(row.expectedDeliveryDate);
    if (fromDate && (!expectedDate || expectedDate < fromDate)) return false;
    if (toDate && (!expectedDate || expectedDate > toDate)) return false;

    const pending = Number(row.pendingQty || 0);
    if (minPending !== '' && pending < Number(minPending)) return false;
    if (maxPending !== '' && pending > Number(maxPending)) return false;

    if (!numberMatchesFilter(row.gsm, exactGsm, minGsm, maxGsm)) return false;
    if (!numberMatchesFilter(row.sizeW, exactSizeW, minSizeW, maxSizeW)) return false;
    if (!numberMatchesFilter(row.sizeL, exactSizeL, minSizeL, maxSizeL)) return false;

    return true;
  }

  function applyFilters() {
    const filtered = sourceRows.filter(rowMatches);
    renderRows(filtered);
    updateBulkSaveControls();
  }

  function getDirtyRows() {
    return sourceRows.filter((row) => {
      const key = getRowKey(row);
      return isRowDirty(row) && isValidDateInput(getCurrentExpectedDate(row)) && !rowSaving.has(key);
    });
  }

  function updateBulkSaveControls() {
    if (!saveAllChangesBtn || !pendingChangesText) return;
    const dirtyRows = getDirtyRows();
    if (isBulkSaving) {
      saveAllChangesBtn.disabled = true;
      pendingChangesText.textContent = `Saving ${dirtyRows.length} row(s)...`;
      return;
    }
    saveAllChangesBtn.disabled = dirtyRows.length === 0;
    pendingChangesText.textContent = dirtyRows.length > 0
      ? `${dirtyRows.length} row(s) pending save`
      : 'No pending date changes';
  }

  async function saveExpectedDeliveryDate(rowKey) {
    const row = sourceRows.find((item) => getRowKey(item) === rowKey);
    if (!row) return { ok: false, error: 'Row not found' };
    const newDate = getCurrentExpectedDate(row);
    if (!isRowDirty(row) || !isValidDateInput(newDate)) return { ok: false, error: 'No valid change' };

    rowSaving.add(rowKey);
    rowErrors.delete(rowKey);

    try {
      const base = getApiBaseUrl();
      const url = new URL('grn/pending-po-expected-delivery-date', base);
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          database: String(databaseSelect.value || '').toUpperCase(),
          poTransactionId: row.poTransactionId,
          itemId: row.itemId,
          itemCode: row.itemCode,
          newExpectedDeliveryDate: newDate
        })
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.status !== true) {
        throw new Error(data?.error || 'Failed to save expected delivery date');
      }

      row.expectedDeliveryDate = newDate;
      editedDates.delete(rowKey);
      rowErrors.delete(rowKey);
      return { ok: true };
    } catch (err) {
      rowErrors.set(rowKey, String(err.message || err));
      return { ok: false, error: String(err.message || err) };
    } finally {
      rowSaving.delete(rowKey);
    }
  }

  async function saveAllExpectedDeliveryDates() {
    const dirtyRows = getDirtyRows();
    if (!dirtyRows.length || isBulkSaving) return;

    isBulkSaving = true;
    errorMessage.textContent = '';
    updateBulkSaveControls();

    let successCount = 0;
    const failedRows = [];
    for (const row of dirtyRows) {
      const rowKey = getRowKey(row);
      const result = await saveExpectedDeliveryDate(rowKey);
      if (result?.ok) {
        successCount += 1;
      } else if (result?.error) {
        failedRows.push(`${row.poNumber || '-'} / ${row.itemCode || '-'}`);
      }
    }

    isBulkSaving = false;
    if (successCount > 0) {
      lastUpdated.textContent = `Last updated: ${new Date().toLocaleString('en-GB')}`;
    }
    if (failedRows.length) {
      errorMessage.textContent = `Failed to update ${failedRows.length} row(s): ${failedRows.slice(0, 5).join(', ')}`;
    }
    applyFilters();
  }

  async function closePendingPo(rowKey) {
    const row = sourceRows.find((item) => getRowKey(item) === rowKey);
    if (!row) {
      errorMessage.textContent = 'Row not found.';
      return;
    }

    const poNo = row.poNumber || row.poTransactionId || '';
    const ok = window.confirm(
      `Close PO ${poNo} manually?\n\nThis will mark the purchase order as completed and cannot be undone from this screen.`
    );
    if (!ok) return;

    if (rowClosing.has(rowKey)) return;
    rowClosing.add(rowKey);
    errorMessage.textContent = '';
    applyFilters();

    try {
      const base = getApiBaseUrl();
      const url = new URL('grn/pending-po-close', base);
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          database: String(databaseSelect.value || '').toUpperCase(),
          poTransactionId: row.poTransactionId,
          completedBy: 2,
          reason: 'closed manually',
          dryRun: 0
        })
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.status !== true) {
        throw new Error(data?.error || `Failed to close PO (${res.status})`);
      }

      // SP closes the whole PO — remove all lines for this transaction from the list
      const closedTx = Number(row.poTransactionId);
      sourceRows = sourceRows.filter((r) => Number(r.poTransactionId) !== closedTx);
      for (const key of [...editedDates.keys()]) {
        if (key.startsWith(`c:${closedTx}:`)) editedDates.delete(key);
      }
      lastUpdated.textContent = `Last updated: ${new Date().toLocaleString('en-GB')} (closed PO ${poNo})`;
      applyFilters();
    } catch (err) {
      errorMessage.textContent = String(err.message || err);
      applyFilters();
    } finally {
      rowClosing.delete(rowKey);
      applyFilters();
    }
  }

  async function fetchPendingPoRows() {
    const selectedDatabase = String(databaseSelect.value || '').toUpperCase();
    if (selectedDatabase !== 'KOL' && selectedDatabase !== 'AHM') {
      errorMessage.textContent = 'Please select a valid database.';
      return;
    }

    errorMessage.textContent = '';
    tableBody.innerHTML = '<tr><td colspan="18" class="empty-row">Loading...</td></tr>';

    try {
      const base = getApiBaseUrl();
      const url = new URL('grn/pending-po-not-fully-delivered', base);
      url.searchParams.set('database', selectedDatabase);

      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        },
        credentials: 'include'
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || 'Failed to fetch pending PO records');
      }

      const data = await res.json();
      if (!data || data.status !== true) {
        throw new Error(data?.error || 'API returned unsuccessful response');
      }

      sourceRows = Array.isArray(data.records) ? data.records : [];
      editedDates.clear();
      rowSaving.clear();
      rowErrors.clear();
      applyFilters();
      lastUpdated.textContent = `Last updated: ${new Date().toLocaleString('en-GB')}`;
    } catch (err) {
      sourceRows = [];
      renderRows([]);
      errorMessage.textContent = String(err.message || err);
    }
  }

  function resetFilters() {
    filterInputs.forEach((input) => {
      input.value = '';
    });
    applyFilters();
  }

  function activateDateInput(displaySpan) {
    if (displaySpan.querySelector('input')) return;
    const rowKey = String(displaySpan.dataset.rowKey || '');
    if (!rowKey) return;
    if (rowSaving.has(rowKey)) return;

    const currentValue = String(displaySpan.dataset.dateValue || '');

    const input = document.createElement('input');
    input.type = 'date';
    input.className = 'expected-date-input';
    input.value = currentValue;
    input.dataset.rowKey = rowKey;

    displaySpan.textContent = '';
    displaySpan.appendChild(input);
    input.focus();
    input.select();

    input.addEventListener('input', () => {
      const newVal = input.value;
      if (newVal && isValidDateInput(newVal)) {
        editedDates.set(rowKey, newVal);
        rowErrors.delete(rowKey);
      }
      updateBulkSaveControls();
    });

    input.addEventListener('change', () => {
      const newVal = input.value;
      if (newVal && isValidDateInput(newVal)) {
        editedDates.set(rowKey, newVal);
        rowErrors.delete(rowKey);
      }
      updateBulkSaveControls();
    });

    input.addEventListener('blur', () => {
      const row = sourceRows.find((r) => getRowKey(r) === rowKey);
      if (!row) return;
      const value = input.value;
      if (!value || !isValidDateInput(value) || value === getOriginalExpectedDate(row)) {
        editedDates.delete(rowKey);
      }
      applyFilters();
    });
  }

  tableBody.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const closeBtn = target.closest('.btn-close-po');
    if (closeBtn) {
      event.preventDefault();
      const rowKey = closeBtn.getAttribute('data-row-key');
      if (rowKey) closePendingPo(rowKey);
      return;
    }

    const displaySpan = target.closest('.expected-date-display');
    if (displaySpan) {
      activateDateInput(displaySpan);
    }
  });

  refreshBtn.addEventListener('click', fetchPendingPoRows);
  resetFiltersBtn.addEventListener('click', resetFilters);
  saveAllChangesBtn?.addEventListener('click', saveAllExpectedDeliveryDates);
  databaseSelect.addEventListener('change', fetchPendingPoRows);
  filterInputs.forEach((input) => {
    const evtName = input.type === 'date' ? 'change' : 'input';
    input.addEventListener(evtName, applyFilters);
  });

  fetchPendingPoRows();
})();
