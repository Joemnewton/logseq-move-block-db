/**
 * Logseq Move Block Plugin (Database Version)
 * Workflowy-style "Move To" commands for Logseq DB graphs.
 *
 * Move blocks (with all children) to any page or journal day
 * via slash commands, keyboard shortcut, or block context menu.
 *
 * NOTE: This plugin is for Logseq Database (DB) graphs only.
 *
 * v1.0.0:
 * - Slash commands: /move, /move to page, /move to today, /move to journal
 * - Keyboard shortcut: Cmd+Shift+M (Mac) / Ctrl+Shift+M (Windows/Linux)
 * - Block context menu: "Move to..."
 * - Searchable page picker modal with keyboard navigation
 * - Recursive child block movement
 * - Property preservation
 * - Recent destinations tracking
 * - Configurable: append/prepend, confirmation toast
 */

// ─── Module State ───────────────────────────────────────────────────────────

let pendingBlockUuid = null;      // UUID of block waiting to be moved
let cachedPages = [];             // Cached page list (refreshed per modal open)
let recentDestinations = [];      // Session-local recent move targets
let selectedIndex = 0;            // Currently highlighted result in modal
let filteredResults = [];         // Current filtered results array
let modalVisible = false;         // Whether modal is currently shown
let modalFilter = '';             // Current filter mode: '' | 'pages' | 'journals'

// ─── Constants ──────────────────────────────────────────────────────────────

