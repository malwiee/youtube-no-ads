/* ============================================
   YouTube Shell — Main Application Logic
   Piped API backend for ad-free streaming
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
    let API = PIPED_INSTANCES[0];
    const REGION = 'IT';
    const SKELETON_COUNT = 12;
    const DEBOUNCE_MS = 400;

    // ─── DOM References ────────────────────────────
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const searchInput = $('#searchInput');
    const searchBtn = $('#searchBtn');
    const videoGrid = $('#videoGrid');
    const loadMoreWrapper = $('#loadMoreWrapper');
    const loadMoreBtn = $('#loadMoreBtn');
    const playerPage = $('#playerPage');
    const videoPlayer = $('#videoPlayer');
    const playerTitle = $('#playerTitle');
    const playerViews = $('#playerViews');
    const playerDate = $('#playerDate');
    const playerMeta = $('#playerMeta');
    const channelAvatar = $('#channelAvatar');
    const channelName = $('#channelName');
    const channelSubs = $('#channelSubs');
    const likeCount = $('#likeCount');
    const playerDescText = $('#playerDescText');
    const playerDescription = $('#playerDescription');
    const relatedList = $('#relatedList');
    const toastEl = $('#toast');
    const logo = $('#logo');
    const chipsScroll = $('#chipsScroll');
    const pipBtn = $('#pipBtn');
    const bottomNav = $('#bottomNav');

    // ─── State ─────────────────────────────────────
    let currentMode = 'home'; // home, search
    let searchNextPage = null;
    let currentQuery = '';
    let debounceTimer = null;
    let allTrending = [];

    // ─── Service Worker ────────────────────────────
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
        if (!views && views !== 0) return '';
        if (views >= 1_000_000_000) return `${(views / 1_000_000_000).toFixed(1)} Mrd visualizzazioni`;
        if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)} Mln visualizzazioni`;
        if (views >= 1_000) return `${Math.round(views / 1_000)} mila visualizzazioni`;
        return `${views} visualizzazioni`;
    }

    function formatViewsShort(views) {
        if (!views && views !== 0) return '';
        if (views >= 1_000_000_000) return `${(views / 1_000_000_000).toFixed(1)} Mrd`;
        if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)} Mln`;
        if (views >= 1_000) return `${Math.round(views / 1_000)} mila`;
        return `${views}`;
    }

    function timeAgo(uploaded) {
        if (!uploaded) return '';
        // Piped sometimes returns relative text directly
        if (typeof uploaded === 'string' && !uploaded.includes('T') && !uploaded.match(/^\d{4}-/)) {
            return uploaded;
        }
        try {
            const date = new Date(uploaded);
            if (isNaN(date.getTime())) return uploaded || '';
            const now = new Date();
            const diff = Math.floor((now - date) / 1000);
            if (diff < 60) return 'adesso';
            if (diff < 3600) return `${Math.floor(diff / 60)} minuti fa`;
            if (diff < 86400) return `${Math.floor(diff / 3600)} ore fa`;
            if (diff < 2592000) return `${Math.floor(diff / 86400)} giorni fa`;
            if (diff < 31536000) return `${Math.floor(diff / 2592000)} mesi fa`;
            return `${Math.floor(diff / 31536000)} anni fa`;
        } catch {
            return uploaded || '';
        }
    }

    function extractVideoId(url) {
        if (!url) return null;
        const match = url.match(/[?&]v=([^&]+)/);
        if (match) return match[1];
        const segments = url.split('/');
        return segments[segments.length - 1] || null;
    }

    // ─── Proxy thumbnails through Piped ────────────
    function proxyThumb(url) {
        if (!url) return '';
        // Use pipedproxy for thumbnail proxying (avoids CORS/tracking)
        return url;
    }

    // ─── Skeleton Loaders ─────────────────────────
    function showSkeletons(container, count = SKELETON_COUNT) {
        container.innerHTML = '';
        for (let i = 0; i < count; i++) {
            const el = document.createElement('div');
            el.className = 'yt-skeleton-card';
            el.innerHTML = `
                <div class="yt-skeleton-thumb"></div>
                <div class="yt-skeleton-details">
                    <div class="yt-skeleton-avatar"></div>
                    <div class="yt-skeleton-text">
                        <div class="yt-skeleton-line"></div>
                        <div class="yt-skeleton-line"></div>
                        <div class="yt-skeleton-line"></div>
                    </div>
                </div>
            `;
            container.appendChild(el);
        }
    }

    // ─── Video Card (YouTube-style) ────────────────
    function createVideoCard(video) {
        const card = document.createElement('div');
        card.className = 'yt-video-card';

        const videoId = extractVideoId(video.url);
        if (!videoId) return null;

        const thumb = proxyThumb(video.thumbnail);
        const title = video.title || 'Senza titolo';
        const channel = video.uploaderName || video.uploader || '';
        const uploaderAvatar = video.uploaderAvatar || '';
        const views = formatViewsShort(video.views);
        const duration = formatDuration(video.duration);
        const uploaded = video.uploadedDate || timeAgo(video.uploaded);

        card.innerHTML = `
            <div class="yt-thumb-wrap">
                <img src="${thumb}" alt="${title}" loading="lazy" onerror="this.style.display='none'">
                ${duration ? `<span class="yt-duration">${duration}</span>` : ''}
            </div>
            <div class="yt-video-details">
                <div class="yt-channel-thumb">
                    ${uploaderAvatar
                ? `<img src="${proxyThumb(uploaderAvatar)}" alt="${channel}" loading="lazy" onerror="this.parentElement.innerHTML='<div style=\\'width:100%;height:100%;background:#383838;border-radius:50%\\'></div>'">`
                : `<div style="width:100%;height:100%;background:#383838;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#aaa;font-size:14px;font-weight:500">${channel.charAt(0).toUpperCase()}</div>`
            }
                </div>
                <div class="yt-video-text">
                    <div class="yt-video-card-title">${title}</div>
                    <div class="yt-video-card-channel">${channel}</div>
                    <div class="yt-video-card-meta">
                        ${views ? `<span>${views}</span>` : ''}
                        ${uploaded ? `<span>${uploaded}</span>` : ''}
                    </div>
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
                    <div class="yt-state-message">
                        <div class="icon">📭</div>
                        <div class="title">Nessun risultato</div>
                        <div class="desc">Prova con parole chiave diverse</div>
                    </div>
                `;
            }
            return;
        }

        videos.forEach((v) => {
            if (v.type && v.type !== 'stream') return;
            const card = createVideoCard(v);
            if (card) container.appendChild(card);
        });
    }

    // ─── Related Video Card ────────────────────────
    function createRelatedCard(video) {
        const card = document.createElement('div');
        card.className = 'yt-related-card';

        const videoId = extractVideoId(video.url);
        if (!videoId) return null;

        const thumb = proxyThumb(video.thumbnail);
        const title = video.title || 'Senza titolo';
        const channel = video.uploaderName || video.uploader || '';
        const views = formatViewsShort(video.views);
        const duration = formatDuration(video.duration);
        const uploaded = video.uploadedDate || timeAgo(video.uploaded);

        card.innerHTML = `
            <div class="yt-related-thumb">
                <img src="${thumb}" alt="${title}" loading="lazy" onerror="this.style.display='none'">
                ${duration ? `<span class="yt-duration">${duration}</span>` : ''}
            </div>
            <div class="yt-related-info">
                <div class="yt-related-card-title">${title}</div>
                <div class="yt-related-card-channel">${channel}</div>
                <div class="yt-related-card-meta">
                    ${views ? `<span>${views}</span>` : ''}
                    ${uploaded ? `<span>${uploaded}</span>` : ''}
                </div>
            </div>
        `;

        card.addEventListener('click', () => openPlayer(videoId));
        return card;
    }

    // ─── API Calls ─────────────────────────────────
    async function apiFetch(endpoint) {
        try {
            const res = await fetch(`${API}${endpoint}`, { signal: AbortSignal.timeout(8000) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (firstErr) {
            console.warn(`[Piped] ${API} failed:`, firstErr.message);
        }

        for (const instance of PIPED_INSTANCES) {
            if (instance === API) continue;
            try {
                const res = await fetch(`${instance}${endpoint}`, { signal: AbortSignal.timeout(8000) });
                if (!res.ok) continue;
                const data = await res.json();
                API = instance;
                console.log(`[Piped] Switched to: ${instance}`);
                return data;
            } catch (e) {
                console.warn(`[Piped] ${instance} failed:`, e.message);
            }
        }

        throw new Error('Tutti i server Piped non sono raggiungibili');
    }

    // ─── Trending ──────────────────────────────────
    async function loadTrending() {
        showSkeletons(videoGrid);
        try {
            const data = await apiFetch(`/trending?region=${REGION}`);
            allTrending = data || [];
            renderVideos(videoGrid, allTrending);
        } catch (err) {
            console.error('Trending error:', err);
            videoGrid.innerHTML = `
                <div class="yt-state-message">
                    <div class="icon">⚠️</div>
                    <div class="title">Errore di caricamento</div>
                    <div class="desc">Impossibile caricare i video. Riprova più tardi.</div>
                </div>
            `;
            toast('Errore nel caricamento');
        }
    }

    // ─── Search ────────────────────────────────────
    async function searchVideos(query, append = false) {
        if (!query.trim()) return;
        currentQuery = query.trim();
        currentMode = 'search';

        if (!append) {
            showSkeletons(videoGrid);
            loadMoreWrapper.style.display = 'none';
            // Deactivate all chips
            $$('.yt-chip').forEach(c => c.classList.remove('active'));
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

            renderVideos(videoGrid, items, append);

            loadMoreWrapper.style.display = searchNextPage ? 'flex' : 'none';
        } catch (err) {
            console.error('Search error:', err);
            if (!append) {
                videoGrid.innerHTML = `
                    <div class="yt-state-message">
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
        playerPage.classList.add('active');
        document.body.style.overflow = 'hidden';
        playerPage.scrollTop = 0;

        // Hide bottom nav
        bottomNav.style.display = 'none';

        // Reset
        videoPlayer.src = '';
        playerTitle.textContent = 'Caricamento...';
        playerViews.textContent = '';
        playerDate.textContent = '';
        channelName.textContent = '';
        channelSubs.textContent = '';
        channelAvatar.src = '';
        likeCount.textContent = '—';
        playerDescText.textContent = '';
        relatedList.innerHTML = '<div class="yt-spinner"></div>';

        try {
            const data = await apiFetch(`/streams/${videoId}`);

            // ── Set video source ──
            let videoUrl = null;

            if (data.hls) {
                videoUrl = data.hls;
            }

            if (!videoUrl && data.videoStreams && data.videoStreams.length) {
                const progressive = data.videoStreams
                    .filter(s => !s.videoOnly && s.url)
                    .sort((a, b) => (b.quality ? parseInt(b.quality) : 0) - (a.quality ? parseInt(a.quality) : 0));
                if (progressive.length) {
                    videoUrl = progressive[0].url;
                }
            }

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

            if (data.views !== undefined) {
                playerViews.textContent = formatViews(data.views);
            }
            if (data.uploadDate) {
                playerDate.textContent = data.uploadDate;
            }

            if (data.uploaderAvatar) {
                channelAvatar.src = proxyThumb(data.uploaderAvatar);
                channelAvatar.style.display = '';
            } else {
                channelAvatar.style.display = 'none';
            }

            channelName.textContent = data.uploader || '';
            channelSubs.textContent = data.uploaderSubscriberCount
                ? `${formatViewsShort(data.uploaderSubscriberCount)} iscritti`
                : '';

            // Likes
            if (data.likes >= 0) {
                likeCount.textContent = data.likes.toLocaleString('it-IT');
            }

            // Description
            playerDescText.textContent = data.description || 'Nessuna descrizione';

            // ── Related Videos ──
            relatedList.innerHTML = '';
            if (data.relatedStreams && data.relatedStreams.length) {
                data.relatedStreams.forEach(v => {
                    if (v.type && v.type !== 'stream') return;
                    const card = createRelatedCard(v);
                    if (card) relatedList.appendChild(card);
                });
            } else {
                relatedList.innerHTML = '<div class="yt-state-message"><div class="desc">Nessun video suggerito</div></div>';
            }

        } catch (err) {
            console.error('Player error:', err);
            toast('Impossibile riprodurre il video');
            closePlayer();
        }
    }

    function closePlayer() {
        playerPage.classList.remove('active');
        document.body.style.overflow = '';
        videoPlayer.pause();
        videoPlayer.removeAttribute('src');
        videoPlayer.load();

        // Restore bottom nav
        if (window.innerWidth < 1024) {
            bottomNav.style.display = '';
        }
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
                videoPlayer.webkitSetPresentationMode('picture-in-picture');
            } else {
                toast('PiP non supportato');
            }
        } catch (err) {
            console.error('PiP error:', err);
            toast('Impossibile attivare PiP');
        }
    }

    // ─── Chips (category filters) ──────────────────
    function handleChipClick(chip) {
        $$('.yt-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');

        const filter = chip.dataset.filter;
        currentMode = 'home';
        searchInput.value = '';
        loadMoreWrapper.style.display = 'none';

        if (filter === 'all') {
            renderVideos(videoGrid, allTrending);
        } else {
            // Use search to filter by category
            const categoryMap = {
                'music': 'musica',
                'gaming': 'gaming',
                'news': 'notizie',
                'sports': 'sport',
                'learning': 'tutorial',
                'fashion': 'moda',
                'movies': 'film trailer',
                'live': 'live',
                'recent': '',
                'watched': ''
            };
            const query = categoryMap[filter] || filter;
            if (query) {
                currentMode = 'search';
                searchVideos(query);
                // Re-set the chip as active after search
                setTimeout(() => {
                    $$('.yt-chip').forEach(c => c.classList.remove('active'));
                    chip.classList.add('active');
                }, 50);
            } else {
                renderVideos(videoGrid, allTrending);
            }
        }
    }

    // ─── Navigation ────────────────────────────────
    function goHome() {
        currentMode = 'home';
        searchInput.value = '';
        loadMoreWrapper.style.display = 'none';
        closePlayer();

        // Reset chips
        $$('.yt-chip').forEach(c => c.classList.remove('active'));
        const firstChip = $('.yt-chip[data-filter="all"]');
        if (firstChip) firstChip.classList.add('active');

        // Reset nav
        $$('.yt-bottom-item').forEach(i => i.classList.remove('active'));
        $$('.yt-sidebar-item').forEach(i => i.classList.remove('active'));
        const homeBottomItem = $('.yt-bottom-item[data-page="home"]');
        const homeSidebarItem = $('.yt-sidebar-item[data-page="home"]');
        if (homeBottomItem) homeBottomItem.classList.add('active');
        if (homeSidebarItem) homeSidebarItem.classList.add('active');

        if (allTrending.length) {
            renderVideos(videoGrid, allTrending);
        } else {
            loadTrending();
        }
    }

    // ─── Event Listeners ──────────────────────────

    // Logo → Home
    logo.addEventListener('click', (e) => {
        e.preventDefault();
        goHome();
    });

    // Search
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

    // Chips
    chipsScroll.addEventListener('click', (e) => {
        const chip = e.target.closest('.yt-chip');
        if (chip) handleChipClick(chip);
    });

    // Bottom nav
    bottomNav.addEventListener('click', (e) => {
        const item = e.target.closest('.yt-bottom-item');
        if (!item) return;

        const page = item.dataset.page;

        $$('.yt-bottom-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');

        if (page === 'home') {
            goHome();
        } else if (page === 'trending') {
            currentMode = 'home';
            searchInput.value = '';
            loadMoreWrapper.style.display = 'none';
            loadTrending();
        }
    });

    // Sidebar
    $$('.yt-sidebar-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.dataset.page;

            $$('.yt-sidebar-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            if (page === 'home') {
                goHome();
            } else if (page === 'trending') {
                loadTrending();
            }
        });
    });

    // Player back (click on video area top-left back button)
    // We add a back button dynamically
    const backBtn = document.createElement('button');
    backBtn.className = 'yt-player-back-btn';
    backBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>';
    backBtn.addEventListener('click', closePlayer);
    $('.yt-player-video-wrap').appendChild(backBtn);

    // PiP
    pipBtn.addEventListener('click', togglePiP);

    // Close player on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && playerPage.classList.contains('active')) {
            closePlayer();
        }
    });

    // Description expand/collapse
    playerDescription.addEventListener('click', () => {
        playerDescription.classList.toggle('expanded');
    });

    // Share button
    const shareBtn = $('#shareBtn');
    if (shareBtn) {
        shareBtn.addEventListener('click', async () => {
            const url = `https://youtube.com/watch?v=${videoPlayer.dataset.videoId || ''}`;
            try {
                if (navigator.share) {
                    await navigator.share({ title: playerTitle.textContent, url });
                } else {
                    await navigator.clipboard.writeText(url);
                    toast('Link copiato!');
                }
            } catch {
                toast('Impossibile condividere');
            }
        });
    }

    // ─── Init ──────────────────────────────────────
    // Wait for authentication before loading content
    function initApp() {
        if (typeof YTAuth !== 'undefined' && YTAuth.isLoggedIn()) {
            loadTrending();
        } else {
            // Retry until authenticated
            const check = setInterval(() => {
                if (typeof YTAuth !== 'undefined' && YTAuth.isLoggedIn()) {
                    clearInterval(check);
                    loadTrending();
                }
            }, 500);
        }
    }

    initApp();

})();
