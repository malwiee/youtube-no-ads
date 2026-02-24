/* ============================================
   YouTube NoAds — Main Application Logic
   Piped API: https://pipedapi.kavin.rocks
   ============================================ */

(() => {
    'use strict';

    // ─── Config ────────────────────────────────────
    const PIPED_INSTANCES = [
        'https://pipedapi.kavin.rocks',
        'https://pipedapi-libre.kavin.rocks',
        'https://pipedapi.adminforge.de',
        'https://api.piped.yt',
        'https://pipedapi.reallyaweso.me',
        'https://pipedapi.leptons.xyz',
        'https://piped-api.privacy.com.de'
    ];
    let API = PIPED_INSTANCES[0]; // Active instance (updated on fallback)
    const REGION = 'IT';
    const SKELETON_COUNT = 8;
    const DEBOUNCE_MS = 400;

    // ─── DOM References ────────────────────────────
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const searchInput = $('#searchInput');
    const searchBtn = $('#searchBtn');
    const navTabs = $('#navTabs');
    const trendingSection = $('#trendingSection');
    const searchSection = $('#searchSection');
    const trendingGrid = $('#trendingGrid');
    const searchGrid = $('#searchGrid');
    const searchTitle = $('#searchTitle');
    const loadMoreWrapper = $('#loadMoreWrapper');
    const loadMoreBtn = $('#loadMoreBtn');
    const playerOverlay = $('#playerOverlay');
    const playerBack = $('#playerBack');
    const pipBtn = $('#pipBtn');
    const videoPlayer = $('#videoPlayer');
    const playerTitle = $('#playerTitle');
    const playerChannel = $('#playerChannel');
    const channelAvatar = $('#channelAvatar');
    const channelName = $('#channelName');
    const channelSubs = $('#channelSubs');
    const playerStats = $('#playerStats');
    const playerDesc = $('#playerDescription');
    const toastEl = $('#toast');
    const logo = $('#logo');

    // ─── State ─────────────────────────────────────
    let currentTab = 'trending';
    let searchNextPage = null;
    let currentQuery = '';
    let debounceTimer = null;

    // ─── Service Worker Registration ───────────────
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js').catch(() => { });
        });
    }

    // ─── Utilities ─────────────────────────────────
    function toast(message, duration = 3000) {
        toastEl.textContent = message;
        toastEl.classList.add('show');
        setTimeout(() => toastEl.classList.remove('show'), duration);
    }

    function formatDuration(seconds) {
        if (!seconds || seconds < 0) return '';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    function formatViews(views) {
        if (!views) return '';
        if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M visualizzazioni`;
        if (views >= 1_000) return `${(views / 1_000).toFixed(1)}K visualizzazioni`;
        return `${views} visualizzazioni`;
    }

    function timeAgo(isoDate) {
        if (!isoDate) return '';
        try {
            const date = new Date(isoDate);
            const now = new Date();
            const diff = Math.floor((now - date) / 1000);
            if (diff < 60) return 'adesso';
            if (diff < 3600) return `${Math.floor(diff / 60)} min fa`;
            if (diff < 86400) return `${Math.floor(diff / 3600)} ore fa`;
            if (diff < 2592000) return `${Math.floor(diff / 86400)} giorni fa`;
            if (diff < 31536000) return `${Math.floor(diff / 2592000)} mesi fa`;
            return `${Math.floor(diff / 31536000)} anni fa`;
        } catch {
            return '';
        }
    }

    function extractVideoId(url) {
        if (!url) return null;
        // /watch?v=ID or direct ID
        const match = url.match(/[?&]v=([^&]+)/);
        if (match) return match[1];
        // /v/ID or bare ID
        const segments = url.split('/');
        return segments[segments.length - 1] || null;
    }

    // ─── Skeleton Loaders ─────────────────────────
    function showSkeletons(container, count = SKELETON_COUNT) {
        container.innerHTML = '';
        for (let i = 0; i < count; i++) {
            const card = document.createElement('div');
            card.className = 'skeleton-card';
            card.innerHTML = `
        <div class="skeleton-thumb"></div>
        <div class="skeleton-info">
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
        </div>
      `;
            container.appendChild(card);
        }
    }

    // ─── Video Card ────────────────────────────────
    function createVideoCard(video) {
        const card = document.createElement('div');
        card.className = 'video-card';

        const videoId = extractVideoId(video.url);
        if (!videoId) return null;

        const thumb = video.thumbnail || '';
        const title = video.title || 'Senza titolo';
        const channel = video.uploaderName || video.uploader || '';
        const views = formatViews(video.views);
        const duration = formatDuration(video.duration);
        const uploaded = video.uploadedDate || timeAgo(video.uploaded);

        card.innerHTML = `
      <div class="thumb-wrapper">
        <img src="${thumb}" alt="${title}" loading="lazy" onerror="this.style.display='none'">
        ${duration ? `<span class="duration-badge">${duration}</span>` : ''}
      </div>
      <div class="video-info">
        <div class="video-title">${title}</div>
        <div class="video-meta">
          <span class="video-channel">${channel}</span>
          ${views ? `<span>${views}</span>` : ''}
          ${uploaded ? `<span>${uploaded}</span>` : ''}
        </div>
      </div>
    `;

        card.addEventListener('click', () => openPlayer(videoId));
        return card;
    }

    function renderVideos(container, videos, append = false) {
        if (!append) container.innerHTML = '';

        if (!videos || videos.length === 0) {
            if (!append) {
                container.innerHTML = `
          <div class="state-message">
            <div class="icon">📭</div>
            <div class="title">Nessun risultato</div>
            <div class="desc">Prova con parole chiave diverse</div>
          </div>
        `;
            }
            return;
        }

        videos.forEach((v) => {
            // Filter out non-video items (channels, playlists)
            if (v.type && v.type !== 'stream') return;
            const card = createVideoCard(v);
            if (card) container.appendChild(card);
        });
    }

    // ─── API Calls (multi-instance failover) ──────
    async function apiFetch(endpoint) {
        // Try current active instance first
        try {
            const res = await fetch(`${API}${endpoint}`, { signal: AbortSignal.timeout(8000) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (firstErr) {
            console.warn(`[Piped] ${API} failed:`, firstErr.message);
        }

        // Fallback: try all other instances
        for (const instance of PIPED_INSTANCES) {
            if (instance === API) continue;
            try {
                console.log(`[Piped] Trying fallback: ${instance}`);
                const res = await fetch(`${instance}${endpoint}`, { signal: AbortSignal.timeout(8000) });
                if (!res.ok) continue;
                const data = await res.json();
                // Cache the working instance
                API = instance;
                console.log(`[Piped] Switched to: ${instance}`);
                toast(`Connesso a ${new URL(instance).hostname}`);
                return data;
            } catch (e) {
                console.warn(`[Piped] ${instance} failed:`, e.message);
            }
        }

        throw new Error('Tutti i server Piped non sono raggiungibili');
    }

    // ─── Trending ──────────────────────────────────
    async function loadTrending() {
        showSkeletons(trendingGrid);
        try {
            const data = await apiFetch(`/trending?region=${REGION}`);
            renderVideos(trendingGrid, data);
        } catch (err) {
            console.error('Trending error:', err);
            trendingGrid.innerHTML = `
        <div class="state-message">
          <div class="icon">⚠️</div>
          <div class="title">Errore di caricamento</div>
          <div class="desc">Impossibile caricare i trend. Riprova più tardi.</div>
        </div>
      `;
            toast('Errore nel caricamento dei trend');
        }
    }

    // ─── Search ────────────────────────────────────
    async function searchVideos(query, append = false) {
        if (!query.trim()) return;
        currentQuery = query.trim();

        if (!append) {
            switchTab('search');
            searchTitle.innerHTML = `<span class="emoji">🔍</span> Risultati per "${currentQuery}"`;
            showSkeletons(searchGrid);
            loadMoreWrapper.style.display = 'none';
        }

        try {
            let endpoint;
            if (append && searchNextPage) {
                endpoint = `/nextpage/search?nextpage=${encodeURIComponent(searchNextPage)}&q=${encodeURIComponent(currentQuery)}&filter=videos`;
            } else {
                endpoint = `/search?q=${encodeURIComponent(currentQuery)}&filter=videos`;
            }

            const data = await apiFetch(endpoint);
            const items = data.items || data;
            searchNextPage = data.nextpage || null;

            renderVideos(searchGrid, items, append);

            if (searchNextPage) {
                loadMoreWrapper.style.display = 'flex';
            } else {
                loadMoreWrapper.style.display = 'none';
            }
        } catch (err) {
            console.error('Search error:', err);
            if (!append) {
                searchGrid.innerHTML = `
          <div class="state-message">
            <div class="icon">⚠️</div>
            <div class="title">Errore di ricerca</div>
            <div class="desc">Impossibile completare la ricerca. Riprova.</div>
          </div>
        `;
            }
            toast('Errore nella ricerca');
        }
    }

    // ─── Video Player ──────────────────────────────
    async function openPlayer(videoId) {
        playerOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';

        // Reset
        videoPlayer.src = '';
        playerTitle.textContent = 'Caricamento...';
        channelName.textContent = '';
        channelSubs.textContent = '';
        channelAvatar.src = '';
        playerStats.innerHTML = '';
        playerDesc.textContent = '';

        try {
            const data = await apiFetch(`/streams/${videoId}`);

            // ── Set video source ──
            // Try to find a progressive video stream (no separate audio needed)
            let videoUrl = null;

            // 1. Check for HLS (best compatibility with Safari)
            if (data.hls) {
                videoUrl = data.hls;
            }

            // 2. Fallback: pick best videoStream with audio (progressive)
            if (!videoUrl && data.videoStreams && data.videoStreams.length) {
                // Sort by quality desc, prefer streams with audio
                const progressive = data.videoStreams
                    .filter(s => !s.videoOnly && s.url)
                    .sort((a, b) => (b.quality ? parseInt(b.quality) : 0) - (a.quality ? parseInt(a.quality) : 0));

                if (progressive.length) {
                    videoUrl = progressive[0].url;
                }
            }

            // 3. Fallback: any video stream (may be video-only)
            if (!videoUrl && data.videoStreams && data.videoStreams.length) {
                const sorted = [...data.videoStreams]
                    .filter(s => s.url)
                    .sort((a, b) => (b.quality ? parseInt(b.quality) : 0) - (a.quality ? parseInt(a.quality) : 0));
                if (sorted.length) {
                    videoUrl = sorted[0].url;
                }
            }

            if (!videoUrl) {
                throw new Error('Nessun stream disponibile');
            }

            videoPlayer.src = videoUrl;
            videoPlayer.play().catch(() => { });

            // ── Metadata ──
            playerTitle.textContent = data.title || 'Senza titolo';

            if (data.uploaderAvatar) {
                channelAvatar.src = data.uploaderAvatar;
                channelAvatar.style.display = '';
            } else {
                channelAvatar.style.display = 'none';
            }

            channelName.textContent = data.uploader || '';
            channelSubs.textContent = data.uploaderSubscriberCount
                ? `${formatViews(data.uploaderSubscriberCount).replace(' visualizzazioni', '')} iscritti`
                : '';

            // Stats
            const statsHtml = [];
            if (data.views) statsHtml.push(`<span class="stat-item">👁 ${formatViews(data.views)}</span>`);
            if (data.likes >= 0) statsHtml.push(`<span class="stat-item">👍 ${data.likes.toLocaleString('it-IT')}</span>`);
            if (data.dislikes >= 0) statsHtml.push(`<span class="stat-item">👎 ${data.dislikes.toLocaleString('it-IT')}</span>`);
            if (data.uploadDate) statsHtml.push(`<span class="stat-item">📅 ${data.uploadDate}</span>`);
            playerStats.innerHTML = statsHtml.join('');

            playerDesc.textContent = data.description || '';

        } catch (err) {
            console.error('Player error:', err);
            toast('Impossibile riprodurre il video');
            closePlayer();
        }
    }

    function closePlayer() {
        playerOverlay.classList.remove('active');
        document.body.style.overflow = '';
        videoPlayer.pause();
        videoPlayer.removeAttribute('src');
        videoPlayer.load();
    }

    // ─── Picture-in-Picture ────────────────────────
    async function togglePiP() {
        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            } else if (videoPlayer.webkitPresentationMode === 'picture-in-picture') {
                videoPlayer.webkitSetPresentationMode('inline');
            } else if (videoPlayer.requestPictureInPicture) {
                await videoPlayer.requestPictureInPicture();
            } else if (videoPlayer.webkitSetPresentationMode) {
                // Safari fallback
                videoPlayer.webkitSetPresentationMode('picture-in-picture');
            } else {
                toast('PiP non supportato su questo browser');
            }
        } catch (err) {
            console.error('PiP error:', err);
            toast('Impossibile attivare PiP');
        }
    }

    // ─── Tab Navigation ───────────────────────────
    function switchTab(tab) {
        currentTab = tab;
        $$('.nav-tab').forEach((t) => {
            t.classList.toggle('active', t.dataset.tab === tab);
        });
        trendingSection.style.display = tab === 'trending' ? '' : 'none';
        searchSection.style.display = tab === 'search' ? '' : 'none';
    }

    // ─── Event Listeners ──────────────────────────

    // Logo → go home
    logo.addEventListener('click', (e) => {
        e.preventDefault();
        switchTab('trending');
        searchInput.value = '';
    });

    // Tab clicks
    navTabs.addEventListener('click', (e) => {
        const tab = e.target.closest('.nav-tab');
        if (!tab) return;
        switchTab(tab.dataset.tab);
    });

    // Search submit
    function doSearch() {
        const q = searchInput.value.trim();
        if (q) searchVideos(q);
    }

    searchBtn.addEventListener('click', doSearch);
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            doSearch();
        }
    });

    // Debounced live search
    searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const q = searchInput.value.trim();
        if (q.length >= 3) {
            debounceTimer = setTimeout(() => searchVideos(q), DEBOUNCE_MS);
        }
    });

    // Load more
    loadMoreBtn.addEventListener('click', () => {
        if (currentQuery && searchNextPage) {
            searchVideos(currentQuery, true);
        }
    });

    // Player close
    playerBack.addEventListener('click', closePlayer);

    // PiP
    pipBtn.addEventListener('click', togglePiP);

    // Close player on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && playerOverlay.classList.contains('active')) {
            closePlayer();
        }
    });

    // ─── Init ──────────────────────────────────────
    loadTrending();

})();