const MODAL_KEY = 'move-block-modal';
const MAX_VISIBLE_RESULTS = 10;

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
  console.log('📦 Move Block plugin v1.0.0 (DB Version) starting...');

  // ── Settings ──────────────────────────────────────────────────────────────

  logseq.useSettingsSchema([
    {
      key: "movePosition",
      type: "enum",
      title: "Move Position",
      description: "Where to place the moved block on the destination page",
      default: "bottom",
      enumChoices: ["bottom", "top"],
      enumPicker: "radio"
    },
    {
      key: "showConfirmation",
      type: "boolean",
      title: "Show Confirmation",
      description: "Show a toast notification after moving a block",
      default: true
    },
    {
      key: "navigateAfterMove",
      type: "enum",
      title: "After Moving",
      description: "Stay on the current page or navigate to the destination page after moving a block",
      default: "stay",
      enumChoices: ["stay", "navigate"],
      enumPicker: "radio"
    },
    {
      key: "maxRecentDestinations",
      type: "number",
      title: "Recent Destinations",
      description: "Number of recent move destinations to remember (1-20)",
      default: 5
    }
  ]);

  // ── Register Model (UI event handlers) ────────────────────────────────────

  logseq.provideModel({
    closeModal() {
      hideModal();
    },
    selectResult(e) {
      const pageName = e.dataset.pageName;
      if (pageName) {
        hideModal();
        performMove(pageName);
      }
    }
  });

  // ── Inject Styles ─────────────────────────────────────────────────────────

  logseq.provideStyle(`
    .move-block-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.4);
      z-index: 9998;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: 15vh;
    }

    .move-block-modal {
      background: var(--ls-primary-background-color, #fff);
      border: 1px solid var(--ls-border-color, #ddd);
      border-radius: 12px;
      width: 480px;
      max-height: 440px;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.2);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      font-family: var(--ls-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
    }

    .move-block-header {
      padding: 16px 16px 0 16px;
    }

    .move-block-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--ls-secondary-text-color, #666);
      margin-bottom: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .move-block-input {
      width: 100%;
      padding: 10px 12px;
      font-size: 15px;
      border: 1px solid var(--ls-border-color, #ddd);
      border-radius: 8px;
      background: var(--ls-secondary-background-color, #f5f5f5);
      color: var(--ls-primary-text-color, #333);
      outline: none;
      box-sizing: border-box;
      font-family: inherit;
    }

    .move-block-input:focus {
      border-color: var(--ls-link-text-color, #4C9EEB);
      box-shadow: 0 0 0 2px rgba(76, 158, 235, 0.2);
    }

    .move-block-results {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
      margin-top: 8px;
    }

    .move-block-section-label {
      font-size: 11px;
      font-weight: 600;
      color: var(--ls-secondary-text-color, #999);
      padding: 6px 16px 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .move-block-result {
      padding: 8px 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      color: var(--ls-primary-text-color, #333);
      transition: background 0.1s;
    }

    .move-block-result:hover,
    .move-block-result.selected {
      background: var(--ls-quaternary-background-color, rgba(76, 158, 235, 0.1));
    }

    .move-block-result-icon {
      font-size: 16px;
      flex-shrink: 0;
      width: 20px;
      text-align: center;
    }

    .move-block-result-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .move-block-empty {
      padding: 24px 16px;
      text-align: center;
      color: var(--ls-secondary-text-color, #999);
      font-size: 14px;
    }

    .move-block-hint {
      padding: 8px 16px;
      font-size: 12px;
      color: var(--ls-secondary-text-color, #999);
      border-top: 1px solid var(--ls-border-color, #eee);
      display: flex;
      gap: 12px;
    }

    .move-block-hint kbd {
      background: var(--ls-secondary-background-color, #f0f0f0);
      border: 1px solid var(--ls-border-color, #ddd);
      border-radius: 3px;
      padding: 1px 5px;
      font-size: 11px;
      font-family: inherit;
    }
  `);

  // ── Slash Commands ────────────────────────────────────────────────────────

  logseq.Editor.registerSlashCommand('move', async (e) => {
    console.log('📦 /move command triggered, event:', e);
    if (e && e.uuid) pendingBlockUuid = e.uuid;
    await openMoveModal('');
  });

  logseq.Editor.registerSlashCommand('move to page', async (e) => {
    console.log('📦 /move to page command triggered, event:', e);
    if (e && e.uuid) pendingBlockUuid = e.uuid;
    await openMoveModal('pages');
  });

  logseq.Editor.registerSlashCommand('move to today', async (e) => {
    console.log('📦 /move to today command triggered, event:', e);
    if (e && e.uuid) pendingBlockUuid = e.uuid;
    await moveCurrentBlockToToday();
  });

  logseq.Editor.registerSlashCommand('move to journal', async (e) => {
    console.log('📦 /move to journal command triggered, event:', e);
    if (e && e.uuid) pendingBlockUuid = e.uuid;
    await openMoveModal('journals');
  });

  // ── Keyboard Shortcut ─────────────────────────────────────────────────────

  logseq.App.registerCommandPalette({
    key: 'move-block',
    label: 'Move block to another page',
    keybinding: {
      mode: 'global',
      binding: 'mod+shift+m'
    }
  }, async () => {
    console.log('📦 Move block shortcut triggered');
    await openMoveModal('');
  });

  // ── Block Context Menu ────────────────────────────────────────────────────

  logseq.Editor.registerBlockContextMenuItem('Move to...', async ({ uuid }) => {
    console.log('📦 Move to... context menu triggered for block:', uuid);
    pendingBlockUuid = uuid;
    await openMoveModal('');
  });

  // ── Settings Change Listener ──────────────────────────────────────────────

  logseq.onSettingsChanged((newSettings, oldSettings) => {
    console.log('⚙️ Move Block settings changed');
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────

  logseq.beforeunload(async () => {
    console.log('👋 Move Block plugin unloading...');
    pendingBlockUuid = null;
    cachedPages = [];
    recentDestinations = [];
    modalVisible = false;
  });

  console.log('✅ Move Block plugin (DB Version) loaded');
}

// ─── Modal ──────────────────────────────────────────────────────────────────

/**
 * Open the move-to search modal
 * @param {string} filter - '' for all, 'pages' for pages only, 'journals' for journals only
 */
async function openMoveModal(filter) {
  try {
    // Get the current block if we don't have one set from slash command or context menu
    if (!pendingBlockUuid) {
      // Try getCurrentBlock first (works when editing)
      let currentBlock = await logseq.Editor.getCurrentBlock();

      // Fallback: try getSelectedBlocks (works when block is selected but not editing)
      if (!currentBlock) {
        const selected = await logseq.Editor.getSelectedBlocks();
        if (selected && selected.length > 0) {
          currentBlock = selected[0];
        }
      }

      if (!currentBlock) {
        await logseq.UI.showMsg('No block selected. Place your cursor in a block first.', 'warning');
        return;
      }
      pendingBlockUuid = currentBlock.uuid;
    }

    console.log('📦 Opening move modal for block:', pendingBlockUuid);

    // Fetch all pages
    modalFilter = filter;
    cachedPages = await fetchPages();

    // Build initial results
    selectedIndex = 0;
    buildFilteredResults('');

    // Show modal
    modalVisible = true;
    renderModal('');

    // Focus the input after a brief delay (DOM needs to mount)
    setTimeout(() => {
      const input = parent.document.querySelector('.move-block-input');
      if (input) {
        input.focus();
        setupModalKeyboardHandlers(input);
      }
    }, 100);

  } catch (error) {
    console.error('❌ Error opening move modal:', error);
    await logseq.UI.showMsg('Failed to open move dialog.', 'warning');
    pendingBlockUuid = null;
  }
}

/**
 * Render or update the modal HTML
 */
function renderModal(searchText) {
  const resultsHtml = buildResultsHtml();

  const template = `
    <div class="move-block-overlay" data-on-click="closeModal">
      <div class="move-block-modal" onclick="event.stopPropagation()">
        <div class="move-block-header">
          <div class="move-block-title">Move block to${modalFilter === 'pages' ? ' page' : modalFilter === 'journals' ? ' journal' : ''}...</div>
          <input
            class="move-block-input"
            type="text"
            placeholder="${modalFilter === 'journals' ? 'Search journals...' : 'Search pages...'}"
            value="${escapeHtml(searchText)}"
          />
        </div>
        <div class="move-block-results">
          ${resultsHtml}
        </div>
        <div class="move-block-hint">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>Enter</kbd> move</span>
          <span><kbd>Esc</kbd> cancel</span>
        </div>
      </div>
    </div>
  `;

  logseq.provideUI({
    key: MODAL_KEY,
    path: '#app-container',
    template: template,
    style: { zIndex: 9999 },
    attrs: { title: '' },
    reset: true
  });
}

/**
 * Build HTML for the results list
 */
function buildResultsHtml() {
  if (filteredResults.length === 0) {
    return '<div class="move-block-empty">No matching pages found</div>';
  }

  let html = '';
  let lastSection = '';

  filteredResults.forEach((item, index) => {
    // Section header
    if (item.section !== lastSection) {
      lastSection = item.section;
      html += `<div class="move-block-section-label">${escapeHtml(item.section)}</div>`;
    }

    const selectedClass = index === selectedIndex ? ' selected' : '';
    const icon = item.isJournal ? '📅' : item.isRecent ? '🕐' : '📄';

    html += `
      <div class="move-block-result${selectedClass}"
           data-on-click="selectResult"
           data-page-name="${escapeHtml(item.name)}"
           data-index="${index}">
        <span class="move-block-result-icon">${icon}</span>
        <span class="move-block-result-name">${escapeHtml(item.displayName || item.name)}</span>
      </div>
    `;
  });

  return html;
}

/**
 * Build the filtered results array from cached pages
 */
function buildFilteredResults(searchText) {
  const query = searchText.toLowerCase().trim();
  const settings = logseq.settings || {};
  const maxRecent = Math.max(1, Math.min(20, settings.maxRecentDestinations || 5));

  filteredResults = [];

  // Section 1: Recent destinations (if no search text and not filtering journals-only)
  if (!query && modalFilter !== 'journals' && recentDestinations.length > 0) {
    const recentItems = recentDestinations.slice(0, maxRecent).map(name => ({
      name: name,
      displayName: name,
      section: 'Recent',
      isRecent: true,
      isJournal: false
    }));
    filteredResults.push(...recentItems);
  }

  // Section 2: Journal shortcuts (today, tomorrow)
  if (modalFilter !== 'pages') {
    const today = getTodayJournalName();
    const tomorrow = getTomorrowJournalName();
    const journalShortcuts = [];

    if (!query || 'today'.includes(query) || today.toLowerCase().includes(query)) {
      journalShortcuts.push({
        name: today,
        displayName: `Today (${today})`,
        section: 'Journals',
        isRecent: false,
        isJournal: true
      });
    }
    if (!query || 'tomorrow'.includes(query) || tomorrow.toLowerCase().includes(query)) {
      journalShortcuts.push({
        name: tomorrow,
        displayName: `Tomorrow (${tomorrow})`,
        section: 'Journals',
        isRecent: false,
        isJournal: true
      });
    }

    filteredResults.push(...journalShortcuts);
  }

  // Section 3: All matching pages
  let matchingPages = cachedPages;

  // Filter by type
  if (modalFilter === 'journals') {
    matchingPages = matchingPages.filter(p => p.isJournal);
  } else if (modalFilter === 'pages') {
    matchingPages = matchingPages.filter(p => !p.isJournal);
  }

  // Filter by search text
  if (query) {
    matchingPages = matchingPages.filter(p =>
      (p.displayName || p.name || '').toLowerCase().includes(query)
    );
  }

  // Remove duplicates with journal shortcuts and recent
  const existingNames = new Set(filteredResults.map(r => r.name.toLowerCase()));
  matchingPages = matchingPages.filter(p => !existingNames.has((p.name || '').toLowerCase()));

  // Sort: non-journals first (alphabetical), then journals (by date descending)
  matchingPages.sort((a, b) => {
    if (a.isJournal !== b.isJournal) return a.isJournal ? 1 : -1;
    return (a.displayName || a.name || '').localeCompare(b.displayName || b.name || '');
  });

  // Limit visible results
  const sectionLabel = modalFilter === 'journals' ? 'Journals' : query ? 'Results' : 'Pages';
  const pagesToShow = matchingPages.slice(0, MAX_VISIBLE_RESULTS).map(p => ({
    name: p.name,
    displayName: p.displayName || p.name,
    section: sectionLabel,
    isRecent: false,
    isJournal: p.isJournal || false
  }));

  filteredResults.push(...pagesToShow);

  // Reset selection if out of bounds
  if (selectedIndex >= filteredResults.length) {
    selectedIndex = Math.max(0, filteredResults.length - 1);
  }
}

/**
 * Set up keyboard handlers on the modal input
 */
function setupModalKeyboardHandlers(input) {
  // Live filtering on input
  input.addEventListener('input', (e) => {
    const searchText = e.target.value;
    selectedIndex = 0;
    buildFilteredResults(searchText);
    renderModal(searchText);

    // Re-focus and restore cursor after re-render
    setTimeout(() => {
      const newInput = parent.document.querySelector('.move-block-input');
      if (newInput) {
        newInput.focus();
        newInput.value = searchText;
        newInput.setSelectionRange(searchText.length, searchText.length);
        setupModalKeyboardHandlers(newInput);
      }
    }, 50);
  });

  // Keyboard navigation — stopPropagation prevents Logseq from handling these keys
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      hideModal();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      selectedIndex = Math.min(selectedIndex + 1, filteredResults.length - 1);
      updateSelection();
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      updateSelection();
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (filteredResults.length > 0 && selectedIndex < filteredResults.length) {
        const selected = filteredResults[selectedIndex];
        hideModal();
        performMove(selected.name);
      }
      return;
    }
  });
}

