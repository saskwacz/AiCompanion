/**
 * memories-page.js — Companion Memory Dashboard (IndexedDB)
 */

import { openDB } from './db.js';
import { getChatById } from './chats.js';
import { getCharacterById } from './characters.js';
import { loadDashboard, filterMemories } from './companion/dashboardService.js';
import { RELATIONSHIP_KEYS } from './companion/relationshipService.js';
import { escapeHtml, showToast } from './ui.js';

const params = new URLSearchParams(window.location.search);
const chatId = params.get('chatId') ? parseInt(params.get('chatId')) : null;

let dashboard = null;
let charData = null;
let chatData = null;
let filterState = { search: '', type: '', sort: 'importance' };

const EMOTION_KEYS = [
    ['valence', 'Walencja', '🙂'],
    ['energy', 'Energia', '⚡'],
    ['stress', 'Stres', '😰'],
    ['confidence', 'Pewność', '💪'],
    ['fear', 'Strach', '😨'],
    ['anger', 'Złość', '😠'],
    ['curiosity', 'Ciekawość', '🔍'],
    ['loneliness', 'Samotność', '🌙'],
    ['affection', 'Czułość', '💗'],
    ['trust_user', 'Zaufanie', '🤝'],
];

const REL_LABELS = {
    trust: 'Zaufanie', respect: 'Szacunek', friendship: 'Przyjaźń',
    affection: 'Czułość', dependency: 'Zależność', jealousy: 'Zazdrość',
    romance: 'Romantyzm', hostility: 'Wrogość', familiarity: 'Bliskość', rapport: 'Sympatia',
};

async function init() {
    try {
        await openDB();
        if (!chatId) { setContent('<p class="error-text">Brak chatId w URL.</p>'); return; }

        chatData = await getChatById(chatId);
        if (!chatData) { setContent('<p class="error-text">Czat nie znaleziony.</p>'); return; }

        charData = await getCharacterById(chatData.characterId);
        dashboard = await loadDashboard(chatId);

        document.getElementById('page-title').textContent =
            `Pamięć — ${chatData.title || charData?.name || 'czat'}`;

        render();
    } catch (err) {
        console.error('[Dashboard]', err);
        setContent(`<p class="error-text">Błąd: ${escapeHtml(err.message)}</p>`);
    }
}

function setContent(html) {
    const el = document.getElementById('memory-content');
    if (el) el.innerHTML = html;
}

function pct(n) {
    return Math.round((Number(n) || 0) * 100);
}

function bar(label, value, icon = '') {
    const p = pct(value);
    return `
        <div class="dash-meter">
            <div class="dash-meter-head">
                <span>${icon} ${escapeHtml(label)}</span>
                <span class="dash-meter-val">${p}%</span>
            </div>
            <div class="dash-meter-track"><div class="dash-meter-fill" style="width:${p}%"></div></div>
        </div>`;
}

function badge(text, cls = '') {
    return `<span class="dash-badge ${cls}">${escapeHtml(text)}</span>`;
}

function statCard(icon, label, value) {
    return `
        <div class="dash-stat-card">
            <div class="dash-stat-icon">${icon}</div>
            <div class="dash-stat-label">${escapeHtml(label)}</div>
            <div class="dash-stat-value">${escapeHtml(String(value))}</div>
        </div>`;
}

function memoryCard(m) {
    const date = m.created_at ? new Date(m.created_at).toLocaleDateString('pl-PL') : '—';
    const accessed = m.last_accessed ? new Date(m.last_accessed).toLocaleDateString('pl-PL') : '—';
    const tags = (m.tags || []).map(t => badge(t, 'dash-badge-tag')).join('');
    return `
        <article class="dash-memory-card">
            <header class="dash-memory-head">
                ${badge(m.type, 'dash-badge-type')}
                ${badge(m.validity || 'long_term', 'dash-badge-validity')}
                ${badge(`★ ${(m.importance ?? 0).toFixed(2)}`, 'dash-badge-imp')}
                ${badge(`${pct(m.confidence)}% conf`, 'dash-badge-conf')}
            </header>
            <p class="dash-memory-text">${escapeHtml(m.content)}</p>
            <footer class="dash-memory-foot">
                <span>📅 ${date}</span>
                <span>👁 ${accessed}</span>
                ${tags}
            </footer>
        </article>`;
}