/**
 * Update visual selection without full re-render
 */
function updateSelection() {
  const results = parent.document.querySelectorAll('.move-block-result');
  results.forEach((el, index) => {
    if (index === selectedIndex) {
      el.classList.add('selected');
      el.scrollIntoView({ block: 'nearest' });
    } else {
      el.classList.remove('selected');
    }
  });
}

/**
 * Hide the modal and reset state
 */
function hideModal() {
  modalVisible = false;
  // NOTE: Do NOT clear pendingBlockUuid here — performMove() handles that
  filteredResults = [];
  selectedIndex = 0;
  logseq.provideUI({
    key: MODAL_KEY,
    path: '#app-container',
    template: '',
    reset: true
  });
}

// ─── Page Fetching ──────────────────────────────────────────────────────────

/**
 * Fetch all pages from the graph
 * @returns {Array} - Array of { name, displayName, isJournal }
 */
async function fetchPages() {
  try {
    const pages = await logseq.Editor.getAllPages();

    if (!pages || !Array.isArray(pages)) {
      console.warn('⚠️ getAllPages returned unexpected result');
      return [];
    }

    return pages
      .filter(p => p && p.name)
      .map(p => ({
        name: p.name,
        displayName: p.originalName || p['original-name'] || p.name,
        isJournal: p['journal?'] === true || p.journal === true || p['journal-day'] != null
      }));

  } catch (error) {
    console.error('❌ Error fetching pages:', error);
    return [];
  }
}

// ─── Move Operation ─────────────────────────────────────────────────────────

/**
 * Perform the move: get block, create at destination, delete original
 * @param {string} destPageName - Destination page name
 */
async function performMove(destPageName) {
  const sourceUuid = pendingBlockUuid;
  pendingBlockUuid = null;

  if (!sourceUuid) {
    console.error('❌ No block UUID to move');
    await logseq.UI.showMsg('No block selected to move.', 'warning');
    return;
  }

  if (!destPageName) {
    console.error('❌ No destination page');
    await logseq.UI.showMsg('No destination selected.', 'warning');
    return;
  }

  try {
    console.log(`📦 Moving block ${sourceUuid} to "${destPageName}"...`);

    // Show "Moving..." indicator
    logseq.UI.showMsg('Moving block...', 'info', { timeout: 10000, key: 'move-block-progress' });

    // Step 1: Get the source block with children
    const sourceBlock = await logseq.Editor.getBlock(sourceUuid, { includeChildren: true });
    if (!sourceBlock) {
      await logseq.UI.showMsg('Block not found. It may have been deleted.', 'warning');
      return;
    }

    // Get block content (DB version uses title)
    const blockContent = sourceBlock.title || sourceBlock.content || '';
    if (!blockContent && (!sourceBlock.children || sourceBlock.children.length === 0)) {
      await logseq.UI.showMsg('Block is empty. Nothing to move.', 'warning');
      return;
    }

    // Check if trying to move to the same page
    const currentPage = sourceBlock.page;
    if (currentPage) {
      const pageName = typeof currentPage === 'object' ? (currentPage.name || currentPage.originalName) : currentPage;
      if (pageName && pageName.toLowerCase() === destPageName.toLowerCase()) {
        await logseq.UI.showMsg('Block is already on this page.', 'warning');
        return;
      }
    }

    // Step 2: Get source block properties
    let sourceProperties = {};
    try {
      sourceProperties = await logseq.Editor.getBlockProperties(sourceUuid) || {};
    } catch (e) {
      console.warn('⚠️ Could not read block properties:', e);
    }

    // Step 3: Create block on destination page
    const settings = logseq.settings || {};
    const position = settings.movePosition || 'bottom';

    let newBlock;
    if (position === 'top') {
      newBlock = await logseq.Editor.prependBlockInPage(destPageName, blockContent);
    } else {
      newBlock = await logseq.Editor.appendBlockInPage(destPageName, blockContent);
    }

    if (!newBlock) {
      await logseq.UI.showMsg('Failed to create block on destination page. The page may not exist.', 'warning');
      return;
    }

    console.log(`✅ Created new block ${newBlock.uuid} on "${destPageName}"`);

    // Step 4: Copy properties to new block
    await copyProperties(newBlock.uuid, sourceProperties);

    // Step 5: Recursively create children
    if (sourceBlock.children && sourceBlock.children.length > 0) {
      await insertChildrenRecursively(sourceBlock.children, newBlock.uuid);
    }

    // Step 6: Collapse the moved block if it has children
    if (sourceBlock.children && sourceBlock.children.length > 0) {
      try {
        await logseq.Editor.setBlockCollapsed(newBlock.uuid, true);
      } catch (e) {
        console.warn('⚠️ Could not collapse block:', e);
      }
    }

    // Step 7: Delete original block
    await logseq.Editor.removeBlock(sourceUuid);
    console.log(`🗑️ Deleted original block ${sourceUuid}`);

    // Step 8: Track recent destination
    addRecentDestination(destPageName);

    // Step 9: Dismiss the "Moving..." toast, then show confirmation
    logseq.UI.showMsg('', 'info', { timeout: 1, key: 'move-block-progress' });
    const showConfirmation = settings.showConfirmation !== false;
    if (showConfirmation) {
      await logseq.UI.showMsg(`Moved to "${destPageName}"`, 'success', { timeout: 3000 });
    }

    // Step 10: Navigate to destination page if setting enabled
    if (settings.navigateAfterMove === 'navigate') {
      try {
        await new Promise(resolve => setTimeout(resolve, 300));
        await logseq.App.pushState('page', { name: destPageName.toLowerCase() });
      } catch (e) {
        console.warn('⚠️ Could not navigate to destination page:', e);
      }
    }

    console.log(`✅ Successfully moved block to "${destPageName}"`);

  } catch (error) {
    console.error('❌ Error moving block:', error);
    await logseq.UI.showMsg('Failed to move block. Check the developer console for details.', 'warning');
  }
}