function goalCard(g) {
    const p = pct(g.progress);
    return `
        <div class="dash-goal-card dash-goal-${g.status}">
            <div class="dash-goal-head">
                <span class="dash-goal-priority">P${g.priority}</span>
                ${badge(g.status, `dash-badge-status-${g.status}`)}
            </div>
            <p>${escapeHtml(g.text)}</p>
            <div class="dash-meter-track"><div class="dash-meter-fill" style="width:${p}%"></div></div>
        </div>`;
}

function section(id, icon, title, body, collapsed = false) {
    return `
        <section class="dash-section${collapsed ? ' collapsed' : ''}" id="${id}">
            <button type="button" class="dash-section-toggle" onclick="toggleSection('${id}')">
                <span>${icon} ${escapeHtml(title)}</span>
                <span class="dash-chevron">▼</span>
            </button>
            <div class="dash-section-body">${body}</div>
        </section>`;
}

function renderStats() {
    const s = dashboard.stats;
    return `
        <div class="dash-stats-grid">
            ${statCard('🧠', 'Wspomnienia', s.totalMemories)}
            ${statCard('📌', 'Stałe', s.permanentCount)}
            ${statCard('⏳', 'Tymczasowe', s.temporaryCount)}
            ${statCard('🔗', 'Embeddingi', s.embeddingCount)}
            ${statCard('⭐', 'Śr. ważność', (s.avgImportance * 100).toFixed(0) + '%')}
            ${statCard('✓', 'Śr. pewność', (s.avgConfidence * 100).toFixed(0) + '%')}
            ${statCard('💞', 'Relacja', (s.relationshipScore * 100).toFixed(0) + '%')}
            ${statCard('😊', 'Emocje', (s.emotionScore * 100).toFixed(0) + '%')}
        </div>
        <p class="dash-meta">Ostatnia aktualizacja: ${s.lastUpdate ? new Date(s.lastUpdate).toLocaleString('pl-PL') : '—'} · ${dashboard.messageCount} wiadomości</p>`;
}

function renderCharacterFacts() {
    const facts = dashboard.characterFacts;
    if (!facts.length) return '<p class="dash-empty">Brak faktów o postaci — pojawią się po rozmowach.</p>';
    return `<div class="dash-card-grid">${facts.map(memoryCard).join('')}</div>`;
}

function renderMemories() {
    const filtered = filterMemories(dashboard.longTermMemories, filterState);
    const toolbar = `
        <div class="dash-toolbar">
            <input type="search" id="mem-search" class="setting-input" placeholder="Szukaj…" value="${escapeHtml(filterState.search)}">
            <select id="mem-type" class="setting-input">
                <option value="">Wszystkie typy</option>
                ${['fact','event','preference','relationship','rule'].map(t =>
                    `<option value="${t}"${filterState.type === t ? ' selected' : ''}>${t}</option>`).join('')}
            </select>
            <select id="mem-sort" class="setting-input">
                <option value="importance"${filterState.sort === 'importance' ? ' selected' : ''}>Ważność</option>
                <option value="recency"${filterState.sort === 'recency' ? ' selected' : ''}>Ostatni dostęp</option>
                <option value="confidence"${filterState.sort === 'confidence' ? ' selected' : ''}>Pewność</option>
                <option value="created"${filterState.sort === 'created' ? ' selected' : ''}>Data utworzenia</option>
            </select>
        </div>`;

    const list = filtered.length
        ? `<div class="dash-card-grid">${filtered.map(memoryCard).join('')}</div>`
        : '<p class="dash-empty">Brak wspomnień pasujących do filtrów.</p>';

    return toolbar + list;
}

function renderRelationship() {
    const r = dashboard.relationship;
    return RELATIONSHIP_KEYS.map(k =>
        bar(REL_LABELS[k] || k, r[k], '💞')
    ).join('');
}

function renderEmotions() {
    const e = dashboard.emotions;
    const mood = badge(e.mood || 'neutral', 'dash-badge-mood');
    const updated = e.last_updated ? new Date(e.last_updated).toLocaleString('pl-PL') : '—';
    const meters = EMOTION_KEYS.map(([k, label, icon]) => bar(label, e[k], icon)).join('');
    return `<div class="dash-mood-row">Nastrój: ${mood} · Aktualizacja: ${updated}</div>${meters}`;
}