/**
 * Recursively insert child blocks under a parent.
 * Siblings are inserted sequentially to preserve order (Logseq appends),
 * but property copying and grandchild recursion happen in parallel.
 * @param {Array} children - Array of child block objects
 * @param {string} parentUuid - UUID of the parent block
 */
async function insertChildrenRecursively(children, parentUuid) {
  if (!children || !Array.isArray(children) || children.length === 0) {
    return;
  }

  // Phase 1: Create all sibling blocks sequentially (order matters)
  const created = [];
  for (const child of children) {
    try {
      const childContent = child.title || child.content || '';
      const newChild = await logseq.Editor.insertBlock(parentUuid, childContent, {
        sibling: false
      });

      if (!newChild) {
        console.warn('⚠️ Failed to create child block:', childContent.substring(0, 50));
        created.push(null);
        continue;
      }

      created.push({ newChild, original: child });
    } catch (error) {
      console.error('❌ Error inserting child block:', error);
      created.push(null);
    }
  }

  // Phase 2: Copy properties + recurse into grandchildren (in parallel)
  const tasks = created
    .filter(item => item !== null)
    .map(async ({ newChild, original }) => {
      // Copy properties
      if (original.uuid) {
        try {
          const childProps = await logseq.Editor.getBlockProperties(original.uuid) || {};
          await copyProperties(newChild.uuid, childProps);
        } catch (e) {
          console.warn('⚠️ Could not copy child properties:', e);
        }
      }

      // Recurse for grandchildren
      if (original.children && original.children.length > 0) {
        await insertChildrenRecursively(original.children, newChild.uuid);
      }
    });

  await Promise.all(tasks);
}