function renderGoals() {
    const g = dashboard.goals;
    const blocks = [
        ['Aktywne', g.active, false],
        ['Ukończone', g.completed, true],
        ['Nieudane', g.failed, true],
    ];
    return blocks.map(([title, list, collapsed]) =>
        section(`goals-${title}`, '🎯', `${title} (${list.length})`,
            list.length ? list.map(goalCard).join('') : '<p class="dash-empty">Brak</p>', collapsed)
    ).join('');
}

function renderWorld() {
    const w = dashboard.world;
    if (!w?.is_simulation && !(w?.entities?.length) && w?.location === 'here') {
        return '<p class="dash-empty">Tryb symulacji świata nieaktywny.</p>';
    }
    return `
        <div class="dash-world-grid">
            <div><strong>📍 Lokalizacja</strong><br>${escapeHtml(w.location || '—')}</div>
            <div><strong>🎬 Scena</strong><br>${escapeHtml(w.active_scene || '—')}</div>
            <div><strong>🕐 Czas</strong><br>${escapeHtml(w.time || '—')}</div>
        </div>
        ${w.inventory?.length ? `<p><strong>Ekwipunek:</strong> ${w.inventory.length} przedm.</p>` : ''}
        ${w.narrative_flags?.length ? `<p><strong>Flagi:</strong> ${w.narrative_flags.length}</p>` : ''}
        ${w.entities?.length ? `<p><strong>NPC:</strong> ${w.entities.length}</p>` : ''}`;
}

function renderSummary() {
    const s = dashboard.summary;
    if (!s?.summary) return '<p class="dash-empty">Brak podsumowania sesji.</p>';
    const events = (s.key_events || []).map(e => `<li>${escapeHtml(e)}</li>`).join('');
    return `
        <p class="dash-summary-text">${escapeHtml(s.summary)}</p>
        ${events ? `<details><summary>Kluczowe zdarzenia</summary><ul>${events}</ul></details>` : ''}
        <p class="dash-meta">Utworzono: ${s.created_at ? new Date(s.created_at).toLocaleString('pl-PL') : '—'}</p>`;
}

function render() {
    if (!dashboard) return;

    setContent(`
        ${section('stats', '📊', 'Statystyki pamięci', renderStats())}
        ${section('facts', '🧬', 'Fakty o postaci', renderCharacterFacts())}
        ${section('memories', '💭', 'Wspomnienia długoterminowe', renderMemories())}
        ${section('relationship', '💞', 'Stan relacji', renderRelationship())}
        ${section('emotions', '😊', 'Stan emocjonalny', renderEmotions())}
        ${section('goals-wrap', '🎯', 'Cele', renderGoals(), false)}
        ${section('world', '🌍', 'Stan świata', renderWorld(), true)}
        ${section('summary', '📝', 'Podsumowanie rozmowy', renderSummary())}
    `);

    bindFilters();
    const info = document.getElementById('memory-info');
    if (info) info.textContent = `${dashboard.stats.totalMemories} wspomnień · relacja ${pct(dashboard.stats.relationshipScore)}%`;
}

function bindFilters() {
    document.getElementById('mem-search')?.addEventListener('input', e => {
        filterState.search = e.target.value;
        refreshMemoriesSection();
    });
    document.getElementById('mem-type')?.addEventListener('change', e => {
        filterState.type = e.target.value;
        refreshMemoriesSection();
    });
    document.getElementById('mem-sort')?.addEventListener('change', e => {
        filterState.sort = e.target.value;
        refreshMemoriesSection();
    });
}

function refreshMemoriesSection() {
    const body = document.querySelector('#memories .dash-section-body');
    if (body) body.innerHTML = renderMemories();
    bindFilters();
}

window.toggleSection = function(id) {
    document.getElementById(id)?.classList.toggle('collapsed');
};

window.goBack = () => { window.location.href = 'index.html'; };

window.refreshMemory = async function() {
    showToast('Odświeżanie z IndexedDB…', 'info');
    dashboard = await loadDashboard(chatId);
    render();
    showToast('Dashboard zaktualizowany', 'success');
};

init();