/**
 * Copy properties from source to a new block
 * @param {string} targetUuid - UUID of the target block
 * @param {Object} properties - Properties to copy
 */
async function copyProperties(targetUuid, properties) {
  if (!properties || typeof properties !== 'object') {
    return;
  }

  for (const [key, value] of Object.entries(properties)) {
    // Skip internal properties that shouldn't be copied
    if (key.startsWith('id') || key === 'uuid' || key === 'id') {
      continue;
    }

    try {
      await logseq.Editor.upsertBlockProperty(targetUuid, key, value);
    } catch (e) {
      console.warn(`⚠️ Could not copy property "${key}":`, e);
    }
  }
}

// ─── Quick Actions ──────────────────────────────────────────────────────────

/**
 * Move the current block to today's journal page
 */
async function moveCurrentBlockToToday() {
  try {
    // pendingBlockUuid may already be set by slash command handler
    if (!pendingBlockUuid) {
      const currentBlock = await logseq.Editor.getCurrentBlock();
      if (!currentBlock) {
        await logseq.UI.showMsg('No block selected. Place your cursor in a block first.', 'warning');
        return;
      }
      pendingBlockUuid = currentBlock.uuid;
    }

    const today = getTodayJournalName();
    await performMove(today);

  } catch (error) {
    console.error('❌ Error moving to today:', error);
    await logseq.UI.showMsg('Failed to move block to today.', 'warning');
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Get today's journal page name in Logseq format
 * @returns {string} - Journal page name (e.g., "mar 8th, 2026")
 */
function getTodayJournalName() {
  return formatJournalDate(new Date());
}

/**
 * Get tomorrow's journal page name
 * @returns {string}
 */
function getTomorrowJournalName() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return formatJournalDate(tomorrow);
}

/**
 * Format a date as a Logseq journal page name
 * Default Logseq format: "MMM DDth, YYYY" (e.g., "Mar 8th, 2026")
 * @param {Date} date
 * @returns {string}
 */
function formatJournalDate(date) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  const suffix = getDaySuffix(day);
  return `${month} ${day}${suffix}, ${year}`;
}

/**
 * Get ordinal suffix for a day number
 * @param {number} day
 * @returns {string}
 */
function getDaySuffix(day) {
  if (day >= 11 && day <= 13) return 'th';
  switch (day % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

/**
 * Track a recent move destination
 * @param {string} pageName
 */
function addRecentDestination(pageName) {
  // Remove if already present, then add to front
  recentDestinations = recentDestinations.filter(
    n => n.toLowerCase() !== pageName.toLowerCase()
  );
  recentDestinations.unshift(pageName);

  // Trim to max
  const settings = logseq.settings || {};
  const max = Math.max(1, Math.min(20, settings.maxRecentDestinations || 5));
  recentDestinations = recentDestinations.slice(0, max);
}

/**
 * Escape HTML special characters
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Start ──────────────────────────────────────────────────────────────────

logseq.ready(main).catch(console.error);
